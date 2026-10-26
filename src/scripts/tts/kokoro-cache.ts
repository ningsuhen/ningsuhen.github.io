/**
 * Browser storage for the Kokoro files. Entries live in Cache Storage under the name and URL keys that
 * kokoro.js reads, so a file stored here is the file the engine uses. A file counts as stored only when its
 * size matches the pinned manifest; every download is checked for size and SHA-256 before it is stored.
 */
import { Sha256 } from "./sha256";

export const CACHE_NAME = "kokoro-tts-v1";

export type KokoroVariant = "fp32" | "fp16" | "q8f16";

interface ManifestFile {
	bytes: number;
	sha256: string;
}

/** public/tts/manifest.json: the pinned Hugging Face revision and the size and SHA-256 of every file. */
export interface Manifest {
	base: string;
	files: Record<string, ManifestFile>;
	local: Record<string, ManifestFile>;
}

export interface FileSpec {
	key: string;
	url: string;
	bytes: number;
	sha256: string;
}

export async function loadManifest(url: string): Promise<Manifest> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`manifest returned ${response.status}`);
	return (await response.json()) as Manifest;
}

const MODEL_FILES: Record<KokoroVariant, string> = {
	fp32: "onnx/model.onnx",
	fp16: "onnx/model_fp16.onnx",
	q8f16: "onnx/model_q8f16.onnx",
};

/** The files one variant needs: its model, both voices, and the lexicon next to kokoro.js. */
export function specsFor(manifest: Manifest, variant: KokoroVariant, ttsUrl: string): FileSpec[] {
	const model = MODEL_FILES[variant];
	const remote = [model, "voices/af_heart.bin", "voices/am_michael.bin"].map((key) => ({
		key,
		url: manifest.base + key,
		...manifest.files[key],
	}));
	const local = Object.entries(manifest.local).map(([key, file]) => ({
		key,
		url: new URL(`./${key}`, ttsUrl).href,
		...file,
	}));
	return [...remote, ...local];
}

export function totalMB(specs: FileSpec[]): number {
	return Math.round(specs.reduce((sum, spec) => sum + spec.bytes, 0) / 1e6);
}

async function openCache(): Promise<Cache | null> {
	try {
		return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
	} catch {
		return null;
	}
}

/** Stored size of one entry, or -1 when absent. The content-length we store is checked; an entry without one is measured. */
async function storedSize(cache: Cache, url: string): Promise<number> {
	const hit = await cache.match(url).catch(() => undefined);
	if (!hit) return -1;
	const header = hit.headers.get("content-length");
	return header === null ? (await hit.blob()).size : Number(header);
}

/** True only when every file of the spec list is stored at its pinned size. */
export async function isCached(specs: FileSpec[]): Promise<boolean> {
	const cache = await openCache();
	if (!cache) return false;
	for (const spec of specs) {
		if ((await storedSize(cache, spec.url)) !== spec.bytes) return false;
	}
	return true;
}

/** Query key of a download that is not verified yet. Never read by the engine; removed after every download. */
const STAGING = "kokoro-staging";

/**
 * Downloads every file that is not stored yet. Nothing is stored under its real key unless its size and SHA-256
 * match the manifest. Each file streams from the network into Cache Storage under a staging key while it is
 * hashed chunk by chunk, so no download is ever held in memory whole (the fp32 model is 325 MB; holding it plus
 * a buffer for crypto.subtle.digest was the larger part of a multi-GB tab). Once verified, the stored copy is
 * moved to the real key (disk to disk). Partial downloads are discarded and restarted; stored files are kept.
 */
export async function download(
	specs: FileSpec[],
	onProgress: (received: number, total: number) => void,
	signal: AbortSignal,
): Promise<void> {
	const cache = await openCache();
	if (!cache) throw new Error("Cache Storage is not available in this browser");
	// Leftovers of an interrupted download (a closed tab) take quota and are never used.
	for (const request of await cache.keys()) {
		if (new URL(request.url).searchParams.has(STAGING)) await cache.delete(request);
	}
	const missing: FileSpec[] = [];
	for (const spec of specs) {
		if ((await storedSize(cache, spec.url)) !== spec.bytes) missing.push(spec);
	}
	const total = missing.reduce((sum, spec) => sum + spec.bytes, 0);
	let done = 0;
	for (const spec of missing) {
		await cache.delete(spec.url);
		const response = await fetch(spec.url, { signal, mode: "cors", credentials: "omit" });
		if (!response.ok || !response.body) throw new Error(`${spec.key}: HTTP ${response.status}`);
		const reader = response.body.getReader();
		const hash = new Sha256();
		let got = 0;
		// Pull-driven: Cache Storage asks for the next chunk only when it has written the last one.
		const body = new ReadableStream<Uint8Array>({
			async pull(controller) {
				const { done: finished, value } = await reader.read();
				if (finished) return controller.close();
				got += value.byteLength;
				if (got > spec.bytes) {
					await reader.cancel();
					return controller.error(new Error(`${spec.key}: more than the expected ${spec.bytes} bytes`));
				}
				hash.update(value);
				onProgress(done + got, total);
				controller.enqueue(value);
			},
			cancel: (reason) => reader.cancel(reason),
		});
		const staging = new URL(spec.url);
		staging.searchParams.set(STAGING, crypto.randomUUID?.() ?? String(Math.random()));
		try {
			await cache.put(staging.href, new Response(body, { headers: { "content-length": String(spec.bytes) } }));
			if (got !== spec.bytes) throw new Error(`${spec.key}: ${got} bytes, expected ${spec.bytes}`);
			if (hash.hex() !== spec.sha256) throw new Error(`${spec.key}: checksum does not match the pinned revision`);
			const verified = await cache.match(staging.href);
			if (!verified) throw new Error(`${spec.key}: the browser dropped the stored copy`);
			await cache.put(spec.url, verified);
		} finally {
			await cache.delete(staging.href).catch(() => false);
		}
		done += spec.bytes;
	}
	onProgress(total, total);
}

/** Deletes the whole Kokoro cache (this name only). */
export async function removeDownload(): Promise<void> {
	try {
		await caches.delete(CACHE_NAME);
	} catch {
		// Storage unavailable: nothing to remove.
	}
}

/** Asks the browser to keep the cache under storage pressure. Best effort; returns whether it was granted. */
export async function requestPersistence(): Promise<boolean> {
	try {
		return (await navigator.storage?.persist?.()) === true;
	} catch {
		return false;
	}
}

/** Storage used by this site, in MB, when the browser reports it. */
export async function storageUsageMB(): Promise<number | null> {
	try {
		const { usage } = (await navigator.storage?.estimate?.()) ?? {};
		return typeof usage === "number" ? Math.round(usage / 1e6) : null;
	} catch {
		return null;
	}
}
