// kokoro.js: Kokoro-82M neural speech for the Listen player, entirely in the visitor's browser.
//
// Contract: the site's src/scripts/tts/engine.ts. `createEngine()` returns a TtsEngine whose
// speak() is an AsyncIterable of { samples: Float32Array, sampleRate: 24000 }, one per chunk.
//
// Pipeline: text -> sentences -> G2P (misaki lexicon + letter-to-sound) -> chunks of <= 200
// phonemes (first <= 100, for a fast start) -> one Kokoro pass per chunk, in kokoro_bg.wasm,
// on ONNX Runtime Web: WebGPU with fp32, or single-threaded wasm with q8f16.
//
// Weights load straight from Hugging Face (CORS verified), are stored in the Cache API and
// handed to ONNX Runtime as a blob: URL. Nothing leaves the browser.

import initWasm, { Speaker, normalizeForSpeech, chunkForBudget } from './kokoro_glue.js';

/** Where the weights and voices come from. Override with init({ baseUrl }). */
export const MODEL_BASE = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/';
/** ONNX Runtime Web dist, pinned to the version tested. Override with init({ ortBase }). */
export const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
export const SAMPLE_RATE = 24000;
const CACHE = 'kokoro-tts-v1';
const LEXICON = 'lexicon-en-us.txt';
const LEXICON_BYTES = 4_592_212;
const VOICE_BYTES = 522_240;

/**
 * The two exports that work (measured, docs/speak.md). fp16 and q8f16 both fail on the WebGPU
 * EP, so q8f16 always runs on wasm, and fp32 is the only GPU variant.
 */
export const VARIANTS = {
	fp32: { file: 'onnx/model.onnx', bytes: 325_532_232, ortBytes: 24_254_953, accelerator: 'webgpu', label: 'Fast: GPU' },
	q8f16: { file: 'onnx/model_q8f16.onnx', bytes: 86_033_585, ortBytes: 24_254_953, accelerator: 'wasm', label: 'Light: CPU/WASM' },
};

/** First-visit download per variant, MB: model + ORT runtime + lexicon + one voice. */
export const DOWNLOAD_MB = Object.fromEntries(
	Object.entries(VARIANTS).map(([k, v]) => [k, Math.round((v.bytes + v.ortBytes + LEXICON_BYTES + VOICE_BYTES) / 1e6)]),
);

/** US voices only until a British lexicon ships. Grades from hexgrad VOICES.md. */
export const VOICES = [
	{ id: 'af_heart', name: 'Heart', lang: 'en-US', local: true },
	{ id: 'am_michael', name: 'Michael', lang: 'en-US', local: true },
];
const DEFAULT_VOICE = 'af_heart';

/** Shown by the player, verbatim. */
export const NOTICE =
	'Speech by Kokoro-82M (hexgrad, Apache-2.0), ONNX export by onnx-community. ' +
	'Training data includes Koniwa (CC BY 3.0) and SIWIS (CC BY 4.0).';

async function hasWebGPU() {
	try {
		return Boolean(navigator.gpu && (await navigator.gpu.requestAdapter()));
	} catch {
		return false;
	}
}

/** Cache API first, then the network, reporting bytes as they arrive. Works without the Cache API. */
async function fetchCached(url, onBytes) {
	let cache = null;
	try {
		cache = await caches.open(CACHE);
		const hit = await cache.match(url);
		if (hit) {
			const blob = await hit.blob();
			onBytes(blob.size);
			return blob;
		}
	} catch {
		cache = null; // private window, blocked storage: just download
	}
	const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
	if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
	const reader = r.body.getReader();
	const parts = [];
	let got = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		parts.push(value);
		got += value.length;
		onBytes(got);
	}
	const blob = new Blob(parts, { type: r.headers.get('content-type') ?? 'application/octet-stream' });
	try {
		await cache?.put(url, new Response(blob, { headers: { 'content-type': blob.type } }));
	} catch {
		// Quota: keep going uncached.
	}
	return blob;
}

class KokoroEngine {
	id = 'kokoro';
	label = 'Neural voice (Kokoro)';
	/** Both sizes, for the consent dialog: { fp32, q8f16 } in MB. */
	downloadMB = DOWNLOAD_MB;
	variants = VARIANTS;
	notice = NOTICE;

	#speaker = null;
	#variant = 'gpu' in navigator ? 'fp32' : 'q8f16';
	#accelerator = this.#variant === 'fp32' ? 'webgpu' : 'wasm';
	#base = MODEL_BASE;
	#generation = 0;
	#queue = Promise.resolve();
	#voiceLoads = new Map();
	#retries = 0;

	/** Extra passes spent recovering NaN chunks (a wasm int8 quirk), since init. */
	get retries() {
		return this.#retries;
	}

	/** MB for the variant init() will pick (a guess from `navigator.gpu` before init). */
	get requiresDownloadMB() {
		return DOWNLOAD_MB[this.#variant];
	}

	/** 'webgpu' or 'wasm'. Exact after init(). */
	get accelerator() {
		return this.#accelerator;
	}

	get variant() {
		return this.#variant;
	}

	/**
	 * @param {{ onProgress?: (f: number) => void, baseUrl?: string, ortBase?: string,
	 *           variant?: 'fp32' | 'q8f16' }} [opts]
	 */
	async init(opts = {}) {
		const gpu = await hasWebGPU();
		const variant = opts.variant ?? (gpu ? 'fp32' : 'q8f16');
		if (!VARIANTS[variant]) throw new Error(`unknown variant ${variant}`);
		this.#variant = variant;
		this.#base = new URL(opts.baseUrl ?? MODEL_BASE, location.href).href;
		const forceCpu = !(gpu && variant === 'fp32');
		const model = VARIANTS[variant];

		const total = model.bytes + LEXICON_BYTES + VOICE_BYTES;
		const seen = { model: 0, lexicon: 0, voice: 0 };
		const progress = (key) => (n) => {
			seen[key] = n;
			opts.onProgress?.(Math.min(1, (seen.model + seen.lexicon + seen.voice) / total));
		};

		await loadWasm();
		const [modelBlob, lexBlob] = await Promise.all([
			fetchCached(this.#base + model.file, progress('model')),
			fetchCached(new URL(`./${LEXICON}`, import.meta.url).href, progress('lexicon')),
		]);
		// ort-web waits forever on a runtime script that 404s; fail fast and say which.
		const ortBase = new URL(opts.ortBase ?? ORT_BASE, location.href).href;
		for (const f of ['ort.webgpu.min.js', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
			const r = await fetch(ortBase + f, { method: 'HEAD', mode: 'cors', credentials: 'omit' });
			if (!r.ok) throw new Error(`kokoro: ONNX Runtime file ${ortBase}${f} returned HTTP ${r.status}`);
		}
		const blobUrl = URL.createObjectURL(modelBlob);
		try {
			this.#speaker = await Speaker.load(blobUrl, ortBase, forceCpu);
		} finally {
			URL.revokeObjectURL(blobUrl);
		}
		this.#accelerator = this.#speaker.accelerator;
		this.#speaker.setLexicon(await lexBlob.text());
		await this.#voice(DEFAULT_VOICE, progress('voice'));
		opts.onProgress?.(1);
	}

	voices() {
		return VOICES.map((v) => ({ ...v }));
	}

	/** Text to phonemes, for checking a pronunciation. */
	phonemize(text) {
		return this.#speaker?.phonemize(text) ?? '';
	}

	/**
	 * @param {string} text
	 * @param {{ rate?: number, voice?: string | null, signal?: AbortSignal }} [opts]
	 * @returns {AsyncIterable<{ samples: Float32Array, sampleRate: number }>}
	 */
	speak(text, opts = {}) {
		return this.#stream(text, opts);
	}

	async *#stream(text, { rate = 1, voice = null, signal } = {}) {
		if (!this.#speaker) throw new Error('kokoro: call init() first');
		const mine = this.#generation;
		const stopped = () => signal?.aborted || mine !== this.#generation || !this.#speaker;
		const id = VOICES.some((v) => v.id === voice) ? voice : DEFAULT_VOICE;
		await this.#voice(id);
		// Kokoro's own speed control, so pitch is kept. Its range is 0.5-2.
		const speed = Math.min(2, Math.max(0.5, Number(rate) || 1));
		const chunks = await this.#serial(() => this.#speaker.plan(text));
		for (const [i, phonemes] of chunks.entries()) {
			if (stopped()) return;
			const samples = await this.#serial(async () => {
				const out = await this.#speaker.synth(phonemes, id, speed);
				this.#retries += this.#speaker.retries;
				return out;
			});
			if (stopped()) return;
			// Kokoro pads every pass with ~0.4 s of silence at each end; between two chunks of one
			// speak() call that doubles into a 0.8 s hole mid-sentence. Keep a clause-sized pause.
			yield { samples: trimEdges(samples, i > 0, i < chunks.length - 1), sampleRate: SAMPLE_RATE };
		}
	}

	/** Stop every running speak() after its current chunk. */
	cancel() {
		this.#generation += 1;
	}

	dispose() {
		this.cancel();
		const s = this.#speaker;
		this.#speaker = null;
		// Free after any in-flight pass settles; freeing mid-pass would trap the wasm.
		this.#queue.finally(() => s?.free());
	}

	/** One wasm call at a time: `synth` borrows the Speaker mutably. */
	#serial(fn) {
		const p = this.#queue.then(fn);
		this.#queue = p.catch(() => {});
		return p;
	}

	#voice(id, onBytes = () => {}) {
		if (!this.#voiceLoads.has(id)) {
			const load = fetchCached(`${this.#base}voices/${id}.bin`, onBytes)
				.then((b) => b.arrayBuffer())
				.then((buf) => this.#serial(() => this.#speaker.addVoice(id, new Uint8Array(buf))));
			load.catch(() => this.#voiceLoads.delete(id));
			this.#voiceLoads.set(id, load);
		}
		return this.#voiceLoads.get(id);
	}
}

/** Seconds of edge silence kept at a chunk join: two of these make a comma-length pause. */
const JOIN_PAD_S = 0.12;

/**
 * Drop leading and/or trailing silence (10 ms frames under -46 dBFS), keeping JOIN_PAD_S.
 * @param {Float32Array} w
 */
export function trimEdges(w, lead, trail) {
	const frame = 240;
	const pad = Math.round(JOIN_PAD_S * SAMPLE_RATE);
	const loud = (k) => {
		let ss = 0;
		const end = Math.min(w.length, k + frame);
		for (let j = k; j < end; j++) ss += w[j] * w[j];
		return ss / Math.max(1, end - k) > 0.005 * 0.005;
	};
	let start = 0;
	let end = w.length;
	if (lead) {
		while (start < w.length && !loud(start)) start += frame;
		start = Math.max(0, start - pad);
	}
	if (trail) {
		while (end > start && !loud(Math.max(start, end - frame))) end -= frame;
		end = Math.min(w.length, end + pad);
	}
	return start === 0 && end === w.length ? w : w.slice(start, end);
}

let wasmReady = null;
function loadWasm() {
	wasmReady ??= initWasm({ module_or_path: new URL('./kokoro_bg.wasm', import.meta.url) });
	return wasmReady;
}

/**
 * The Rust port of the site's normaliser (same 19 golden cases, plus links, versions, model
 * sizes, LaTeX-lite). Needs only the 538 KB wasm, not the model. speak() already applies it.
 * @returns {Promise<{ normalizeForSpeech: (t: string) => string, chunkForBudget: (t: string, budget: number) => string[] }>}
 */
export async function loadNormalizer() {
	await loadWasm();
	return { normalizeForSpeech, chunkForBudget: (t, budget = 300) => chunkForBudget(t, budget) };
}

/** The loader contract: `createEngine(): TtsEngine`. */
export function createEngine() {
	return new KokoroEngine();
}
