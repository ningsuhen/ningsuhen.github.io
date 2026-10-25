/**
 * <listen-player>: reads the post aloud sentence by sentence, in the visitor's browser.
 *
 * Light DOM, progressive enhancement: the component ships `hidden`, and this script removes that only when a
 * speech engine can run. Without JavaScript the player never appears.
 * Engines: see engine.ts. Engine instances outlive the element, so a Swup page change keeps a loaded model.
 */
import {
	type AudioChunk,
	accelerationLabel,
	type TtsEngine,
	type Voice,
} from "./engine";
import { extractSentences, type Sentence } from "./extract";
import { loadKokoroEngine } from "./kokoro-engine";
import {
	type FileSpec,
	type KokoroVariant,
	type Manifest,
	download as downloadFiles,
	isCached,
	loadManifest,
	removeDownload,
	requestPersistence,
	specsFor as buildSpecs,
	storageUsageMB,
	totalMB,
} from "./kokoro-cache";
import { WebSpeechEngine, webSpeechAvailable } from "./web-speech-engine";
import { Pipeline, UNDERRUN_S } from "./playback";
import { pauseAfter, scaledPause } from "./pauses";

type EngineId = "web-speech" | "kokoro";
/** The consent prompt returns a variant to download, "web" for the browser voice, or null for cancel. */
type KokoroChoice = KokoroVariant | "web";

/** Neural-voice speed guard. Past these the player pauses and offers the browser voice. */
const SLOW_FIRST_AUDIO_MS = 8000;
/** Average generation time over the last chunks, divided by their audio length. Above 1 the voice falls behind. */
const SLOW_RTF = 1;
/** Chunks in a row where playback caught up with generation. */
const SLOW_STALLS = 2;
/** A model download with no progress for this long counts as failed. */
const INIT_STALL_MS = 30000;
/** Set on this device when the neural voice was too slow. Next visit starts on the browser voice. */
const SLOW_KEY = "listen-neural-slow";
type PlayState = "idle" | "playing" | "paused";

declare global {
	interface Window {
		__KOKORO_READY?: boolean;
		__KOKORO_CPU?: boolean;
	}
}

const PREFS_KEY = "listen-prefs";
const CONSENT_KEY = "listen-kokoro-consent";
/** Defaults, in one place. The neural voice is the default wherever WebGPU exists; otherwise the browser voice. */
const DEFAULT_ENGINE: EngineId = "kokoro";
const DEFAULT_VOICE = "af_heart";
/** The listener's explicit engine choice (engine menu, consent prompt, cancel). It wins over DEFAULT_ENGINE. */
const CHOICE_KEY = "listen-engine-choice";
/** Consecutive neural start failures, and when the default is offered again. A broken device is not re-prompted every visit. */
const FAILED_KEY = "listen-neural-failed";
const FAILURES_TO_COOL = 2;
const COOL_DOWN_MS = 24 * 60 * 60 * 1000;
/** Set when a prompt is cancelled, a download is cancelled or a start fails: the browser voice for this page session only. */
let sessionFallback = false;

function neuralCoolingDown(): boolean {
	return readStorage<{ count: number; until: number }>(FAILED_KEY, { count: 0, until: 0 }).until > Date.now();
}

function recordNeuralFailure(): void {
	const count = readStorage<{ count: number }>(FAILED_KEY, { count: 0 }).count + 1;
	writeStorage(FAILED_KEY, { count, until: count >= FAILURES_TO_COOL ? Date.now() + COOL_DOWN_MS : 0 });
}

function clearNeuralFailures(): void {
	writeStorage(FAILED_KEY, { count: 0, until: 0 });
}
/** Pinned revision of onnx-community/Kokoro-82M-v1.0-ONNX (Apache-2.0). Pinned so the cached files never drift. */
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const FOLLOW_PAUSE_MS = 4000;
const HIGHLIGHT = "listen-current";
const CAN_HIGHLIGHT =
	typeof CSS !== "undefined" &&
	"highlights" in CSS &&
	typeof Highlight !== "undefined";

interface Prefs {
	engine?: EngineId;
	voice?: string | null;
	rate?: number;
}

function readStorage<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

function writeStorage(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Private windows and blocked storage: the player still works, the choice just is not remembered.
	}
}

function isStream(
	out: Promise<void> | AsyncIterable<AudioChunk>,
): out is AsyncIterable<AudioChunk> {
	return (
		typeof (out as AsyncIterable<AudioChunk>)[Symbol.asyncIterator] ===
		"function"
	);
}

/** Judges whether the neural engine keeps up with playback. Reports at most once per sentence. */
class SpeedMonitor {
	private requestedAt = performance.now();
	private stalls = 0;
	private ratios: number[] = [];
	private reported = false;

	constructor(private readonly onSlow: () => void) {}

	/** Called as each chunk arrives. `queueEmpty` means playback had caught up; `first` marks the first chunk. */
	chunk(durationS: number, queueEmpty: boolean, first: boolean): void {
		const waitedMs = performance.now() - this.requestedAt;
		this.requestedAt = performance.now();
		if (this.reported) return;
		if (first && waitedMs > SLOW_FIRST_AUDIO_MS) return this.report();
		this.stalls = queueEmpty && !first ? this.stalls + 1 : 0;
		if (this.stalls >= SLOW_STALLS) return this.report();
		this.ratios = [...this.ratios.slice(-3), waitedMs / 1000 / Math.max(durationS, 0.01)];
		const average = this.ratios.reduce((a, b) => a + b, 0) / this.ratios.length;
		if (this.ratios.length >= 3 && average > SLOW_RTF) this.report();
	}

	private report(): void {
		this.reported = true;
		this.onSlow();
	}
}

/** Runs a load and fails it when `ms` pass without a progress touch. The stalled load is not disposed here. */
function withStallGuard<T>(
	run: (touch: () => void) => Promise<T>,
	ms: number,
	onStall?: () => void,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let timer = setTimeout(stalled, ms);
		function stalled(): void {
			onStall?.();
			reject(new Error("the download stalled"));
		}
		const touch = (): void => {
			clearTimeout(timer);
			timer = setTimeout(stalled, ms);
		};
		run(touch).then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err: unknown) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

async function hasWebGpuAdapter(): Promise<boolean> {
	const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
	try {
		return Boolean(gpu && (await gpu.requestAdapter()));
	} catch {
		return false;
	}
}

function pickDefaultVoice(voices: Voice[], lang: string): string | null {
	const local = voices.filter((v) => v.local);
	const pool = local.length ? local : voices;
	const match = pool.find((v) =>
		v.lang.toLowerCase().startsWith(lang.toLowerCase()),
	);
	return (match ?? pool[0])?.id ?? null;
}

// The active engine lives at module level: it survives Swup page changes, so a loaded model is reused.
let activeEngine: TtsEngine | null = null;
let activeEngineId: EngineId = "web-speech";
/** One neural engine per page session: created on first use, initialised once, kept across Swup visits. */
let neuralEngine: TtsEngine | null = null;
let neuralInit: Promise<void> | null = null;
let neuralReady = false;
let manifestLoad: Promise<Manifest> | null = null;

/** WebGPU gives the GPU model. The CPU model (fp16, Brev's CPU default) is used only when its flag is set: it still runs slower than real time and produces NaN chunks. */
async function neuralVariant(): Promise<KokoroVariant | null> {
	if (await hasWebGpuAdapter()) return "fp32";
	return window.__KOKORO_CPU === true ? "fp16" : null;
}
let audioContext: AudioContext | null = null;

window.addEventListener("pagehide", () => activeEngine?.cancel());

class ListenPlayer extends HTMLElement {
	private sentences: Sentence[] = [];
	private index = 0;
	private state: PlayState = "idle";
	private rate = 1;
	private voice: string | null = null;
	private runId = 0;
	/** Set when the listener chooses to keep the neural voice after the too-slow notice. */
	private slowAcknowledged = false;
	private downloadAbort: AbortController | null = null;
	private abort: AbortController | null = null;
	private activeBlock: HTMLElement | null = null;
	private lastUserScroll = 0;
	private programmaticUntil = 0;
	private frame = 0;
	private teardown: Array<() => void> = [];
	private dockObserver: IntersectionObserver | null = null;
	private sentinel: HTMLElement | null = null;
	private rateHome: Element | null = null;

	connectedCallback(): void {
		void this.init();
	}

	disconnectedCallback(): void {
		this.stopPlayback();
		this.activeBlock?.removeAttribute("data-listen-current");
		this.activeBlock?.classList.remove("listen-active");
		if (CAN_HIGHLIGHT) CSS.highlights.delete(HIGHLIGHT);
		for (const undo of this.teardown) undo();
		this.teardown = [];
		this.dockObserver?.disconnect();
		this.sentinel?.remove();
		this.removeAttribute("data-docked");
		document.documentElement.style.scrollPaddingTop = "";
	}

	private async init(): Promise<void> {
		const root = document.querySelector<HTMLElement>(this.dataset.target ?? "");
		const engineOffered =
			webSpeechAvailable() || window.__KOKORO_READY === true;
		if (!root || !engineOffered) return this.settle(false);
		this.sentences = extractSentences(root);
		if (this.sentences.length === 0) return this.settle(false);

		const prefs = readStorage<Prefs>(PREFS_KEY, {});
		const savedRate = prefs.rate ?? 1;
		this.rate = RATES.includes(savedRate) ? savedRate : 1;
		this.voice = prefs.voice ?? null;
		this.bindControls();
		this.bindScrollTracking();
		this.setupMediaSession();

		// A saved neural choice loads without a dialog only when the visitor already consented on this device.
		// Page load never downloads. A stored neural voice is prepared (not initialised) and starts on first Play.
		const explicit = readStorage<EngineId | null>(CHOICE_KEY, null);
		const wantsNeural = explicit
			? explicit === "kokoro"
			: DEFAULT_ENGINE === "kokoro" &&
				!readStorage(SLOW_KEY, false) &&
				!sessionFallback &&
				!neuralCoolingDown();
		const wanted: EngineId = activeEngine
			? activeEngineId
			: wantsNeural &&
				  window.__KOKORO_READY === true &&
				  (explicit === "kokoro" || (await hasWebGpuAdapter()))
				? "kokoro"
				: "web-speech";
		// The placeholder holds the bar's space while the engine loads (a saved neural voice can take seconds).
		this.setAttribute("data-loading", "");
		this.removeAttribute("hidden");
		const engine =
			(await this.ensureEngine(wanted, false)) ?? (await this.activateWebSpeech());
		if (!engine) return this.settle(false);
		this.settle(true);
		this.observeDock();
		this.setIndex(0, false);
	}

	/** End the loading state: show the real bar, or hide the player when no engine can run. */
	private settle(show: boolean): void {
		this.removeAttribute("data-loading");
		this.toggleAttribute("hidden", !show);
		this.setAttribute("data-settled", "");
	}

	/* ---------- docking ---------- */

	/** A zero-height sentinel above the player: once it scrolls past the top of the viewport, the player docks. */
	private observeDock(): void {
		const sentinel = document.createElement("div");
		sentinel.className = "listen-sentinel";
		sentinel.setAttribute("aria-hidden", "true");
		this.before(sentinel);
		this.sentinel = sentinel;
		this.dockObserver = new IntersectionObserver(([entry]) => {
			this.setDocked(!entry.isIntersecting && entry.boundingClientRect.top < 0);
		});
		this.dockObserver.observe(sentinel);
	}

	private setDocked(docked: boolean): void {
		if (docked === this.hasAttribute("data-docked")) return;
		// Keep the flow height: the inline card and the docked row take the same space in the post.
		const flow =
			this.offsetHeight +
			Number.parseFloat(getComputedStyle(this).marginBottom);
		this.toggleAttribute("data-docked", docked);
		this.relocate(docked);
		this.style.marginBottom = docked ? `${flow - this.offsetHeight}px` : "";
		// Sentence follow and TOC jumps must land below the docked row.
		document.documentElement.style.scrollPaddingTop = docked
			? `${this.offsetHeight + 16}px`
			: "";
	}

	/** Moves the speed select and the slider between the inline bar and the docked row or dropdown. */
	private relocate(docked: boolean): void {
		const bar = this.need<HTMLElement>(".listen-bar");
		const panel = this.need<HTMLElement>("#listen-panel");
		const rate = this.need<HTMLElement>(".listen-rate");
		const range = this.need<HTMLElement>("[data-progress]");
		if (docked) {
			this.rateHome ??= rate.nextElementSibling;
			bar.insertBefore(rate, this.need("[data-follow]"));
			panel.prepend(range);
		} else {
			panel.insertBefore(rate, this.rateHome);
			bar.insertBefore(range, this.need("[data-position]"));
		}
	}

	/* ---------- engines ---------- */

	private async ensureEngine(id: EngineId, askConsent: boolean): Promise<TtsEngine | null> {
		if (id === "web-speech") return this.activateWebSpeech();
		// A second start during a download would open a second prompt or a second download.
		if (this.downloadAbort) {
			this.status("The neural voice is still downloading.");
			return null;
		}
		if (activeEngine && activeEngineId === "kokoro" && neuralReady) {
			this.syncEngineSelect("kokoro");
			return activeEngine;
		}
		let variant = await neuralVariant();
		if (!variant) {
			this.status("The neural voice needs WebGPU on this device.");
			this.syncEngineSelect(activeEngineId);
			return null;
		}
		try {
			let specs = await this.specsFor(variant);
			// A stored, size-checked copy is used with no prompt and no network. Otherwise the listener agrees first.
			if (!(await isCached(specs))) {
				if (!askConsent) {
					// Selected but not downloaded: nothing is fetched here. Play asks first.
					this.activate(await this.createNeural(), "kokoro");
					this.renderDownload();
					return activeEngine;
				}
				const choice = await this.confirmDownload();
				if (choice === "web") {
					writeStorage(CHOICE_KEY, "web-speech");
					return this.activateWebSpeech();
				}
				if (!choice) {
					// Cancelled: the browser voice for this page session only. Nothing persists.
					sessionFallback = true;
					return this.activateWebSpeech();
				}
				variant = choice;
				specs = await this.specsFor(variant);
				if (!(await this.download(specs, variant))) {
					sessionFallback = true;
					return this.activateWebSpeech("Download cancelled. Using the browser voice.");
				}
			}
			const engine = await this.createNeural();
			if (askConsent) {
				await this.initNeural(variant);
				clearNeuralFailures();
			}
			this.activate(engine, "kokoro");
			return engine;
		} catch (err) {
			// A failed start: the browser voice for this page session. Two in a row pause the default for 24 h.
			sessionFallback = true;
			recordNeuralFailure();
			return this.activateWebSpeech(
				`The neural voice is not available here (${errorText(err)}). Using the browser voice.`,
			);
		}
	}

	private async loadWebSpeech(): Promise<TtsEngine> {
		const engine = new WebSpeechEngine();
		await engine.init();
		return engine;
	}

	private async createNeural(): Promise<TtsEngine> {
		neuralEngine ??= await loadKokoroEngine(this.dataset.kokoroSrc ?? "/tts/kokoro.js");
		return neuralEngine;
	}

	/** Initialises the single neural engine once per page session. Reads only stored files. */
	private async initNeural(variant: KokoroVariant): Promise<void> {
		if (neuralReady) return;
		const engine = await this.createNeural();
		const manifest = await this.manifest();
		neuralInit ??= engine
			.init({
				variant,
				baseUrl: manifest.base,
				ortBase: new URL(this.dataset.kokoroOrt ?? "/tts/vendor/ort/", location.href).href,
			})
			.then(
				() => {
					neuralReady = true;
				},
				(err: unknown) => {
					neuralInit = null;
					throw err;
				},
			);
		await neuralInit;
	}

	private manifest(): Promise<Manifest> {
		manifestLoad ??= loadManifest(new URL(this.dataset.kokoroManifest ?? "/tts/manifest.json", location.href).href).catch(
			(err: unknown) => {
				manifestLoad = null;
				throw err;
			},
		);
		return manifestLoad;
	}

	private async specsFor(variant: KokoroVariant): Promise<FileSpec[]> {
		const ttsUrl = new URL(this.dataset.kokoroSrc ?? "/tts/kokoro.js", location.href).href;
		return buildSpecs(await this.manifest(), variant, ttsUrl);
	}

	/** Downloads the missing files with a progress bar and a cancel. Returns false when the listener cancels. */
	private async download(specs: FileSpec[], variant: KokoroVariant): Promise<boolean> {
		const controller = new AbortController();
		this.downloadAbort = controller;
		let stalled = false;
		this.renderDownload();
		try {
			await withStallGuard(
				(touch) =>
					downloadFiles(
						specs,
						(received, total) => {
							touch();
							this.setProgress(received / total);
						},
						controller.signal,
					),
				INIT_STALL_MS,
				() => {
					stalled = true;
					controller.abort();
				},
			);
		} catch (err) {
			if (controller.signal.aborted && !stalled) return false;
			throw stalled ? new Error("the download stalled") : err;
		} finally {
			this.downloadAbort = null;
		}
		writeStorage(CONSENT_KEY, variant);
		void requestPersistence();
		this.renderDownload();
		return true;
	}

	private setProgress(fraction: number): void {
		const bar = this.querySelector<HTMLProgressElement>("[data-download-bar]");
		if (bar) bar.value = Math.min(1, Math.max(0, fraction));
		this.renderDownload();
	}

	/** Shows what is stored, the size, the storage used, and the progress or the remove action. */
	private async renderDownload(): Promise<void> {
		const block = this.querySelector<HTMLElement>("[data-download]");
		if (!block) return;
		const variant = await neuralVariant();
		block.hidden = variant === null || window.__KOKORO_READY !== true;
		if (variant === null || block.hidden) return;
		const specs = await this.specsFor(variant);
		const megabytes = totalMB(specs);
		const downloading = this.downloadAbort !== null;
		const stored = !downloading && (await isCached(specs));
		const state = this.querySelector<HTMLElement>("[data-download-state]");
		if (state)
			state.textContent = downloading
				? `Downloading the neural voice (${megabytes} MB).`
				: stored
					? `Neural voice: downloaded (${megabytes} MB) and stored in this browser.`
					: `Neural voice: not downloaded (${megabytes} MB). It is fetched once, after you agree.`;
		const bar = this.querySelector<HTMLElement>("[data-download-bar]");
		if (bar) bar.hidden = !downloading;
		this.querySelector<HTMLElement>("[data-download-cancel]")?.toggleAttribute("hidden", !downloading);
		this.querySelector<HTMLElement>("[data-download-remove]")?.toggleAttribute("hidden", !stored);
		const usage = this.querySelector<HTMLElement>("[data-download-usage]");
		const used = await storageUsageMB();
		if (usage) {
			usage.hidden = used === null;
			usage.textContent = used === null ? "" : `Storage used by this site: ${used} MB.`;
		}
	}

	/** Removes the stored files. If the neural voice was playing, playback continues on the browser voice. */
	private async removeNeural(): Promise<void> {
		if (activeEngineId === "kokoro") {
			this.stopPlayback();
			this.setState("paused");
			await this.activateWebSpeech("Neural voice download removed. Using the browser voice.");
		}
		neuralEngine?.dispose();
		neuralEngine = null;
		neuralInit = null;
		neuralReady = false;
		await removeDownload();
		writeStorage(CONSENT_KEY, null);
		this.renderDownload();
	}

	/** Switches to the browser voice and returns the engine. A message, if given, is shown after the switch. */
	private async activateWebSpeech(message?: string): Promise<TtsEngine | null> {
		if (activeEngine && activeEngineId === "web-speech") {
			this.syncEngineSelect("web-speech");
		} else {
			try {
				this.activate(await this.loadWebSpeech(), "web-speech");
			} catch (err) {
				this.status(`The browser voice is not available: ${errorText(err)}`);
				return null;
			}
		}
		if (message) this.status(message);
		return activeEngine;
	}

	private activate(engine: TtsEngine, id: EngineId): void {
		// The neural engine is a session singleton: switching away must not dispose it.
		if (activeEngine !== engine && activeEngineId !== "kokoro") activeEngine?.dispose();
		activeEngine = engine;
		activeEngineId = id;
		const voices = engine.voices();
		// A voice from the other engine is not valid here: use this engine's default.
		if (!voices.some((v) => v.id === this.voice))
			this.voice =
				id === "kokoro" ? DEFAULT_VOICE : pickDefaultVoice(voices, document.documentElement.lang || "en");
		this.refreshEngineUI();
	}

	private async confirmDownload(): Promise<KokoroChoice | null> {
		const saved = readStorage<KokoroVariant | null>(CONSENT_KEY, null);
		if (saved) return saved;
		const dialog = this.querySelector<HTMLDialogElement>("[data-consent]");
		if (!dialog || typeof dialog.showModal !== "function") return null;
		// The GPU variant is only offered when this browser has a WebGPU adapter.
		const fast = dialog.querySelector<HTMLButtonElement>("[data-variant=fp32]");
		if (fast) fast.hidden = !(await hasWebGpuAdapter());
		// The CPU tier stays hidden until it is verified (see ListenPlayer.astro).
		const light = dialog.querySelector<HTMLButtonElement>("[data-variant=q8f16]");
		if (light) light.hidden = window.__KOKORO_CPU !== true;
		dialog.showModal();
		return new Promise((resolve) => {
			dialog.addEventListener(
				"close",
				() => {
					const value = dialog.returnValue;
					resolve(value === "fp32" || value === "q8f16" || value === "web" ? value : null);
				},
				{ once: true },
			);
		});
	}

	private refreshEngineUI(): void {
		const engine = activeEngine;
		if (!engine) return;
		this.syncEngineSelect(activeEngineId);
		const notice = this.querySelector<HTMLElement>("[data-notice]");
		if (notice) {
			notice.textContent = engine.notice ?? "";
			notice.hidden = !engine.notice;
		}
		const voices = engine.voices();
		const select = this.querySelector<HTMLSelectElement>("[data-voice]");
		if (select) {
			// The browser can list its voices late (Chrome fires voiceschanged after load). Keep the field in place
			// with the system default until they arrive, so the panel never collapses and then grows again.
			select.replaceChildren(
				...(voices.length === 0
					? [new Option("System default", "")]
					: voices.map(
							(v) =>
								new Option(
									`${v.name} (${v.lang})${v.local ? "" : " · remote"}`,
									v.id,
								),
						)),
			);
			select.disabled = voices.length === 0;
			select.value = voices.length === 0 ? "" : (this.voice ?? "");
		}
		const remote =
			activeEngineId === "web-speech" &&
			voices.find((v) => v.id === this.voice)?.local === false;
		this.need<HTMLElement>("[data-note-local]").hidden = remote;
		this.need<HTMLElement>("[data-note-remote]").hidden = !remote;
		const accel = this.need<HTMLElement>("[data-accel]");
		accel.textContent = accelerationLabel(engine.accelerator);
		accel.hidden = accel.textContent === "";
		this.status("");
	}

	private syncEngineSelect(id: EngineId): void {
		const select = this.querySelector<HTMLSelectElement>("[data-engine]");
		if (!select) return;
		const neural = select.querySelector<HTMLOptionElement>("option[value=kokoro]");
		if (neural) {
			const ready = window.__KOKORO_READY === true;
			neural.disabled = !ready;
			neural.textContent = ready ? "Neural voice" : "Neural voice (not available here)";
		}
		select.value = id;
		const wrap = select.closest<HTMLElement>("[data-engine-wrap]");
		if (wrap) wrap.hidden = false;
	}

	/* ---------- playback ---------- */

	private async play(): Promise<void> {
		if (this.state === "playing") return this.pause();
		// Create the AudioContext inside the click, before any await, so the browser allows it.
		if (!audioContext && typeof AudioContext !== "undefined")
			audioContext = new AudioContext();
		const wanted = this.querySelector<HTMLSelectElement>("[data-engine]")
			?.value as EngineId | undefined;
		const engine = await this.ensureEngine(wanted ?? activeEngineId, true);
		if (!engine) {
			this.syncEngineSelect(activeEngineId);
			return;
		}
		if (this.index >= this.sentences.length) this.index = 0;
		this.run(this.index);
	}

	private run(from: number): void {
		const engine = activeEngine;
		if (!engine) return;
		this.stopPlayback();
		const id = this.runId;
		const controller = new AbortController();
		this.abort = controller;
		this.setState("playing");
		void this.loop(engine, from, id, controller.signal);
	}

	private async loop(
		engine: TtsEngine,
		from: number,
		id: number,
		signal: AbortSignal,
	): Promise<void> {
		if (engine.id !== "web-speech") return this.loopStreamed(engine, from, id, signal);
		for (let i = from; i < this.sentences.length; i++) {
			if (id !== this.runId) return;
			this.setIndex(i, true);
			for (const unit of this.sentences[i].units) {
				try {
					await engine.speak(unit.text, { rate: this.rate, voice: this.voice, signal });
				} catch (err) {
					if (id === this.runId) this.fail(err);
					return;
				}
				if (id !== this.runId) return;
			}
		}
		this.finish(id);
	}

	/**
	 * Neural voice: one producer synthesises ahead of playback and every chunk is scheduled on the AudioContext
	 * clock (see playback.ts). Nothing waits for a sentence to finish before the next one is synthesised.
	 */
	private async loopStreamed(
		engine: TtsEngine,
		from: number,
		id: number,
		signal: AbortSignal,
	): Promise<void> {
		if (!audioContext) return this.fail(new Error("AudioContext is not available"));
		const monitor = new SpeedMonitor(() => this.neuralTooSlow(id));
		const pipeline = new Pipeline(audioContext, signal, {
			onSentence: (i) => {
				if (id === this.runId) this.setIndex(i, true);
			},
			onBuffering: (waiting) => this.status(waiting ? "Buffering…" : ""),
			onChunk: (durationS, ahead, first) => monitor.chunk(durationS, ahead < UNDERRUN_S && !first, first),
		});
		try {
			for (let i = from; i < this.sentences.length; i++) {
				for (const unit of this.sentences[i].units) {
					const out = engine.speak(unit.text, { rate: this.rate, voice: this.voice, signal });
					if (!isStream(out)) {
						await out;
						continue;
					}
					for await (const chunk of out) {
						if (id !== this.runId) return;
						await pipeline.push(chunk, i);
					}
					if (id !== this.runId) return;
				}
				// Punctuation pause after the sentence, from the text and its block (see pauses.ts).
				const next = this.sentences[i + 1];
				const pause = pauseAfter({
					tag: this.sentences[i].block.tagName,
					endsBlock: !next || next.block !== this.sentences[i].block,
				});
				pipeline.silence(scaledPause(pause, this.rate), i);
			}
			await pipeline.drain();
		} catch (err) {
			if (id === this.runId) this.fail(err);
			return;
		}
		this.finish(id);
	}

	private finish(id: number): void {
		if (id !== this.runId) return;
		this.setState("idle");
		this.setIndex(0, false);
		this.status("Finished. Press play to listen again.");
	}

	private fail(err: unknown): void {
		this.state = "paused";
		this.setState("paused");
		const blocked = errorText(err).includes("not-allowed");
		this.status(
			blocked
				? "The browser blocked speech. Press play to try again."
				: `Playback stopped: ${errorText(err)}`,
		);
	}

	/** Stops audio and invalidates the running loop. Does not change the position. */
	private stopPlayback(): void {
		this.runId++;
		this.abort?.abort();
		this.abort = null;
		activeEngine?.cancel();
	}

	private pause(): void {
		this.stopPlayback();
		this.setState("paused");
	}

	private seek(i: number): void {
		const next = Math.min(Math.max(i, 0), this.sentences.length - 1);
		if (this.state === "playing") this.run(next);
		else this.setIndex(next, false);
	}

	private stop(): void {
		this.stopPlayback();
		this.setState("idle");
		this.setIndex(0, false);
	}

	private setState(state: PlayState): void {
		this.state = state;
		this.dataset.state = state;
		const playing = state === "playing";
		this.need<HTMLElement>("[data-icon-play]").hidden = playing;
		this.need<HTMLElement>("[data-icon-pause]").hidden = !playing;
		this.need<HTMLButtonElement>("[data-action=play]").setAttribute(
			"aria-label",
			playing ? "Pause" : "Play",
		);
		if (navigator.mediaSession) {
			navigator.mediaSession.playbackState = playing
				? "playing"
				: state === "paused"
					? "paused"
					: "none";
		}
	}

	/* ---------- highlight and position ---------- */

	private setIndex(i: number, follow: boolean): void {
		this.index = i;
		const sentence = this.sentences[i];
		if (!sentence) return;
		if (CAN_HIGHLIGHT) {
			if (sentence.range)
				CSS.highlights.set(HIGHLIGHT, new Highlight(sentence.range));
			else CSS.highlights.delete(HIGHLIGHT);
		}
		if (this.activeBlock !== sentence.block) {
			this.activeBlock?.removeAttribute("data-listen-current");
			this.activeBlock?.classList.remove("listen-active");
			this.activeBlock = sentence.block;
		}
		sentence.block.setAttribute("data-listen-current", sentence.id);
		if (!CAN_HIGHLIGHT) sentence.block.classList.add("listen-active");
		const progress = this.need<HTMLInputElement>("[data-progress]");
		progress.max = String(this.sentences.length - 1);
		progress.value = String(i);
		this.need<HTMLElement>("[data-position]").textContent =
			`${i + 1} / ${this.sentences.length}`;
		if (follow) this.followCurrent(false);
		this.updateFollowButton();
	}

	private isBlockVisible(block: HTMLElement): boolean {
		const r = block.getBoundingClientRect();
		return r.top >= 96 && r.bottom <= window.innerHeight - 96;
	}

	/** Scrolls to the current sentence unless the reader has scrolled away recently. */
	private followCurrent(force: boolean): void {
		const block = this.activeBlock;
		if (!block || this.isBlockVisible(block)) return;
		const readerScrolling = Date.now() - this.lastUserScroll < FOLLOW_PAUSE_MS;
		if (readerScrolling && !force) return;
		const reduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		this.programmaticUntil = Date.now() + 1200;
		block.scrollIntoView({
			block: "center",
			behavior: reduced ? "auto" : "smooth",
		});
	}

	private updateFollowButton(): void {
		const block = this.activeBlock;
		const away = !!block && !this.isBlockVisible(block);
		const button = this.querySelector<HTMLElement>("[data-follow]");
		if (button) button.hidden = !away || this.sentences.length === 0;
	}

	private bindScrollTracking(): void {
		const onUser = (): void => {
			if (Date.now() < this.programmaticUntil) return;
			this.lastUserScroll = Date.now();
		};
		const onScroll = (): void => {
			onUser();
			cancelAnimationFrame(this.frame);
			this.frame = requestAnimationFrame(() => this.updateFollowButton());
		};
		const onKey = (e: KeyboardEvent): void => {
			if (
				[
					"ArrowDown",
					"ArrowUp",
					"PageDown",
					"PageUp",
					" ",
					"Home",
					"End",
				].includes(e.key)
			)
				onUser();
		};
		window.addEventListener("wheel", onUser, { passive: true });
		window.addEventListener("touchmove", onUser, { passive: true });
		window.addEventListener("keydown", onKey);
		window.addEventListener("scroll", onScroll, { passive: true });
		this.teardown.push(() => {
			window.removeEventListener("wheel", onUser);
			window.removeEventListener("touchmove", onUser);
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("scroll", onScroll);
		});
	}

	/* ---------- controls ---------- */

	private bindControls(): void {
		const on = <T extends Element>(
			sel: string,
			type: string,
			fn: (el: T, e: Event) => void,
		): void => {
			const el = this.querySelector<T>(sel);
			el?.addEventListener(type, (e) => fn(el, e));
		};
		on<HTMLButtonElement>(
			"[data-action=play]",
			"click",
			() => void this.play(),
		);
		on<HTMLButtonElement>("[data-action=prev]", "click", () =>
			this.seek(this.index - 1),
		);
		on<HTMLButtonElement>("[data-action=next]", "click", () =>
			this.seek(this.index + 1),
		);
		on<HTMLInputElement>("[data-progress]", "input", (el) =>
			this.setIndex(Number(el.value), false),
		);
		on<HTMLInputElement>("[data-progress]", "change", (el) =>
			this.seek(Number(el.value)),
		);
		on<HTMLSelectElement>("[data-rate]", "change", (el) => {
			this.rate = Number(el.value);
			writeStorage(PREFS_KEY, {
				engine: activeEngineId,
				voice: this.voice,
				rate: this.rate,
			});
			if (this.state === "playing") this.run(this.index);
		});
		on<HTMLSelectElement>("[data-voice]", "change", (el) => {
			this.voice = el.value;
			writeStorage(PREFS_KEY, {
				engine: activeEngineId,
				voice: this.voice,
				rate: this.rate,
			});
			if (this.state === "playing") this.run(this.index);
		});
		on<HTMLButtonElement>("[data-download-cancel]", "click", () => this.downloadAbort?.abort());
		on<HTMLButtonElement>("[data-download-remove]", "click", () => void this.removeNeural());
		on<HTMLButtonElement>("[data-slow-browser]", "click", () => void this.leaveNeural());
		on<HTMLButtonElement>("[data-slow-wait]", "click", () => this.keepWaiting());
		on<HTMLSelectElement>(
			"[data-engine]",
			"change",
			(el) => void this.switchEngine(el.value as EngineId),
		);
		on<HTMLButtonElement>("[data-toggle]", "click", (el) => {
			const open = !this.hasAttribute("data-open");
			this.toggleAttribute("data-open", open);
			el.setAttribute("aria-expanded", String(open));
		});
		on<HTMLButtonElement>("[data-follow]", "click", () => {
			this.lastUserScroll = 0;
			this.followCurrent(true);
		});

		const rate = this.querySelector<HTMLSelectElement>("[data-rate]");
		if (rate) {
			rate.replaceChildren(...RATES.map((r) => new Option(`${r}x`, String(r))));
			rate.value = String(this.rate);
		}
		this.syncEngineSelect(activeEngineId);
		if (webSpeechAvailable()) {
			const onVoices = (): void => {
				if (activeEngineId === "web-speech" && activeEngine)
					this.refreshEngineUI();
			};
			speechSynthesis.addEventListener("voiceschanged", onVoices);
			this.teardown.push(() =>
				speechSynthesis.removeEventListener("voiceschanged", onVoices),
			);
		}
		this.setState("idle");
	}

	/** The neural voice fell behind: pause, remember it for this device, and offer the browser voice. */
	private neuralTooSlow(runId: number): void {
		if (runId !== this.runId || this.slowAcknowledged) return;
		writeStorage(SLOW_KEY, true);
		this.stopPlayback();
		this.setState("paused");
		this.need<HTMLElement>("[data-slow]").hidden = false;
		this.status("");
	}

	/** Continues from the current sentence on the browser voice. */
	private async leaveNeural(): Promise<void> {
		this.need<HTMLElement>("[data-slow]").hidden = true;
		await this.switchEngine("web-speech");
		this.run(this.index);
	}

	/** Keeps the neural voice for this sentence list and stops offering the switch. */
	private keepWaiting(): void {
		this.need<HTMLElement>("[data-slow]").hidden = true;
		this.slowAcknowledged = true;
		this.run(this.index);
	}

	private async switchEngine(id: EngineId): Promise<void> {
		const wasPlaying = this.state === "playing";
		this.stopPlayback();
		const engine = await this.ensureEngine(id, true);
		if (!engine) {
			this.syncEngineSelect(activeEngineId);
			return;
		}
		this.setState("paused");
		// Save the engine that is active, which can differ from the one asked for (browser voice chosen at the prompt).
		writeStorage(PREFS_KEY, { engine: activeEngineId, voice: this.voice, rate: this.rate });
		// Only an engine the listener really asked for is an explicit choice (a cancelled prompt is not).
		if (activeEngineId === id) writeStorage(CHOICE_KEY, id);
		if (wasPlaying) this.run(this.index);
	}

	private need<T extends Element>(selector: string): T {
		const el = this.querySelector<T>(selector);
		if (!el) throw new Error(`listen-player: missing ${selector}`);
		return el;
	}

	private status(text: string): void {
		const el = this.querySelector<HTMLElement>("[data-status]");
		if (el) el.textContent = text;
	}

	/* ---------- lock screen ---------- */

	private setupMediaSession(): void {
		const session = navigator.mediaSession;
		if (!session || typeof MediaMetadata === "undefined") return;
		const author =
			document.querySelector<HTMLMetaElement>('meta[name="author"]')?.content ??
			"";
		session.metadata = new MediaMetadata({
			title: this.dataset.title ?? document.title,
			artist: author,
		});
		const actions: Array<[MediaSessionAction, () => void]> = [
			["play", () => void this.play()],
			["pause", () => this.pause()],
			["previoustrack", () => this.seek(this.index - 1)],
			["nexttrack", () => this.seek(this.index + 1)],
			["stop", () => this.stop()],
		];
		for (const [action, handler] of actions) {
			try {
				session.setActionHandler(action, handler);
			} catch {
				// Browser does not support this action.
			}
		}
	}
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

if (!customElements.get("listen-player"))
	customElements.define("listen-player", ListenPlayer);
