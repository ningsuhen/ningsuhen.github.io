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
import { fromTokenizerJson } from './bpe.mjs';

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
	 * Stream one file into Cache Storage (a verified copy), reading the body once. Returns the
	 * cached Response. The #231 single-buffer path: no Blob is kept alive after the put.
	 * @param {string} url  The file URL.
	 * @param {(f: number) => void} [onProgress]
	 */
	async #streamToCache(url, onProgress) {
		const cache = await caches.open('voice-chat-models-v1');
		let cached = await cache.match(url).catch(() => undefined);
		if (cached) return cached;
		const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
		if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
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
		return cache.match(url);
	}

	/**
	 * Load one model: stream it into Cache Storage, create the ORT session from a single buffer,
	 * and drop the buffer. Never keeps a Blob or a second copy alive. Reports the peak JS heap.
	 *
	 * Out-of-line (external-data) models pass `externalData: [{ path, url }]`: each data file is
	 * streamed through the same single-buffer path and handed to ORT via the `externalData` create
	 * option (the vendored 1.27 mounts it under `path`), then released after session creation.
	 *
	 * @param {string} name  A label for the memory report.
	 * @param {string} url   The model URL.
	 * @param {object} [opts] { onProgress?: (f: number) => void, externalData?: { path: string, url: string }[] }
	 * @returns {Promise<object>} The ORT InferenceSession.
	 */
	async #loadModel(name, url, { onProgress, externalData } = {}) {
		const ort = this.#ortNs;
		const before = this.#heapMB();
		let buf = null;
		const extBufs = [];
		try {
			// 1. One buffer for the main model, handed to ORT, then dropped.
			buf = await (await this.#streamToCache(url, onProgress)).arrayBuffer();
			// 2. External-data files (out-of-line weights), if any: one buffer each, mounted under
			//    the exact path the graph refers to, then dropped.
			const ext = [];
			if (externalData) {
				for (const { path, url: extUrl } of externalData) {
					const ebuf = new Uint8Array(await (await this.#streamToCache(extUrl, onProgress)).arrayBuffer());
					extBufs.push(ebuf);
					ext.push({ path, data: ebuf });
				}
			}
			// 3. Create the session from that single buffer (+ external data), then drop the buffers.
			const session = await ort.InferenceSession.create(buf, {
				executionProviders: this.#eps(),
				...(ext.length ? { externalData: ext } : {}),
			});
			this.memory[name] = { beforeMB: before, peakMB: this.#heapMB(), bytes: buf.byteLength + extBufs.reduce((n, b) => n + b.byteLength, 0) };
			return session;
		} finally {
			// Drop the buffer references; the session owns its own copies now.
			buf = null;
			for (let i = 0; i < extBufs.length; i++) extBufs[i] = null;
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
		// LFM2.5 q4f16 is out-of-line: the main .onnx is a pointer, the weights live in a sibling
		// `_data` file. Mount it via the `externalData` option (path = the exact name the graph refers
		// to). Derive the data URL from the main model URL.
		const main = this.deps.llmUrl;
		const dataName = main.split('/').pop() + '_data';
		this.llm = await this.#loadModel('llm', main, {
			onProgress,
			externalData: [{ path: dataName, url: main.replace(/\.onnx$/, '.onnx_data') }],
		});
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

	/** Load the Moonshine tokenizer (Whisper-style BPE) from HF, once. */
	async #moonshineTokenizer() {
		if (this.#moonshineTok) return this.#moonshineTok;
		const url = 'https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main/tokenizer.json';
		const json = JSON.parse(await (await fetch(url)).text());
		this.#moonshineTok = fromTokenizerJson(json, { byteLevel: false, byteFallback: true, prepend: '▁' });
		return this.#moonshineTok;
	}

	/** Load the LFM2.5 tokenizer (GPT-2/Qwen byte-level BPE) from HF, once. */
	#lfmTok = null;
	async #lfmTokenizer() {
		if (this.#lfmTok) return this.#lfmTok;
		const url = 'https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX/resolve/main/tokenizer.json';
		const json = JSON.parse(await (await fetch(url)).text());
		this.#lfmTok = fromTokenizerJson(json, { byteLevel: true, byteFallback: false, prepend: '' });
		return this.#lfmTok;
	}

	/**
	 * Read a tensor's data out, handling both CPU (`data` getter) and WebGPU (`getData()`) outputs,
	 * and both fp32 and fp16 storage. Returns a `Float32Array`.
	 */
	#tensorData(t) {
		const raw = typeof t.data === 'function' ? t.data() : t.data ?? t.getData();
		const arr = raw instanceof Uint16Array ? new Float32Array(raw.length) : Float32Array.from(raw);
		if (raw instanceof Uint16Array) for (let i = 0; i < arr.length; i++) arr[i] = this.#f16(raw[i]);
		return arr;
	}

	/** IEEE half → f32, for reading fp16 logits. */
	#f16(u) {
		const s = (u & 0x8000) >> 15;
		const e = (u & 0x7c00) >> 10;
		const f = u & 0x3ff;
		let v;
		if (e === 0) v = f * 2 ** -24;
		else if (e === 0x1f) v = f ? NaN : Infinity;
		else v = (f / 1024 + 1) * 2 ** (e - 15);
		return s ? -v : v;
	}

	/** The argmax of the last position of a `[1, T, V]` (or `[V]`) logits tensor. */
	#argmaxLast(logits) {
		const data = this.#tensorData(logits);
		const V = logits.dims.length > 1 ? logits.dims[logits.dims.length - 1] : data.length;
		const base = data.length - V;
		let best = 0;
		let bestV = -Infinity;
		for (let i = 0; i < V; i++) {
			const v = data[base + i];
			if (v > bestV) {
				bestV = v;
				best = i;
			}
		}
		return best;
	}

	/**
	 * The KV-cache name map, built from the session's own declared names.
	 *
	 * Taken from Brev's verified harness: the naming is not uniform. `present_conv.N` →
	 * `past_conv.N` (prefix swapped, family kept) while `present.N.key` → `past_key_values.N.key`
	 * (family dropped). One regex does not cover both.
	 */
	#cacheKey(sess) {
		const byKey = new Map();
		for (const outName of sess.outputNames) {
			byKey.set(outName.replace(/^present_(conv|recurrent)\./, 'past_$1.'), outName);
			byKey.set(outName.replace(/^present\./, 'past_key_values.'), outName);
		}
		return (inName) => byKey.get(inName) ?? inName;
	}

	/**
	 * One decode step: feed the new ids, carry the KV cache forward. Returns the argmax of the last
	 * position. The cache tensors are handed straight back to ORT, so a GPU buffer survives the
	 * round trip untouched.
	 */
	#step(sess, ids, cache, cacheKeyFn, extra) {
		const ort = this.#ortNs;
		const total = cache.past + ids.length;
		const feed = {
			input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
		};
		// Only feed attention_mask if the graph declares it (LFM2.5 does; Moonshine's decoder does not).
		if (sess.inputNames.includes('attention_mask')) {
			feed.attention_mask = new ort.Tensor('int64', BigInt64Array.from({ length: total }, () => 1n), [1, total]);
		}
		Object.assign(feed, extra);
		if (cache.size === 0) Object.assign(feed, this.#seedCacheInputs(sess));
		for (const [name, t] of cache) feed[name] = t;

		const out = sess.run(feed, sess.outputNames);
		const argmax = this.#argmaxLast(out.logits);

		cache.clear();
		for (const inName of sess.inputNames) {
			if (inName === 'input_ids' || inName === 'attention_mask') continue;
			const t = out[cacheKeyFn(inName)];
			if (t) cache.set(inName, t);
		}
		cache.past = total;
		return argmax;
	}

	/** The empty-cache inputs the graph declares, once. */
	#seedCacheInputs(sess) {
		const ort = this.#ortNs;
		const feeds = {};
		for (const name of sess.inputNames) {
			if (name === 'input_ids' || name === 'attention_mask') continue;
			if (name.startsWith('past_conv')) feeds[name] = new ort.Tensor('float16', new Uint16Array(8192 * 3), [1, 8192, 3]);
			else if (name.startsWith('past_recurrent')) feeds[name] = new ort.Tensor('float16', new Uint16Array(32 * 128 * 128), [1, 32, 128, 128]);
			else if (name.startsWith('past_key_values')) feeds[name] = new ort.Tensor('float16', new Uint16Array(0), [1, 4, 0, 256]);
		}
		return feeds;
	}

	async #moonshineTranscribe(audio16k) {
		const { encoder, decoder } = await this.loadAsr();
		const ort = this.#ortNs;
		// Encoder: `input_values` = raw 16 kHz audio [1, T] -> `last_hidden_state` [1, T, D].
		// (The onnx-community encoder takes the waveform directly, not mel features.)
		const encIn = encoder.inputNames[0];
		const encOut = encoder.outputNames[0];
		const enc = encoder.run({ [encIn]: new ort.Tensor('float32', audio16k, [1, audio16k.length]) });
		const encOuts = enc[encOut];

		// The (non-merged) decoder takes the encoder output by its declared name, if present.
		const extra = {};
		for (const name of decoder.inputNames) {
			if (/encoder|hidden|memory/.test(name)) {
				extra[name] = new ort.Tensor('float32', Float32Array.from(this.#tensorData(encOuts)), encOuts.dims);
			}
		}

		// Decoder: autoregressive, one token at a time, until EOS or a length cap.
		const tok = await this.#moonshineTokenizer();
		const cacheKeyFn = this.#cacheKey(decoder);
		const cache = new Map();
		cache.past = 0;
		const maxLen = 200;
		const ids = [];
		for (let step = 0; step < maxLen; step++) {
			const next = this.#step(decoder, ids.length ? [ids[ids.length - 1]] : [1], cache, cacheKeyFn, extra);
			ids.push(next);
			if (tok.decode([next]) === '</s>' || ids.length >= maxLen) break;
		}
		return tok.decode(ids).trim();
	}

	// ---------------------------------------------------------------- LFM2.5 LLM
	//
	// NOTE: same caveat as the ASR — written on the standard causal-LM ONNX layout, introspecting
	// the session, NOT yet run against the real model on a GPU. Verify on a real device (M3 gate).

	async #llmGenerate(transcript, onToken, signal) {
		const session = await this.loadLlm();
		const tok = await this.#lfmTokenizer();
		const cacheKeyFn = this.#cacheKey(session);
		const cache = new Map();
		cache.past = 0;
		// A plain-text prompt. The LFM2.5 chat template's special tokens are not in the byte-level
		// vocab, so we use the role labels as plain text — the model follows them.
		const system = 'You are a voice assistant. Answer in one or two short spoken sentences. No lists, no markdown, no emoji.';
		const prompt = `system\n${system}\nuser\n${transcript}\nassistant\n`;
		const ids = tok.encode(prompt);
		const maxTokens = 96;
		let cur = this.#step(session, ids, cache, cacheKeyFn, {});
		for (let i = 0; i < maxTokens; i++) {
			if (signal?.aborted) throw new Error('aborted');
			if (cur === 2 || cur === 7) break; // eos / <|fim_suf|>
			// Emit the piece this token decodes to, so the sentence splitter sees one token at a time.
			onToken(tok.decode([cur]));
			cur = this.#step(session, [cur], cache, cacheKeyFn, {});
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
			let reply = '';
			const onToken = (piece) => {
				if (firstToken === null) {
					firstToken = performance.now() - tLlm0;
					this.latency.llmFirstToken = firstToken;
				}
				reply += piece;
				this.#emitEvent({ type: 'llm', text: reply });
				const sentence = this.sentence.feed(piece);
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
