// AudioWorklet processor: pushes 48 kHz mono blocks to the main thread.
//
// The AudioWorklet runs on the audio thread, where `navigator` and the DOM are unavailable, so it
// only does the one thing it's good at: handing each render quantum to the main thread. All the
// resampling, framing and state machines live in the main thread (pipeline.mjs + the Rust wasm).
//
// A block is the current render quantum (128 samples at 48 kHz = ~2.7 ms). The main thread
// accumulates them and resamples to 16 kHz.

class VcCaptureProcessor extends AudioWorkletProcessor {
	process(inputs) {
		const input = inputs[0];
		if (input && input.length > 0 && input[0].length > 0) {
			// Mono: take the first channel.
			this.port.postMessage(input[0].slice());
		}
		// Keep the processor alive.
		return true;
	}
}

registerProcessor('vc-capture', VcCaptureProcessor);
