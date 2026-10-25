/**
 * Loader for the neural engine served as /tts/kokoro.js (contract: engine.ts). The module exports
 * createEngine(); nothing is downloaded until the engine's init() runs (see listen-player.ts).
 */
import type { TtsEngine } from "./engine";

/** Counts ONNX Runtime session creations per page, for the check that one init makes one session. */
interface Diagnostics {
	sessionCreates: number;
}

interface OrtLike {
	env: { logLevel?: string };
	InferenceSession: { create: (...args: unknown[]) => Promise<unknown> };
}

declare global {
	interface Window {
		__kokoroDiagnostics?: Diagnostics;
	}
}

/**
 * ONNX Runtime logs a full wasm stack for every routine "node not assigned to the preferred execution
 * provider" note. Its logLevel is set as soon as its script defines `ort` (the loader assigns it), so only
 * errors reach the console. Session creations are counted for diagnostics.
 */
let ortTuned = false;
function tuneOrt(): void {
	if (ortTuned) return;
	ortTuned = true;
	const existing = Object.getOwnPropertyDescriptor(window, "ort");
	if (existing && !existing.configurable) return;
	const diagnostics: Diagnostics = (window.__kokoroDiagnostics ??= { sessionCreates: 0 });
	let current: OrtLike | undefined;
	Object.defineProperty(window, "ort", {
		configurable: true,
		get: () => current,
		set: (value: OrtLike) => {
			current = value;
			value.env.logLevel = "error";
			const create = value.InferenceSession.create.bind(value.InferenceSession);
			value.InferenceSession.create = (...args: unknown[]) => {
				diagnostics.sessionCreates += 1;
				return create(...args);
			};
		},
	});
}

/** Loads the neural engine module. Rejects if the module is missing or has no createEngine. */
export async function loadKokoroEngine(src: string): Promise<TtsEngine> {
	tuneOrt();
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
