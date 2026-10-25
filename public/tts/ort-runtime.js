// ONNX Runtime WebAssembly loader, shared by every feature that runs ONNX models on the site.
//
// The .wasm binary is not served from this site. It is fetched from a public Hugging Face repository at a pinned
// commit, checked against a pinned size and SHA-256, stored in Cache Storage, and handed to ONNX Runtime as bytes
// (env.wasm.wasmBinary). Nothing is used unless it matches. There is no automatic fallback host.
//
// The JavaScript that loads ONNX Runtime (ort.webgpu.min.js and its .mjs glue) stays in this repository.

/** ONNX Runtime Web version the pinned binary belongs to (same as the vendored JavaScript). */
export const ORT_VERSION = "1.27.0";
/** Public repository holding the binary, at a pinned commit (never a branch). */
export const ORT_WASM_URL =
	"https://huggingface.co/ningsuhen/onnxruntime-web-1.27.0/resolve/c25145ab811e50c175798b09cd6da3fc272d9411/ort-wasm-simd-threaded.asyncify.wasm";
export const ORT_WASM_BYTES = 24254953;
export const ORT_WASM_SHA256 = "7e83cd6cee77e478bc96a7e91b198144fb5e4126287daf1f9b54bb195ebcd55a";

const CACHE_NAME = "ort-runtime-v1";
const RETRY_DELAYS_MS = [500, 1500];

/** Cache key: a same-origin URL that names the version and the hash (Cache Storage keys must be URLs). */
const cacheKey = () => new URL(`/ort-wasm@${ORT_VERSION}/${ORT_WASM_SHA256}`, location.origin).href;

let wasmBinary = null;
let loading = null;

const toHex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

async function matchesPin(buffer) {
	if (buffer.byteLength !== ORT_WASM_BYTES) return false;
	return toHex(await crypto.subtle.digest("SHA-256", buffer)) === ORT_WASM_SHA256;
}

async function openCache() {
	try {
		return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
	} catch {
		return null;
	}
}

/** Fetches the pinned binary. Two retries with backoff on network or HTTP errors; never on a checksum mismatch. */
async function fetchPinned(onProgress, signal) {
	let lastError = null;
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
		if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
		try {
			const response = await fetch(ORT_WASM_URL, { mode: "cors", credentials: "omit", cache: "no-store", signal });
			if (!response.ok || response.type === "opaque" || !response.body) throw new Error(`HTTP ${response.status}`);
			const reader = response.body.getReader();
			const parts = [];
			let received = 0;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				parts.push(value);
				received += value.byteLength;
				onProgress?.(received / ORT_WASM_BYTES);
			}
			const buffer = new Uint8Array(received);
			let at = 0;
			for (const part of parts) {
				buffer.set(part, at);
				at += part.byteLength;
			}
			if (!(await matchesPin(buffer.buffer))) {
				throw Object.assign(new Error("ONNX Runtime failed its integrity check; the file was not used"), { name: "OrtIntegrityError" });
			}
			return buffer.buffer;
		} catch (err) {
			if (err?.name === "OrtIntegrityError" || err?.name === "AbortError") throw err;
			lastError = err;
		}
	}
	throw Object.assign(new Error(`host unavailable: the ONNX Runtime file could not be fetched (${lastError?.message ?? "network error"})`), { name: "OrtHostError" });
}

async function load(onProgress, signal) {
	const cache = await openCache();
	if (cache) {
		const hit = await cache.match(cacheKey()).catch(() => undefined);
		if (hit) {
			const buffer = await hit.arrayBuffer();
			if (await matchesPin(buffer)) {
				onProgress?.(1);
				return buffer;
			}
			// A stored copy that does not match is removed and never used.
			await cache.delete(cacheKey());
		}
	}
	const buffer = await fetchPinned(onProgress, signal);
	if (cache) {
		await cache
			.put(cacheKey(), new Response(buffer.slice(0), { headers: { "content-length": String(ORT_WASM_BYTES) } }))
			.catch(() => undefined);
	}
	onProgress?.(1);
	return buffer;
}

/**
 * Returns the verified binary, loading it from Cache Storage or the pinned host. Idempotent per page.
 * Rejects with OrtIntegrityError (mismatch) or OrtHostError (host unavailable after retries).
 */
export async function ensureOrtRuntime({ onProgress, signal } = {}) {
	installOrtHooks();
	if (wasmBinary) return wasmBinary;
	loading ??= load(onProgress, signal).then(
		(buffer) => {
			wasmBinary = buffer;
			return buffer;
		},
		(err) => {
			loading = null;
			throw err;
		},
	);
	return loading;
}

/** True when a verified copy is stored (checked by size and SHA-256). Does not download anything. */
export async function ortRuntimeCached() {
	const cache = await openCache();
	if (!cache) return false;
	const hit = await cache.match(cacheKey()).catch(() => undefined);
	return hit ? matchesPin(await hit.arrayBuffer()) : false;
}

/** Removes the stored binary and forgets the loaded copy. */
export async function removeOrtRuntime() {
	wasmBinary = null;
	loading = null;
	try {
		await caches.delete(CACHE_NAME);
	} catch {
		// Storage unavailable: nothing to remove.
	}
}

let hooked = false;

/**
 * Installs the hook that gives ONNX Runtime the verified bytes when its script defines `ort`. Before that script
 * runs, `window.ort` is an empty object (the loader reads `window.ort[INIT_SYMBOL]`). Session creations are
 * counted in window.__kokoroDiagnostics for the checks.
 */
export function installOrtHooks() {
	if (hooked) return;
	hooked = true;
	const existing = Object.getOwnPropertyDescriptor(window, "ort");
	if (existing && !existing.configurable) return;
	const diagnostics = (window.__kokoroDiagnostics ??= { sessionCreates: 0 });
	let current;
	Object.defineProperty(window, "ort", {
		configurable: true,
		get: () => current ?? {},
		set: (value) => {
			current = value;
			value.env.logLevel = "error";
			value.env.wasm.numThreads = 1;
			if (wasmBinary) value.env.wasm.wasmBinary = wasmBinary;
			const create = value.InferenceSession.create.bind(value.InferenceSession);
			value.InferenceSession.create = (...args) => {
				diagnostics.sessionCreates += 1;
				return create(...args);
			};
		},
	});
}
