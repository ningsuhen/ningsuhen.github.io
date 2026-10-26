/**
 * Loader for the neural engine served as /tts/kokoro.js (contract: engine.ts). The module exports
 * createEngine(); nothing is downloaded until the engine's init() runs (see listen-player.ts).
 */
import type { TtsEngine } from "./engine";

/** Loads the neural engine module. Rejects if the module is missing or has no createEngine. */
export async function loadKokoroEngine(src: string): Promise<TtsEngine> {
	const mod: unknown = await import(/* @vite-ignore */ src);
	if (
		typeof mod !== "object" ||
		mod === null ||
		!("createEngine" in mod) ||
		typeof mod.createEngine !== "function"
	) {
		throw new Error(`${src} does not export createEngine()`);
	}
	return await (mod.createEngine as () => TtsEngine | Promise<TtsEngine>)();
}

/** The shared ONNX Runtime loader (public/tts/ort-runtime.js), next to kokoro.js. */
export async function loadOrtRuntime(src: string): Promise<OrtRuntime> {
	return (await import(/* @vite-ignore */ new URL("ort-runtime.js", src).href)) as OrtRuntime;
}

/** Makes the verified ONNX Runtime binary available before the engine's init(). Rejects on integrity or host failure. */
export async function prepareOrtRuntime(
	src: string,
	onProgress?: (fraction: number) => void,
	signal?: AbortSignal,
): Promise<void> {
	await (await loadOrtRuntime(src)).ensureOrtRuntime({ onProgress, signal });
}

export interface OrtRuntime {
	ensureOrtRuntime(opts?: { onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<ArrayBuffer>;
	ortRuntimeCached(): Promise<boolean>;
	removeOrtRuntime(): Promise<void>;
}
