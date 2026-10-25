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
type PlayState = "idle" | "playing" | "paused";

declare global {
	interface Window {
		__KOKORO_READY?: boolean;
	}
}

const PREFS_KEY = "listen-prefs";
const CONSENT_KEY = "listen-kokoro-consent";
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

async function playStream(
	chunks: AsyncIterable<AudioChunk>,
	ctx: AudioContext | null,
	signal: AbortSignal,
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
	private abort: AbortController | null = null;
	private activeBlock: HTMLElement | null = null;
	private lastUserScroll = 0;
	private programmaticUntil = 0;
	private frame = 0;
	private teardown: Array<() => void> = [];

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
		this.setIndex(0, false);
	}

	/* ---------- engines ---------- */

	private async ensureEngine(
		id: EngineId,
		askConsent: boolean,
	): Promise<TtsEngine | null> {
		if (activeEngine && activeEngineId === id) return activeEngine;
		if (id === "kokoro" && askConsent && !(await this.confirmDownload()))
			return null;
		try {
			const engine =
				id === "kokoro" ? await this.loadKokoro() : await this.loadWebSpeech();
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
			this.status(
				`${id === "kokoro" ? "Neural voice" : "Built-in voice"} is not available: ${errorText(err)}`,
			);
			if (id !== "web-speech") {
				this.syncEngineSelect("web-speech");
				return this.ensureEngine("web-speech", false);
			}
			return null;
		}
	}

	private async loadWebSpeech(): Promise<TtsEngine> {
		const engine = new WebSpeechEngine();
		await engine.init();
		return engine;
	}

	private async loadKokoro(): Promise<TtsEngine> {
		this.status("Loading neural voice");
		const engine = await loadKokoroEngine(
			this.dataset.kokoroSrc ?? "/tts/kokoro.js",
		);
		await engine.init({
			onProgress: (f) =>
				this.status(`Downloading model ${Math.round(f * 100)}%`),
		});
		writeStorage(CONSENT_KEY, true);
		this.status("");
		return engine;
	}

	private confirmDownload(): Promise<boolean> {
		if (readStorage<boolean>(CONSENT_KEY, false)) return Promise.resolve(true);
		const dialog = this.querySelector<HTMLDialogElement>("[data-consent]");
		if (!dialog || typeof dialog.showModal !== "function")
			return Promise.resolve(false);
		dialog.showModal();
		return new Promise((resolve) => {
			dialog.addEventListener(
				"close",
				() => resolve(dialog.returnValue === "ok"),
				{ once: true },
			);
		});
	}

	private refreshEngineUI(): void {
		const engine = activeEngine;
		if (!engine) return;
		this.syncEngineSelect(activeEngineId);
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
		if (
			window.__KOKORO_READY &&
			!select.querySelector("option[value=kokoro]")
		) {
			select.append(new Option("Neural voice (Kokoro)", "kokoro"));
		}
		select.value = id;
		{
			const wrap = select.closest<HTMLElement>("[data-engine-wrap]");
			if (wrap) wrap.hidden = select.options.length < 2;
		}
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
					const out = engine.speak(unit.text, {
						rate: this.rate,
						voice: this.voice,
						signal,
					});
					if (isStream(out)) await playStream(out, audioContext, signal);
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

	private async switchEngine(id: EngineId): Promise<void> {
		const wasPlaying = this.state === "playing";
		this.stopPlayback();
		const engine = await this.ensureEngine(id, true);
		if (!engine) {
			this.syncEngineSelect(activeEngineId);
			return;
		}
		this.setState("paused");
		writeStorage(PREFS_KEY, { engine: id, voice: this.voice, rate: this.rate });
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
