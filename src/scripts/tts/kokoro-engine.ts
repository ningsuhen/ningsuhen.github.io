/**
 * NOT IMPLEMENTED (phase 1 placeholder). The neural engine is built separately and served as /tts/kokoro.js.
 *
 * Contract (see engine.ts): the player offers this engine only when window.__KOKORO_READY === true,
 * shows a consent dialog, then imports the module and calls its exported createEngine().
 * This class only marks the slot: every method throws or does nothing, so it can never produce audio.
 */
import type { Accelerator, SpeakOptions, TtsEngine, Voice } from "./engine";

export class KokoroEngine implements TtsEngine {
	readonly id = "kokoro";
	readonly label = "Neural voice (Kokoro)";
	readonly requiresDownloadMB = 86;
	readonly accelerator: Accelerator = "none";

	async init(): Promise<void> {
		throw new Error("KokoroEngine is not implemented yet");
	}

	voices(): Voice[] {
		return [];
	}

	speak(_text: string, _opts: SpeakOptions): Promise<void> {
		return Promise.reject(new Error("KokoroEngine is not implemented yet"));
	}

	cancel(): void {}

	dispose(): void {}
}

/** Loads the neural engine from the loader contract. Rejects if the module is missing or has no createEngine. */
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
