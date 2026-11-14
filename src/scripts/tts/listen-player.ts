/**
 * <listen-player>: reads the post aloud sentence by sentence, in the visitor's browser.
 *
 * Light DOM, progressive enhancement: the component ships `hidden`, and this script removes that only when the
 * neural voice (Kokoro) can run. Without JavaScript, or without WebGPU, the player never appears.
 * Engine contract: engine.ts. The engine outlives the element, so a Swup page change keeps a loaded model.
 */
import { type AudioChunk, accelerationLabel, type TtsEngine } from "./engine";
import lexicon from "../../data/pronunciations.json";
import { extractSentences, type Sentence } from "./extract";
import {
	lexiconMap,
	mergePronunciations,
	type Pronunciations,
} from "./pronounce";
import type { FileSpec, KokoroVariant, Manifest } from "./kokoro-cache";
import { pauseAfter, scaledPause } from "./pauses";

/**
 * The neural-voice cluster (Kokoro engine, its download/cache, and the streamed-audio pipeline) loads after the
 * page, not with it: posts that never play pay nothing for it.
 */
type NeuralModule = typeof import("./kokoro-engine") &
	typeof import("./kokoro-cache") &
	typeof import("./playback");
let neuralModule: Promise<NeuralModule> | null = null;
function neural(): Promise<NeuralModule> {
	neuralModule ??= Promise.all([
		import("./kokoro-engine"),
		import("./kokoro-cache"),
		import("./playback"),
	]).then(([engine, cache, playback]) => ({ ...engine, ...cache, ...playback }));
	return neuralModule;
}

/** Words the voice mispronounces (src/data/pronunciations.json). */
const GLOBAL_PRONUNCIATIONS = lexiconMap(lexicon.entries);

/** Neural-voice speed guard. Past these the player says gaps may follow; playback never pauses for it. */
const SLOW_FIRST_AUDIO_MS = 8000;
/** Average generation time over the last chunks, divided by their audio length. Above 1 the voice falls behind. */
const SLOW_RTF = 1;
/** Chunks in a row where playback caught up with generation. */
const SLOW_STALLS = 2;
/** A model download with no progress for this long counts as failed. */
const INIT_STALL_MS = 30000;
type PlayState = "idle" | "playing" | "paused";

declare global {
	interface Window {
		__KOKORO_READY?: boolean;
		__KOKORO_CPU?: boolean;
	}
}

const PREFS_KEY = "listen-prefs";
const CONSENT_KEY = "listen-kokoro-consent";
const DEFAULT_VOICE = "af_heart";
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const FOLLOW_PAUSE_MS = 4000;
const HIGHLIGHT = "listen-current";
const CAN_HIGHLIGHT =
	typeof CSS !== "undefined" &&
	"highlights" in CSS &&
	typeof Highlight !== "undefined";

interface Prefs {
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

/**
 * "none": the browser has no WebGPU. "blocked": it has WebGPU but gives no adapter. Chrome does that after a GPU
 * reset or while its GPU process restarts, so it can be momentary: ask once more before giving up.
 */
type WebGpu = "ready" | "none" | "blocked";

async function webGpu(): Promise<WebGpu> {
	const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
	if (!gpu) return "none";
	for (const wait of [0, 1000]) {
		if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
		try {
			if (await gpu.requestAdapter()) return "ready";
		} catch {
			// Counts as no adapter.
		}
	}
	return "blocked";
}

// The active engine lives at module level: it survives Swup page changes, so a loaded model is reused.
let activeEngine: TtsEngine | null = null;
/**
 * One neural engine per page session: created on first use, initialised once, kept across Swup visits.
 * The load promise is cached, not the engine, so concurrent callers share one module load and one engine.
 */
let neuralLoad: Promise<TtsEngine> | null = null;
let neuralInit: Promise<void> | null = null;
/** An in-flight consented preparation (prompt, download, init), shared by every caller. */
let neuralPrepare: Promise<TtsEngine | null> | null = null;
/** The player whose actions the lock screen calls. Media session handlers are global and last-set wins. */
let mediaOwner: HTMLElement | null = null;
const MEDIA_ACTIONS: MediaSessionAction[] = ["play", "pause", "previoustrack", "nexttrack", "stop"];
let neuralReady = false;
let manifestLoad: Promise<Manifest> | null = null;

/** WebGPU gives the GPU model. The CPU model (fp16, Brev's CPU default) is used only when its flag is set: it still runs slower than real time and produces NaN chunks. */
async function neuralVariant(gpu?: WebGpu): Promise<KokoroVariant | null> {
	if ((gpu ?? (await webGpu())) === "ready") return "fp32";
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
	/** Set when the listener dismisses the slow notice: it is not shown again on this page. */
	private slowAcknowledged = false;
	private downloadAbort: AbortController | null = null;
	/** The download block paint in flight, and whether another is due after it (see renderDownload). */
	private painting: Promise<void> | null = null;
	private repaint = false;
	private abort: AbortController | null = null;
	private activeBlock: HTMLElement | null = null;
	private lastUserScroll = 0;
	private programmaticUntil = 0;
	private frame = 0;
	/** Lives from connect to disconnect. Every listener is bound to it; a reconnect aborts the old one first. */
	private life: AbortController | null = null;
	/** Set while a Play click waits for its engine, so a second click cannot start a second load. */
	private starting = false;
	private dockObserver: IntersectionObserver | null = null;
	private sentinel: HTMLElement | null = null;
	private rateHome: Element | null = null;

	// The element can be disconnected and reconnected without leaving the page: OverlayScrollbars moves every
	// body child into its viewport on a hard load (classic scrollbars only). Each connection gets one lifetime,
	// so a move never leaves two sets of handlers behind.
	connectedCallback(): void {
		this.life?.abort();
		this.life = new AbortController();
		void this.init(this.life.signal);
	}

	disconnectedCallback(): void {
		this.life?.abort();
		this.life = null;
		this.starting = false;
		this.stopPlayback();
		this.activeBlock?.removeAttribute("data-listen-current");
		this.activeBlock?.classList.remove("listen-active");
		this.activeBlock = null;
		if (CAN_HIGHLIGHT) CSS.highlights.delete(HIGHLIGHT);
		this.dockObserver?.disconnect();
		this.dockObserver = null;
		this.sentinel?.remove();
		this.sentinel = null;
		if (this.hasAttribute("data-docked")) this.relocate(false);
		this.removeAttribute("data-docked");
		this.style.marginBottom = "";
		document.documentElement.style.scrollPaddingTop = "";
	}

	/** Global lexicon, then the post's `pronounce:` front matter (data-pronounce), which wins. */
	private pronunciations(): Pronunciations {
		let post: Pronunciations | null = null;
		try {
			post = JSON.parse(this.dataset.pronounce ?? "null");
		} catch {
			post = null;
		}
		return mergePronunciations(GLOBAL_PRONUNCIATIONS, post);
	}

	private async init(signal: AbortSignal): Promise<void> {
		const root = document.querySelector<HTMLElement>(this.dataset.target ?? "");
		if (!root || window.__KOKORO_READY !== true) return this.settle(false);
		this.sentences = extractSentences(root, this.pronunciations());
		if (this.sentences.length === 0) return this.settle(false);
		// No WebGPU at all (and no CPU tier): the neural voice cannot run here, so there is no player. A blocked
		// adapter can be momentary, so that case keeps the player and says why (prepareNeural).
		const gpu = await webGpu();
		if (signal.aborted) return;
		if (gpu === "none" && !(await neuralVariant(gpu))) return this.settle(false);

		const prefs = readStorage<Prefs>(PREFS_KEY, {});
		const savedRate = prefs.rate ?? 1;
		this.rate = RATES.includes(savedRate) ? savedRate : 1;
		this.voice = prefs.voice ?? null;
		this.bindControls(signal);
		this.bindScrollTracking(signal);
		this.setupMediaSession(signal);

		// The placeholder holds the bar's space while the engine loads (a stored voice can take seconds).
		this.setAttribute("data-loading", "");
		this.removeAttribute("hidden");
		// Page load never downloads and never asks. A stored voice is loaded (not initialised) and starts on first
		// Play; otherwise Play asks first. Without an engine (blocked GPU, failed load) the bar shows why.
		await this.ensureEngine(false, gpu);
		// A newer connection (or a disconnect) owns the element now: it settles the player, and this run must not
		// add a second sentinel.
		if (signal.aborted) return;
		this.settle(true);
		this.observeDock();
		this.setIndex(0, false);
	}

	/** End the loading state: show the real bar, or hide the player when the voice cannot run. */
	private settle(show: boolean): void {
		this.removeAttribute("data-loading");
		this.toggleAttribute("hidden", !show);
		this.setAttribute("data-settled", "");
	}

	/* ---------- docking ---------- */

	/** A zero-height sentinel above the player: once it scrolls past the top of the viewport, the player docks. */
	private observeDock(): void {
		this.dockObserver?.disconnect();
		this.sentinel?.remove();
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

	/** `gpu`: an adapter probe the caller already made (page load), so it is not asked twice. Play always asks fresh. */
	private async ensureEngine(askConsent: boolean, gpu?: WebGpu): Promise<TtsEngine | null> {
		// A second start during a download would open a second prompt or a second download.
		if (this.downloadAbort) {
			this.status("The neural voice is still downloading.");
			return null;
		}
		if (activeEngine && neuralReady) return activeEngine;
		if (!askConsent) return this.prepareNeural(false, gpu);
		// One consent prompt and one download at a time: a Play click during a voice switch waits for the switch.
		neuralPrepare ??= this.prepareNeural(true).finally(() => {
			neuralPrepare = null;
		});
		return neuralPrepare;
	}

	/** Gets the neural engine ready: checks storage, asks and downloads when allowed, loads and (if asked) initialises. */
	private async prepareNeural(askConsent: boolean, probed?: WebGpu): Promise<TtsEngine | null> {
		const n = await neural();
		// Problems are reported only when the reader pressed Play. At page load the bar must settle at the skeleton's
		// size: a status line written then shifts the post after load (check:navigation caught it, CI has no GPU).
		const tell = (text: string): void => {
			if (askConsent) this.status(text);
		};
		const gpu = probed ?? (await webGpu());
		let variant = await neuralVariant(gpu);
		if (!variant) {
			tell(
				gpu === "none"
					? "The neural voice needs WebGPU, and this browser has none."
					: "The browser gave this page no GPU just now. Reload, or restart the browser, to use the neural voice.",
			);
			return null;
		}
		try {
			let specs = await this.specsFor(variant);
			// A stored, size-checked copy is used with no prompt and no network. Otherwise the listener agrees first.
			// Both the model and the ONNX Runtime binary must be stored; otherwise the listener agrees first.
			if (!((await n.isCached(specs)) && (await this.runtimeCached()))) {
				if (!askConsent) {
					// Not downloaded: nothing is fetched here. Play asks first.
					this.activate(await this.createNeural());
					this.renderDownload();
					return activeEngine;
				}
				const choice = await this.confirmDownload();
				if (!choice) {
					this.status("Nothing downloaded. Press play to choose again.");
					return null;
				}
				variant = choice;
				specs = await this.specsFor(variant);
				if (!(await this.download(specs, variant))) {
					this.status("Download cancelled. Press play to start it again.");
					return null;
				}
			}
			const engine = await this.createNeural();
			if (askConsent) await this.initNeural(variant);
			this.activate(engine);
			return engine;
		} catch (err) {
			// Play tries again: a stored copy is reused, and a broken load is retried (see createNeural, initNeural).
			tell(`The neural voice could not start (${errorText(err)}). Press play to try again.`);
			return null;
		}
	}

	/** Loads the single neural engine. Concurrent callers share one load; a failed load can be retried. */
	private async createNeural(): Promise<TtsEngine> {
		const n = await neural();
		// Absolute URL: in dev, Vite tags a root-relative dynamic import with ?import and then refuses the public file.
		neuralLoad ??= n.loadKokoroEngine(this.ttsSrc()).catch((err: unknown) => {
			neuralLoad = null;
			throw err;
		});
		return neuralLoad;
	}

	/** Initialises the single neural engine once per page session. Reads only stored files. Single-flight. */
	private async initNeural(variant: KokoroVariant): Promise<void> {
		const n = await neural();
		if (neuralReady) return;
		if (neuralInit) return neuralInit;
		const run: Promise<void> = (async () => {
			const engine = await this.createNeural();
			// Reads the stored binary (no network after the first download) and gives it to ONNX Runtime before init.
			await n.prepareOrtRuntime(this.ttsSrc());
			const manifest = await this.manifest();
			await engine.init({
				variant,
				baseUrl: manifest.base,
				ortBase: new URL(this.dataset.kokoroOrt ?? "/tts/vendor/ort/", location.href).href,
				// extract.ts already normalises for speech; the engine must not do it a second time.
				normalize: false,
			});
		})().then(
			() => {
				// removeNeural() may have dropped this engine while it initialised.
				if (neuralInit === run) neuralReady = true;
			},
			(err: unknown) => {
				if (neuralInit === run) neuralInit = null;
				throw err;
			},
		);
		neuralInit = run;
		return run;
	}

	private ttsSrc(): string {
		return new URL(this.dataset.kokoroSrc ?? "/tts/kokoro.js", location.href).href;
	}

	private async runtimeCached(): Promise<boolean> {
		const n = await neural();
		return (await n.loadOrtRuntime(this.ttsSrc())).ortRuntimeCached();
	}

	private async manifest(): Promise<Manifest> {
		const n = await neural();
		manifestLoad ??= n.loadManifest(new URL(this.dataset.kokoroManifest ?? "/tts/manifest.json", location.href).href).catch(
			(err: unknown) => {
				manifestLoad = null;
				throw err;
			},
		);
		return manifestLoad;
	}

	private async specsFor(variant: KokoroVariant): Promise<FileSpec[]> {
		const n = await neural();
		const ttsUrl = new URL(this.dataset.kokoroSrc ?? "/tts/kokoro.js", location.href).href;
		return n.specsFor(await this.manifest(), variant, ttsUrl);
	}

	/** Downloads the missing files with a progress bar and a cancel. Returns false when the listener cancels. */
	private async download(specs: FileSpec[], variant: KokoroVariant): Promise<boolean> {
		const n = await neural();
		const controller = new AbortController();
		this.downloadAbort = controller;
		let stalled = false;
		this.renderDownload();
		try {
			await withStallGuard(
				async (touch) => {
					// The runtime is fetched first (pinned host, checked), then the model files.
					this.status("Downloading the neural voice runtime.");
					await n.prepareOrtRuntime(this.ttsSrc(), () => touch(), controller.signal);
					await n.download(
						specs,
						(received, total) => {
							touch();
							this.setProgress(received / total);
						},
						controller.signal,
					);
				},
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
		void n.requestPersistence();
		this.renderDownload();
		return true;
	}

	private setProgress(fraction: number): void {
		const bar = this.querySelector<HTMLProgressElement>("[data-download-bar]");
		if (bar) bar.value = Math.min(1, Math.max(0, fraction));
		this.renderDownload();
	}

	/**
	 * Repaints the download block. Coalesced: progress fires per network chunk (thousands of times for the model), so
	 * at most one paint runs and one more follows it, never one async storage probe per chunk.
	 */
	private renderDownload(): Promise<void> {
		if (this.painting) {
			this.repaint = true;
			return this.painting;
		}
		this.painting = (async () => {
			try {
				do {
					this.repaint = false;
					await this.paintDownload();
				} while (this.repaint);
			} finally {
				this.painting = null;
			}
		})();
		return this.painting;
	}

	/** Shows what is stored, the size, the storage used, and the progress or the remove action. */
	private async paintDownload(): Promise<void> {
		const block = this.querySelector<HTMLElement>("[data-download]");
		if (!block) return;
		const variant = await neuralVariant();
		block.hidden = variant === null || window.__KOKORO_READY !== true;
		if (variant === null || block.hidden) return;
		const n = await neural();
		const specs = await this.specsFor(variant);
		const megabytes = n.totalMB(specs);
		const downloading = this.downloadAbort !== null;
		const stored = !downloading && (await n.isCached(specs));
		const runtime = await this.runtimeCached();
		const runtimeState = this.querySelector<HTMLElement>("[data-runtime-state]");
		if (runtimeState)
			runtimeState.textContent = runtime
				? "Runtime (ONNX Runtime 1.27.0, 24 MB): stored in this browser."
				: "Runtime (ONNX Runtime 1.27.0, 24 MB): not downloaded.";
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
		const used = await n.storageUsageMB();
		if (usage) {
			usage.hidden = used === null;
			usage.textContent = used === null ? "" : `Storage used by this site: ${used} MB.`;
		}
	}

	/** Removes the stored files and stops playback. Play asks again before downloading. */
	private async removeNeural(): Promise<void> {
		const n = await neural();
		if (this.state === "playing") this.setState("paused");
		this.stopPlayback();
		const loading = neuralLoad;
		neuralLoad = null;
		neuralInit = null;
		activeEngine = null;
		void loading?.then((engine) => engine.dispose(), () => {});
		neuralReady = false;
		await n.removeDownload();
		await (await n.loadOrtRuntime(this.ttsSrc())).removeOrtRuntime();
		writeStorage(CONSENT_KEY, null);
		this.status("Neural voice download removed. Press play to download it again.");
		this.renderDownload();
	}

	private activate(engine: TtsEngine): void {
		activeEngine = engine;
		if (!engine.voices().some((v) => v.id === this.voice)) this.voice = DEFAULT_VOICE;
		this.refreshEngineUI();
	}

	private async confirmDownload(): Promise<KokoroVariant | null> {
		const saved = readStorage<KokoroVariant | null>(CONSENT_KEY, null);
		if (saved) return saved;
		const dialog = this.querySelector<HTMLDialogElement>("[data-consent]");
		if (!dialog || typeof dialog.showModal !== "function") return null;
		// The GPU variant is only offered when this browser has a WebGPU adapter.
		const fast = dialog.querySelector<HTMLButtonElement>("[data-variant=fp32]");
		if (fast) fast.hidden = (await webGpu()) !== "ready";
		// The CPU tier stays hidden until it is verified (see ListenPlayer.astro).
		const light = dialog.querySelector<HTMLButtonElement>("[data-variant=q8f16]");
		if (light) light.hidden = window.__KOKORO_CPU !== true;
		dialog.showModal();
		return new Promise((resolve) => {
			dialog.addEventListener(
				"close",
				() => {
					const value = dialog.returnValue;
					resolve(value === "fp32" || value === "q8f16" ? value : null);
				},
				{ once: true },
			);
		});
	}

	private refreshEngineUI(): void {
		const engine = activeEngine;
		if (!engine) return;
		const notice = this.querySelector<HTMLElement>("[data-notice]");
		if (notice) {
			notice.textContent = engine.notice ?? "";
			notice.hidden = !engine.notice;
		}
		const voices = engine.voices();
		const select = this.querySelector<HTMLSelectElement>("[data-voice]");
		if (select) {
			select.replaceChildren(...voices.map((v) => new Option(`${v.name} (${v.lang})`, v.id)));
			select.disabled = voices.length === 0;
			select.value = this.voice ?? "";
		}
		const accel = this.need<HTMLElement>("[data-accel]");
		accel.textContent = accelerationLabel(engine.accelerator);
		accel.hidden = accel.textContent === "";
		this.status("");
	}

	/* ---------- playback ---------- */

	private async play(): Promise<void> {
		if (this.state === "playing") return this.pause();
		// A click while the engine loads must not start a second load (or a second download).
		if (this.starting) return;
		// Create the AudioContext inside the click, before any await, so the browser allows it.
		if (!audioContext && typeof AudioContext !== "undefined")
			audioContext = new AudioContext();
		const life = this.life;
		this.starting = true;
		let engine: TtsEngine | null;
		try {
			engine = await this.ensureEngine(true);
		} finally {
			if (life === this.life) this.starting = false;
		}
		if (!life || life.signal.aborted || !engine) return;
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

	/**
	 * One producer synthesises ahead of playback and every chunk is scheduled on the AudioContext clock (see
	 * playback.ts). Nothing waits for a sentence to finish before the next one is synthesised.
	 */
	private async loop(
		engine: TtsEngine,
		from: number,
		id: number,
		signal: AbortSignal,
	): Promise<void> {
		if (!audioContext) return this.fail(new Error("AudioContext is not available"));
		const n = await neural();
		const monitor = new SpeedMonitor(() => this.neuralTooSlow(id));
		const pipeline = new n.Pipeline(audioContext, signal, {
			onSentence: (i) => {
				if (id === this.runId) this.setIndex(i, true);
			},
			onChunk: (durationS, ahead, first) => monitor.chunk(durationS, ahead < n.UNDERRUN_S && !first, first),
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
				? "The browser blocked audio. Press play to try again."
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

	private bindScrollTracking(signal: AbortSignal): void {
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
		window.addEventListener("wheel", onUser, { passive: true, signal });
		window.addEventListener("touchmove", onUser, { passive: true, signal });
		window.addEventListener("keydown", onKey, { signal });
		window.addEventListener("scroll", onScroll, { passive: true, signal });
		signal.addEventListener("abort", () => cancelAnimationFrame(this.frame), { once: true });
	}

	/* ---------- controls ---------- */

	private bindControls(signal: AbortSignal): void {
		const on = <T extends Element>(
			sel: string,
			type: string,
			fn: (el: T, e: Event) => void,
		): void => {
			const el = this.querySelector<T>(sel);
			el?.addEventListener(type, (e) => fn(el, e), { signal });
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
			writeStorage(PREFS_KEY, { voice: this.voice, rate: this.rate });
			if (this.state === "playing") this.run(this.index);
		});
		on<HTMLSelectElement>("[data-voice]", "change", (el) => {
			this.voice = el.value;
			writeStorage(PREFS_KEY, { voice: this.voice, rate: this.rate });
			if (this.state === "playing") this.run(this.index);
		});
		on<HTMLButtonElement>("[data-download-cancel]", "click", () => this.downloadAbort?.abort());
		on<HTMLButtonElement>("[data-download-remove]", "click", () => void this.removeNeural());
		on<HTMLButtonElement>("[data-slow-keep]", "click", () => this.dismissSlow());
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
		this.setState("idle");
	}

	/** The neural voice fell behind: say gaps may follow. Audio keeps playing. */
	private neuralTooSlow(runId: number): void {
		if (runId !== this.runId || this.slowAcknowledged) return;
		this.need<HTMLElement>("[data-slow]").hidden = false;
	}

	/** Hides the slow notice for the rest of this page. Playback is not touched. */
	private dismissSlow(): void {
		this.need<HTMLElement>("[data-slow]").hidden = true;
		this.slowAcknowledged = true;
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

	private setupMediaSession(signal: AbortSignal): void {
		const session = navigator.mediaSession;
		if (!session || typeof MediaMetadata === "undefined") return;
		const author =
			document.querySelector<HTMLMetaElement>('meta[name="author"]')?.content ??
			"";
		session.metadata = new MediaMetadata({
			title: this.dataset.title ?? document.title,
			artist: author,
		});
		const handlers: Partial<Record<MediaSessionAction, () => void>> = {
			play: () => void this.play(),
			pause: () => this.pause(),
			previoustrack: () => this.seek(this.index - 1),
			nexttrack: () => this.seek(this.index + 1),
			stop: () => this.stop(),
		};
		const set = (handler: (action: MediaSessionAction) => (() => void) | null): void => {
			for (const action of MEDIA_ACTIONS) {
				try {
					session.setActionHandler(action, handler(action));
				} catch {
					// Browser does not support this action.
				}
			}
		};
		mediaOwner = this;
		set((action) => handlers[action] ?? null);
		// Handlers are global: clear them when this connection ends, unless a newer player already owns them.
		signal.addEventListener(
			"abort",
			() => {
				if (mediaOwner !== this) return;
				mediaOwner = null;
				set(() => null);
			},
			{ once: true },
		);
	}
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

if (!customElements.get("listen-player"))
	customElements.define("listen-player", ListenPlayer);
