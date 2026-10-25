/** Built-in voices through speechSynthesis. No download. Remote voices send the text to a remote service. */
import type { Accelerator, SpeakOptions, TtsEngine, Voice } from "./engine";

export function webSpeechAvailable(): boolean {
	return (
		typeof window !== "undefined" &&
		"speechSynthesis" in window &&
		typeof SpeechSynthesisUtterance !== "undefined"
	);
}

export class WebSpeechEngine implements TtsEngine {
	readonly id = "web-speech";
	readonly label = "Built-in voice";
	readonly accelerator: Accelerator = "none";
	private current: SpeechSynthesisUtterance | null = null;

	async init(): Promise<void> {
		if (!webSpeechAvailable())
			throw new Error("speechSynthesis is not supported in this browser");
		if (speechSynthesis.getVoices().length > 0) return;
		// Chrome loads voices asynchronously. Wait briefly, then continue with whatever exists.
		await new Promise<void>((resolve) => {
			const timer = setTimeout(done, 1500);
			function done(): void {
				clearTimeout(timer);
				speechSynthesis.removeEventListener("voiceschanged", done);
				resolve();
			}
			speechSynthesis.addEventListener("voiceschanged", done);
		});
	}

	voices(): Voice[] {
		if (!webSpeechAvailable()) return [];
		return speechSynthesis.getVoices().map((v) => ({
			id: v.voiceURI,
			name: v.name,
			lang: v.lang,
			local: v.localService,
		}));
	}

	speak(text: string, opts: SpeakOptions): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.rate = opts.rate;
			const voice = opts.voice
				? speechSynthesis.getVoices().find((v) => v.voiceURI === opts.voice)
				: undefined;
			if (voice) {
				utterance.voice = voice;
				utterance.lang = voice.lang;
			}
			const finish = (): void => {
				if (this.current === utterance) this.current = null;
				opts.signal?.removeEventListener("abort", onAbort);
				resolve();
			};
			const onAbort = (): void => {
				speechSynthesis.cancel();
				finish();
			};
			utterance.onend = finish;
			utterance.onerror = (event) => {
				// "interrupted" and "canceled" are how a skip or pause ends an utterance. Not failures.
				if (event.error === "interrupted" || event.error === "canceled")
					return finish();
				if (this.current === utterance) this.current = null;
				opts.signal?.removeEventListener("abort", onAbort);
				reject(new Error(`speech error: ${event.error}`));
			};
			opts.signal?.addEventListener("abort", onAbort, { once: true });
			// Keep a reference: some browsers drop utterances that are garbage collected before they end.
			this.current = utterance;
			speechSynthesis.speak(utterance);
		});
	}

	cancel(): void {
		if (webSpeechAvailable()) speechSynthesis.cancel();
		this.current = null;
	}

	dispose(): void {
		this.cancel();
	}
}
