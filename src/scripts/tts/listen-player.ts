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
import { WebSpeechEngine, webSpeechAvailable } from "./web-speech-engine";

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
/** Pinned revision of onnx-community/Kokoro-82M-v1.0-ONNX (Apache-2.0). Pinned so the cached files never drift. */
const KOKORO_MODEL_BASE =
	"https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/";
type KokoroVariant = "fp32" | "q8f16";
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
function withStallGuard<T>(run: (touch: () => void) => Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let timer = setTimeout(stalled, ms);
		function stalled(): void {
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

async function playStream(
	chunks: AsyncIterable<AudioChunk>,
	ctx: AudioContext | null,
	signal: AbortSignal,
	monitor: SpeedMonitor,
): Promise<void> {
	if (!ctx) throw new Error("AudioContext is not available");
	if (ctx.state === "suspended") await ctx.resume();
	const sources: AudioBufferSourceNode[] = [];
	const stop = (): void => {
		for (const s of sources) {
			try {
				s.stop();
			} catch {
				// Already ended.
			}
		}
	};
	signal.addEventListener("abort", stop, { once: true });
	let at = ctx.currentTime;
	try {
		for await (const chunk of chunks) {
			if (signal.aborted) break;
			monitor.chunk(
				chunk.samples.length / chunk.sampleRate,
				sources.length > 0 && at <= ctx.currentTime + 0.02,
				sources.length === 0,
			);
			const buffer = ctx.createBuffer(
				1,
				chunk.samples.length,
				chunk.sampleRate,
			);
			buffer.copyToChannel(chunk.samples as Float32Array<ArrayBuffer>, 0);
			const source = ctx.createBufferSource();
			source.buffer = buffer;
			source.connect(ctx.destination);
			at = Math.max(at, ctx.currentTime + 0.02);
			source.start(at);
			at += buffer.duration;
			sources.push(source);
		}
		const last = sources[sources.length - 1];
		if (last && !signal.aborted) {
			await new Promise<void>((resolve) => {
				last.onended = () => resolve();
				signal.addEventListener("abort", () => resolve(), { once: true });
			});
		}
	} finally {
		signal.removeEventListener("abort", stop);
	}
}

/** True when the browser exposes a WebGPU adapter. Any failure counts as no. */
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
		if (!root || !engineOffered) return;
		this.sentences = extractSentences(root);
		if (this.sentences.length === 0) return;

		const prefs = readStorage<Prefs>(PREFS_KEY, {});
		const savedRate = prefs.rate ?? 1;
		this.rate = RATES.includes(savedRate) ? savedRate : 1;
		this.voice = prefs.voice ?? null;
		this.bindControls();
		this.bindScrollTracking();
		this.setupMediaSession();

		// A saved neural choice loads without a dialog only when the visitor already consented on this device.
		const savedKokoro =
			!readStorage(SLOW_KEY, false) &&
			prefs.engine === "kokoro" &&
			window.__KOKORO_READY === true &&
			readStorage(CONSENT_KEY, false);
		const wanted: EngineId = activeEngine
			? activeEngineId
			: savedKokoro
				? "kokoro"
				: "web-speech";
		const engine = await this.ensureEngine(wanted, false);
		if (!engine) return;
		this.removeAttribute("hidden");
		this.observeDock();
		this.setIndex(0, false);
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

	private async ensureEngine(
		id: EngineId,
		askConsent: boolean,
	): Promise<TtsEngine | null> {
		if (activeEngine && activeEngineId === id) {
			this.syncEngineSelect(id);
			return activeEngine;
		}
		let variant: KokoroVariant | null = null;
		if (id === "kokoro") {
			const choice = askConsent
				? await this.confirmDownload()
				: readStorage<KokoroChoice | null>(CONSENT_KEY, null);
			if (choice === "web") return this.ensureEngine("web-speech", false);
			if (!choice) {
				this.syncEngineSelect(activeEngineId);
				return null;
			}
			variant = choice;
		}
		try {
			const engine = variant
				? await this.loadKokoro(variant)
				: await this.loadWebSpeech();
			activeEngine?.dispose();
			activeEngine = engine;
			activeEngineId = id;
			this.voice =
				this.voice ??
				pickDefaultVoice(
					engine.voices(),
					document.documentElement.lang || "en",
				);
			this.refreshEngineUI();
			return engine;
		} catch (err) {
			if (variant) {
				const fallback = await this.ensureEngine("web-speech", false);
				this.status(
					`The neural voice is not available here (${errorText(err)}). Using the browser voice.`,
				);
				return fallback;
			}
			this.status(`The browser voice is not available: ${errorText(err)}`);
			return null;
		}
	}

	private async loadWebSpeech(): Promise<TtsEngine> {
		const engine = new WebSpeechEngine();
		await engine.init();
		return engine;
	}

	private async loadKokoro(variant: KokoroVariant): Promise<TtsEngine> {
		this.status("Loading neural voice");
		const engine = await loadKokoroEngine(
			this.dataset.kokoroSrc ?? "/tts/kokoro.js",
		);
		try {
			await withStallGuard(
				(touch) =>
					engine.init({
						variant,
						baseUrl: KOKORO_MODEL_BASE,
						ortBase: new URL(this.dataset.kokoroOrt ?? "/tts/vendor/ort/", location.href).href,
						onProgress: (f) => {
							touch();
							this.status(`Downloading model ${Math.round(f * 100)}%`);
						},
					}),
				INIT_STALL_MS,
			);
		} catch (err) {
			engine.dispose();
			throw err;
		}
		writeStorage(CONSENT_KEY, variant);
		this.status("");
		return engine;
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
			select.replaceChildren(
				...voices.map(
					(v) =>
						new Option(
							`${v.name} (${v.lang})${v.local ? "" : " · remote"}`,
							v.id,
						),
				),
			);
			select.value = this.voice ?? "";
			{
				const wrap = select.closest<HTMLElement>("[data-voice-wrap]");
				if (wrap) wrap.hidden = voices.length === 0;
			}
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
		for (let i = from; i < this.sentences.length; i++) {
			if (id !== this.runId) return;
			this.setIndex(i, true);
			for (const unit of this.sentences[i].units) {
				try {
					const monitor = new SpeedMonitor(() => this.neuralTooSlow(id));
					const out = engine.speak(unit.text, {
						rate: this.rate,
						voice: this.voice,
						signal,
					});
					if (isStream(out)) await playStream(out, audioContext, signal, monitor);
					else await out;
				} catch (err) {
					if (id === this.runId) this.fail(err);
					return;
				}
				if (id !== this.runId) return;
			}
		}
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
