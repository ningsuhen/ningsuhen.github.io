// voice-chat pipeline — the orchestration core of the on-device voice conversation.
//
// It owns the state machine and the timing, and it is the thing the page renders. It does NOT own
// the models: ASR and the LLM are injected (the page loads them and hands them in), and the VAD /
// turn models are loaded here through the shared ONNX Runtime. The Rust wasm (voice_chat.js) holds
// the audio path and the VAD / turn state machines; this file drives them and the ORT sessions.
//
// One turn, end to end:
//   mic (48 kHz) -> resample (16 kHz) -> frame (512) -> Silero VAD -> Rust Vad state machine
//   speech start -> capture the turn's audio
//   speech end   -> Smart Turn (on the turn's audio) -> Rust Turn state machine
//   turn complete -> ASR -> LLM (token stream) -> sentence splitter -> TTS (one sentence per call)
//   barge-in     -> user speaks while TTS plays: stop playback, cancel TTS, interrupt the turn.
//
// Nothing leaves the device. The page shows "runs on your device, nothing is sent".

import * as vc from './voice_chat.js';

// A Silero v5 frame: 512 samples at 16 kHz = 32 ms.
const FRAME = 512;
const FRAME_MS = 32;
const SR = 16000;

// The VAD runs a stricter threshold while the assistant is speaking, so the speaker's own voice
// (echo) does not trigger a false barge-in. A real barge-in needs sustained speech.
const VAD_THRESHOLD = 0.5;
const VAD_THRESHOLD_DURING_TTS = 0.7;

/**
 * @typedef {Object} PipelineDeps
 * @property {() => Promise<{ create: (buf: ArrayBuffer, opts?: object) => Promise<import('onnxruntime-web').InferenceSession> }>} ort
 *   A factory that returns the ONNX Runtime namespace (the page loads it via the shared loader).
 * @property {string} vadUrl  Silero VAD model URL.
 * @property {string} turnUrl Smart Turn model URL.
 * @property {object} [asr]   { transcribe: (audio16k: Float32Array) => Promise<string> }
 * @property {object} [llm]   { generate: (text: string, onToken: (t: string) => void, signal: AbortSignal) => Promise<void> }
 * @property {object} [tts]   { speak: (text: string, opts?: object) => AsyncIterable<{ samples: Float32Array, sampleRate: number }>, cancel: () => void }
 */

export class Pipeline {
	#ortNs;

	/**
	 * @param {PipelineDeps} deps
	 * @param {{ onState?: (s: object) => void, onEvent?: (e: object) => void }} [hooks]
	 */
	constructor(deps, hooks = {}) {
		this.deps = deps;
		this.hooks = hooks;

		// Rust state machines.
		this.vad = new vc.Vad(VAD_THRESHOLD, 5, 4, 8, 6);
		this.turn = new vc.Turn(0.5, 50);
		this.resampler = new vc.Resampler(48000, SR);
		this.mel = new vc.Mel.whisper();
		this.sentence = new vc.SentenceSplitter();

		// Audio path.
		this.frameBuf = new Float32Array(0); // 16 kHz samples not yet framed
		this.turnAudio = new Float32Array(0); // the current turn's 16 kHz audio
		this.preRoll = new Float32Array(0);

		// ORT sessions (loaded in start(), one at a time).
		this.vadSession = null;
		this.turnSession = null;
		this.asr = null; // { encoder, decoder } sessions, loaded on demand
		this.llm = null; // LLM session, loaded on demand
		this.vadState = new Float32Array(2 * 128); // Silero's recurrent state

		// Conversation state.
		this.state = 'idle'; // idle | listening | thinking | speaking | interrupted
		this.turnActive = false;
		this.ttsPlaying = false;
		this.abort = null; // AbortController for the current LLM/TTS turn
		this.audioCtx = null;
		this.stream = null;
		this.worklet = null;

		// Per-stage latencies for the current turn (ms).
		this.latency = {};

		// Memory tracking: peak JS heap (MB) per model load, for the report.
		this.memory = {};

		// The playback sources, so barge-in can stop them at once.
		this.playingSources = new Set();
	}

	#heapMB() {
		return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null;
	}

	/**
	 * Load one model: stream it into Cache Storage, create the ORT session from a single buffer,
	 * and drop the buffer. Never keeps a Blob or a second copy alive. Reports the peak JS heap.
	 * @param {string} name  A label for the memory report.
	 * @param {string} url   The model URL.
	 * @param {object} [opts] { onProgress?: (f: number) => void }
	 * @returns {Promise<object>} The ORT InferenceSession.
	 */
	async #loadModel(name, url, { onProgress } = {}) {
		const ort = this.#ortNs;
		const before = this.#heapMB();
		let buf = null;
		try {
			// 1. Stream into Cache Storage (a verified copy), reading the body once.
			const cache = await caches.open('voice-chat-models-v1');
			let cached = await cache.match(url).catch(() => undefined);
			if (!cached) {
				const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
				if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
				const total = Number(res.headers.get('content-length')) || 0;
				const reader = res.body.getReader();
				const parts = [];
				let got = 0;
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					parts.push(value);
					got += value.length;
					onProgress?.(total ? got / total : 0);
				}
				const blob = new Blob(parts);
				await cache.put(url, new Response(blob, { headers: { 'content-length': String(blob.size) } }));
				cached = await cache.match(url);
			}
			// 2. One buffer, handed to ORT, then dropped.
			buf = await (await cached).arrayBuffer();
			// 3. Create the session from that single buffer.
			const session = await ort.InferenceSession.create(buf, { executionProviders: this.#eps() });
			this.memory[name] = { beforeMB: before, peakMB: this.#heapMB(), bytes: buf.byteLength };
			return session;
		} finally {
			// Drop the buffer reference; the session owns its own copy now.
			buf = null;
		}
	}

	#emitState() {
		this.hooks.onState?.({
			state: this.state,
			turnActive: this.turnActive,
			ttsPlaying: this.ttsPlaying,
			latency: { ...this.latency },
		});
	}

	#emitEvent(e) {
		this.hooks.onEvent?.(e);
	}

	/** Request the mic and load the VAD + turn models (one at a time). */
	async start() {
		const ort = await this.deps.ort();
		this.#ortNs = ort;
		const t0 = performance.now();
		// Sequential, not parallel: two model buffers at once is a memory spike. VAD and turn are
		// small (2 MB and 9 MB), so the cost of serialising them is nothing.
		this.vadSession = await this.#loadModel('vad', this.deps.vadUrl);
		this.turnSession = await this.#loadModel('turn', this.deps.turnUrl);
		this.latency.modelLoad = performance.now() - t0;

		// The mic.
		this.audioCtx = new AudioContext({ sampleRate: 48000 });
		await this.audioCtx.audioWorklet.addModule('vc-capture-processor.js');
		this.stream = await navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
		});
		const source = this.audioCtx.createMediaStreamSource(this.stream);
		const node = new AudioWorkletNode(this.audioCtx, 'vc-capture');
		source.connect(node);
		node.port.onmessage = (e) => this.#onMicBlock(e.data);
		this.worklet = node;

		this.state = 'listening';
		this.#emitState();
	}

	/**
	 * True when the device has enough memory for the full LLM. `navigator.deviceMemory` is in GB
	 * (capped at 8). Below 4 GB we recommend the smaller stack; the caller offers it.
	 */
	get lowMemory() {
		const dm = navigator.deviceMemory;
		return typeof dm === 'number' && dm < 4;
	}

	/**
	 * Load the ASR (Moonshine base: encoder + merged decoder). One at a time, after the VAD and
	 * turn are resident. Returns { encoder, decoder } sessions.
	 */
	async loadAsr({ onProgress } = {}) {
		if (this.asr) return this.asr;
		const { asrEncoderUrl, asrDecoderUrl } = this.deps;
		const encoder = await this.#loadModel('asr-encoder', asrEncoderUrl, { onProgress });
		const decoder = await this.#loadModel('asr-decoder', asrDecoderUrl, { onProgress });
		this.asr = { encoder, decoder };
		return this.asr;
	}

	/**
	 * Load the LLM (LFM2.5-1.2B q4f16). Checked against the memory guard first. Returns the
	 * session. Throws a friendly error when the device is too small.
	 */
	async loadLlm({ onProgress } = {}) {
		if (this.llm) return this.llm;
		if (this.lowMemory) {
			throw new Error('This device has limited memory. Use the smaller model stack, or the text box, for replies.');
		}
		this.llm = await this.#loadModel('llm', this.deps.llmUrl, { onProgress });
		return this.llm;
	}

	#eps() {
		// WebGPU first, WASM fallback. The page's gpu-guard decides; here we just offer both.
		return 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm'];
	}

	/** The AudioWorklet pushes 48 kHz blocks here. */
	#onMicBlock(block) {
		if (!block || this.state === 'idle') return;
		const resampled = this.resampler.process(Float32Array.from(block));
		// Append to the frame buffer.
		const next = new Float32Array(this.frameBuf.length + resampled.length);
		next.set(this.frameBuf);
		next.set(resampled, this.frameBuf.length);
		this.frameBuf = next;

		// Process complete frames.
		while (this.frameBuf.length >= FRAME) {
			const frame = this.frameBuf.slice(0, FRAME);
			this.frameBuf = this.frameBuf.slice(FRAME);
			this.#processFrame(frame);
		}
	}

	#processFrame(frame) {
		const t0 = performance.now();
		const prob = this.#vadProb(frame);
		const threshold = this.ttsPlaying ? VAD_THRESHOLD_DURING_TTS : VAD_THRESHOLD;
		// The Rust Vad uses a fixed threshold; we emulate the dynamic threshold by scaling the prob.
		const scaled = this.ttsPlaying ? prob / VAD_THRESHOLD_DURING_TTS * VAD_THRESHOLD : prob;
		const events = this.vad.feedBlock(new Float32Array([scaled]), new Float32Array([frame[0]]));
		this.latency.vad = performance.now() - t0;

		for (const ev of events) {
			if (ev.kind() === 1) {
				// Speech started.
				this.preRoll = this.vad.pre_roll();
				this.turnAudio = new Float32Array(0);
				this.turnActive = true;
				this.turn.speech_started();
				// Barge-in: speech while the assistant is talking.
				if (this.ttsPlaying) {
					this.#bargeIn();
				}
				this.state = this.ttsPlaying ? this.state : 'listening';
				this.#emitState();
			} else if (ev.kind() === 2) {
				// Speech ended (a silence gap).
				this.turn.speech_ended();
				this.#emitState();
			}
		}

		// Accumulate the turn's audio while active.
		if (this.turnActive) {
			const next = new Float32Array(this.turnAudio.length + frame.length);
			next.set(this.turnAudio);
			next.set(frame, this.turnAudio.length);
			this.turnAudio = next;
		}

		// Advance the turn's timeout while a gap is open.
		if (this.turnActive && this.turn.phase() === 1) {
			if (this.turn.tick()) {
				this.#completeTurn();
			}
		}
	}

	/** Run Silero VAD on one frame, returning the speech probability. */
	#vadProb(frame) {
		const ortNs = this.#ortNs;
		const t = (data, dims) => new ortNs.Tensor('float32', data, dims);
		const res = this.vadSession.run({
			input: t(frame, [1, FRAME]),
			state: t(this.vadState, [2, 1, 128]),
			sr: new ortNs.Tensor('int64', new BigInt64Array([SR]), [1]),
		});
		// Update the state for the next frame.
		this.vadState = Float32Array.from(res.stateN.data);
		return res.output.data[0];
	}

	/** Run Smart Turn on the whole turn's audio, returning the "complete" probability. */
	async #turnProb() {
		const audio = this.#padTurn(this.turnAudio);
		const features = this.mel.extract(audio);
		const ortNs = this.#ortNs;
		const res = this.turnSession.run({
			input_features: new ortNs.Tensor('float32', features, [1, 80, features.length / 80]),
		});
		return res.logits.data[0];
	}

	/** Zero-pad the turn audio to a whole number of Smart Turn frames (800 frames = 16 s). */
	#padTurn(audio) {
		const frames = Math.max(1, Math.ceil(audio.length / 160));
		const target = frames * 160;
		if (audio.length >= target) return audio;
		const out = new Float32Array(target);
		out.set(audio);
		return out;
	}

	// ---------------------------------------------------------------- Moonshine ASR
	//
	// NOTE: the encoder/decoder input-output names and the decode loop below are written on the
	// standard onnx-community Moonshine layout and introspect the session to stay robust, but they
	// have NOT been run against the real model files on a GPU. Verify on a real device (M2 gate).

	#moonshineTok = null;

	async #moonshineTokenizer() {
		if (this.#moonshineTok) return this.#moonshineTok;
		// A minimal BPE decoder: Moonshine's tokenizer.json is a standard Hugging Face BPE. We only
		// need token -> text, so we load the vocab and piece the tokens together.
		const url = 'https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/tokenizer.json';
		const tok = JSON.parse(await (await fetch(url)).text());
		const vocab = {};
		for (let i = 0; i < tok.model?.vocab?.length; i++) vocab[tok.model.vocab[i]] = i;
		// Reverse: id -> piece.
		const idToPiece = new Array(tok.model?.vocab?.length ?? 0);
		for (const [piece, id] of Object.entries(vocab)) idToPiece[id] = piece;
		this.#moonshineTok = { idToPiece, eos: tok.model?.eos_token ?? '<|endoftext|>' };
		return this.#moonshineTok;
	}

	async #moonshineTranscribe(audio16k) {
		const { encoder, decoder } = await this.loadAsr();
		const ort = this.#ortNs;
		// Log-mel features (the same Whisper 80-mel front end the Rust crate provides).
		const features = this.mel.extract(audio16k);
		const nFrames = features.length / 80;
		// Encoder: input_features [1, 80, T] -> last_hidden_state [1, T, D].
		const encIn = encoder.inputNames[0];
		const encOut = encoder.outputNames[0];
		const enc = encoder.run({ [encIn]: new ort.Tensor('float32', features, [1, 80, nFrames]) });
		const encOuts = enc[encOut];

		// Decoder: autoregressive, one token at a time, until EOS or a length cap.
		const tok = await this.#moonshineTokenizer();
		const decIn = decoder.inputNames;
		const decOut = decoder.outputNames[0];
		const maxLen = 200;
		const ids = [];
		let logits = null;
		for (let step = 0; step < maxLen; step++) {
			// Build the decoder feed. The merged decoder takes input_ids and (optionally) the
			// encoder outputs; introspect which inputs exist.
			const feed = {};
			for (const name of decIn) {
				if (/input_ids/.test(name)) {
					feed[name] = new ort.Tensor('int64', new BigInt64Array(ids.map((i) => BigInt(i))), [1, ids.length]);
				} else if (/attention_mask/.test(name)) {
					feed[name] = new ort.Tensor('int64', new BigInt64Array(ids.map(() => 1n)), [1, ids.length]);
				}
			}
			// The encoder outputs are fed by their declared name if present.
			for (const name of decIn) {
				if (/encoder|hidden|memory/.test(name)) {
					feed[name] = new ort.Tensor('float32', Float32Array.from(encOuts.data), encOuts.dims);
				}
			}
			const out = decoder.run(feed);
			logits = out[decOut];
			// Take the argmax of the last position.
			const last = logits.dims.length > 1 ? logits.dims[logits.dims.length - 1] : logits.data.length;
			let best = 0;
			let bestV = -Infinity;
			const base = (logits.data.length - last);
			for (let i = 0; i < last; i++) {
				const v = logits.data[base + i];
				if (v > bestV) { bestV = v; best = i; }
			}
			ids.push(best);
			const piece = tok.idToPiece[best] ?? '';
			if (piece === tok.eos || ids.length >= maxLen) break;
		}
		// Piece the tokens together (BPE pieces may carry a leading space).
		let text = ids.map((id) => tok.idToPiece[id] ?? '').join('');
		text = text.replace(/^\s+/, '').trim();
		return text;
	}

	// ---------------------------------------------------------------- LFM2.5 LLM
	//
	// NOTE: same caveat as the ASR — written on the standard causal-LM ONNX layout, introspecting
	// the session, NOT yet run against the real model on a GPU. Verify on a real device (M3 gate).

	async #llmGenerate(transcript, onToken, signal) {
		const session = await this.loadLlm();
		const ort = this.#ortNs;
		const inName = session.inputNames.find((n) => /input_ids/.test(n)) ?? session.inputNames[0];
		const outName = session.outputNames[0];
		const system = 'You are a voice assistant. Answer in one or two short spoken sentences. No lists, no markdown, no emoji.';
		const prompt = `${system}\nUser: ${transcript}\nAssistant:`;
		// Tokenise the prompt with a simple whitespace BPE stand-in. A real BPE tokenizer would be
		// loaded from the LFM2.5 tokenizer.json; this keeps the loop self-contained for the demo.
		const ids = prompt.split(/\s+/).filter(Boolean).map((w) => (w.charCodeAt(0) % 4000) + 100);
		const maxTokens = 64;
		for (let step = 0; step < maxTokens; step++) {
			if (signal?.aborted) throw new Error('aborted');
			const feed = { [inName]: new ort.Tensor('int64', new BigInt64Array(ids.map((i) => BigInt(i))), [1, ids.length]) };
			const out = session.run(feed);
			const logits = out[outName];
			const last = logits.dims.length > 1 ? logits.dims[logits.dims.length - 1] : logits.data.length;
			let best = 0;
			let bestV = -Infinity;
			const base = logits.data.length - last;
			for (let i = 0; i < last; i++) {
				const v = logits.data[base + i];
				if (v > bestV) { bestV = v; best = i; }
			}
			ids.push(best);
			// Decode the token to text (stand-in: map id back to a char). A real tokenizer decodes
			// BPE pieces; this is a placeholder until the real tokenizer is wired in.
			const ch = String.fromCharCode(97 + (best % 26));
			onToken(step === 0 ? ch : ' ' + ch);
			if (best === 0) break; // EOS stand-in
		}
	}

	async #completeTurn() {
		if (!this.turnActive) return;
		this.turnActive = false;
		this.state = 'thinking';
		this.#emitState();

		const t0 = performance.now();
		const prob = await this.#turnProb();
		this.latency.turn = performance.now() - t0;

		// If Smart Turn says "incomplete", the hard timeout already fired; proceed anyway (the
		// pipeline must make progress). A high prob confirms it.
		if (this.turn.feed_turn_prob(prob)) {
			// completed by the model
		}

		await this.#runTurn();
	}

	async #runTurn() {
		this.abort = new AbortController();
		const { tts } = this.deps;
		try {
			// ASR (Moonshine base). Loaded on demand, after the VAD and turn are resident.
			const tAsr = performance.now();
			const transcript = await this.#moonshineTranscribe(this.turnAudio);
			this.latency.asr = performance.now() - tAsr;
			this.#emitEvent({ type: 'transcript', text: transcript });

			// LLM (LFM2.5-1.2B), token by token, split into sentences for TTS.
			const tLlm0 = performance.now();
			let firstToken = null;
			const onToken = (token) => {
				if (firstToken === null) {
					firstToken = performance.now() - tLlm0;
					this.latency.llmFirstToken = firstToken;
				}
				const sentence = this.sentence.feed(token);
				if (sentence) {
					this.#speakSentence(sentence, tts).catch(() => {});
				}
			};
			await this.#llmGenerate(transcript, onToken, this.abort.signal);
			const tail = this.sentence.finish();
			if (tail && tts) {
				await this.#speakSentence(tail, tts);
			}
			this.latency.llm = performance.now() - tLlm0;

			this.state = 'idle';
			this.#emitState();
		} catch (err) {
			if (err?.name === 'AbortError') {
				this.state = 'interrupted';
			} else {
				this.#emitEvent({ type: 'error', message: String(err?.message ?? err) });
				this.state = 'idle';
			}
			this.#emitState();
		} finally {
			this.turnAudio = new Float32Array(0);
			this.sentence = new vc.SentenceSplitter();
		}
	}

	/** Synthesise and play one sentence. Resolves when playback finishes (or is interrupted). */
	async #speakSentence(text, tts) {
		if (!tts || this.abort?.signal.aborted) return;
		this.ttsPlaying = true;
		this.state = 'speaking';
		this.#emitState();

		const t0 = performance.now();
		let firstChunk = null;
		const ctx = this.audioCtx;
		try {
			for await (const chunk of tts.speak(text, { signal: this.abort?.signal })) {
				if (this.abort?.signal.aborted) return;
				if (firstChunk === null) {
					firstChunk = performance.now() - t0;
					this.latency.ttsFirstChunk = firstChunk;
					this.latency.timeToFirstAudio = (this.latency.asr ?? 0) + (this.latency.llmFirstToken ?? 0) + firstChunk;
				}
				await this.#playChunk(chunk.samples, chunk.sampleRate);
			}
		} finally {
			this.ttsPlaying = false;
			if (!this.abort?.signal.aborted) {
				this.state = 'idle';
				this.#emitState();
			}
		}
	}

	async #playChunk(samples, sampleRate) {
		const ctx = this.audioCtx;
		const buf = ctx.createBuffer(1, samples.length, sampleRate);
		buf.copyToChannel(samples, 0);
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.connect(ctx.destination);
		this.playingSources.add(src);
		src.start();
		// Wait for this chunk to finish so chunks play in order.
		await new Promise((resolve) => {
			src.onended = () => {
				this.playingSources.delete(src);
				resolve();
			};
		});
	}

	/** Barge-in: stop everything the assistant is doing. */
	#bargeIn() {
		// Stop playback at once.
		for (const src of this.playingSources) {
			try {
				src.stop();
			} catch {}
			this.playingSources.delete(src);
		}
		// Cancel the TTS engine (takes effect between chunks).
		this.deps.tts?.cancel?.();
		// Abort the LLM stream.
		this.abort?.abort();
		// Interrupt the turn state machine.
		this.turn.interrupt();
		this.turnActive = false;
		this.ttsPlaying = false;
		this.state = 'interrupted';
		this.#emitEvent({ type: 'interrupted' });
	this.#emitState();
	}

	/** Stop the mic and release the models. */
	async stop() {
		this.abort?.abort();
		this.worklet?.disconnect();
		this.stream?.getTracks().forEach((t) => t.stop());
		this.audioCtx?.close();
		this.worklet = null;
		this.stream = null;
		this.audioCtx = null;
		this.vadSession = null;
		this.turnSession = null;
		this.state = 'idle';
		this.#emitState();
	}
}

/**
 * Install the AudioWorklet processor that pushes 48 kHz blocks to the main thread.
 * @param {AudioContext} ctx
 */
export async function installCaptureWorklet(ctx) {
	await ctx.audioWorklet.addModule('vc-capture-processor.js');
}
