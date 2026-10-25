/**
 * Engine contract for the Listen player.
 *
 * Every engine runs in the visitor's browser. Nothing is sent to a server.
 *
 * Loader contract for the neural engine (phase 2, built separately):
 *   - The page dynamically imports `/tts/kokoro.js` (base-aware, see ListenPlayer.astro).
 *   - That module exports `createEngine(): TtsEngine | Promise<TtsEngine>`.
 *   - The Kokoro option is only offered when `window.__KOKORO_READY === true`.
 *   - The player shows a consent dialog before `init()` (the model is 86-326 MB).
 *   - If the import or `init()` fails, the player falls back to the Web Speech engine.
 *
 * `speak()` either returns a Promise (the engine plays audio itself, e.g. speechSynthesis)
 * or an AsyncIterable of PCM chunks (the player plays them through an AudioContext queue).
 */

/** Compute the engine actually uses. `none` for engines that do not run a model (Web Speech). */
export type Accelerator = "webgpu" | "wasm" | "none";

export interface Voice {
	id: string;
	name: string;
	lang: string;
	/** true when the voice runs on the device; false when audio comes from a remote service. */
	local: boolean;
}

export interface SpeakOptions {
	/** Playback rate, 0.75-2. */
	rate: number;
	/** Voice id from `voices()`, or null for the engine default. */
	voice: string | null;
	signal?: AbortSignal;
}

export interface AudioChunk {
	samples: Float32Array;
	sampleRate: number;
}

export interface EngineInitOptions {
	/** 0-1 while model files download. */
	onProgress?: (fraction: number) => void;
	/** Neural engines: "fp32" (GPU) or "q8f16" (CPU). Omit to let the engine pick. */
	variant?: "fp32" | "q8f16";
	/** Neural engines: absolute URL the model files load from (pinned Hugging Face revision). */
	baseUrl?: string;
	/** Neural engines: absolute URL of the ONNX Runtime dist (served from this site). */
	ortBase?: string;
}

export interface TtsEngine {
	readonly id: string;
	readonly label: string;
	/** Download size shown in the consent dialog. Omit for engines with no download. */
	readonly requiresDownloadMB?: number;
	/** Attribution the player shows while this engine is active (model licence and credits). */
	readonly notice?: string;
	/** Reported after init(). The player shows GPU / CPU from it; Web Speech reports `none`. */
	readonly accelerator: Accelerator;
	init(opts?: EngineInitOptions): Promise<void>;
	voices(): Voice[];
	speak(
		text: string,
		opts: SpeakOptions,
	): Promise<void> | AsyncIterable<AudioChunk>;
	cancel(): void;
	dispose(): void;
}

/** A sentence-level unit the player highlights. `text` is already normalised for speech. */
export interface SpeechUnit {
	/** Stable id of the sentence this unit belongs to, e.g. "s12". */
	sentenceId: string;
	text: string;
}

/** GPU only when the engine reports WebGPU and the browser exposes it; CPU for any other model engine; nothing for Web Speech. */
export function accelerationLabel(accelerator: Accelerator): string {
	if (accelerator === "webgpu") return "gpu" in navigator ? "GPU" : "CPU";
	if (accelerator === "wasm") return "CPU";
	return "";
}
