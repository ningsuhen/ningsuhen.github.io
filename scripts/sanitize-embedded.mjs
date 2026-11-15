// sanitize-embedded: the "generic replacement" the leak check asks for, for payloads embedded in a page as base64
// (a gzip+base64 wasm whose panic locations carry the builder's home and toolchain paths).
//
// Every leak-rule match inside a decoded payload (the same rules and decoder as scripts/check-public-leaks.mjs) is
// overwritten in place with the same number of "x" bytes, so a wasm keeps its exact layout: no data-segment offset or
// string length moves, and the module is compiled to prove it is still valid before anything is written. The payload is
// re-encoded in the container it came in (gzip, deflate or raw) and the page is rewritten only when something changed.
// Values are never printed, only rule ids and counts.
//
// The source fix belongs in the exporting project's build (path remapping); this cleans an export that already shipped.
// Usage: node scripts/sanitize-embedded.mjs <file>... [--check]   (--check: exit 1 if a file would change, write nothing)
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, gunzipSync, gzipSync, inflateSync } from "node:zlib";
import { B64_BLOBS, RULES, decodePayload } from "./check-public-leaks.mjs";

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
const isWasm = (b) => WASM_MAGIC.every((v, i) => b[i] === v);

/** The container a base64 blob decodes through, so the clean payload is re-encoded the same way. */
function container(raw) {
	if (raw[0] === 0x1f && raw[1] === 0x8b) return { name: "gzip", open: gunzipSync, close: (b) => gzipSync(b, { level: 9 }) };
	if (raw[0] === 0x78) return { name: "deflate", open: inflateSync, close: (b) => deflateSync(b, { level: 9 }) };
	return { name: "raw", open: (b) => b, close: (b) => b };
}

/** Overwrite every leak-rule match in a payload with "x" of the same length. Returns { bytes, counts }. */
export function scrub(payload) {
	const bytes = Buffer.from(payload);
	const text = bytes.toString("latin1"); // one char per byte, so a match index is a byte offset
	const binary = text.slice(0, 4096).includes("\0");
	const counts = {};
	for (const rule of RULES) {
		if (binary && rule.textOnly) continue;
		for (const m of text.matchAll(new RegExp(rule.re.source, rule.re.flags))) {
			bytes.fill(0x78, m.index, m.index + m[0].length);
			counts[rule.id] = (counts[rule.id] ?? 0) + 1;
		}
	}
	return { bytes, counts };
}

/** Clean one page's embedded payloads. Returns { text, changes } (changes: one entry per cleaned blob). */
export async function sanitizeText(text) {
	const changes = [];
	const seen = new Map();
	for (const m of text.matchAll(B64_BLOBS)) {
		const b64 = m[2] ?? m[3];
		if (seen.has(b64) || !decodePayload(b64)) continue;
		const raw = Buffer.from(b64, "base64");
		const box = container(raw);
		const payload = box.open(raw);
		const { bytes, counts } = scrub(payload);
		if (!Object.keys(counts).length) {
			seen.set(b64, b64);
			continue;
		}
		if (isWasm(payload)) await WebAssembly.compile(bytes); // throws if the module is no longer valid
		const clean = box.close(bytes).toString("base64");
		seen.set(b64, clean);
		changes.push({ container: box.name, wasm: isWasm(payload), bytes: payload.length, counts });
	}
	let out = text;
	for (const [from, to] of seen) if (from !== to) out = out.split(from).join(to);
	return { text: out, changes };
}

async function main() {
	const args = process.argv.slice(2);
	const check = args.includes("--check");
	const files = args.filter((a) => a !== "--check");
	if (!files.length) {
		console.error("usage: node scripts/sanitize-embedded.mjs <file>... [--check]");
		process.exit(2);
	}
	let dirty = 0;
	for (const file of files) {
		const before = readFileSync(file, "utf8");
		const { text, changes } = await sanitizeText(before);
		for (const c of changes) console.log(`${file}: ${c.wasm ? "wasm" : "text"} payload (${c.container}, ${c.bytes} B): ${Object.entries(c.counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
		if (text === before) continue;
		dirty++;
		if (!check) writeFileSync(file, text);
	}
	if (check && dirty) {
		console.error(`${dirty} file(s) carry embedded leaks; run without --check to clean them.`);
		process.exit(1);
	}
	console.log(dirty ? `${check ? "would clean" : "cleaned"} ${dirty} file(s)` : "nothing to clean");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
