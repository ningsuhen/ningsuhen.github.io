// Public-leak guard. Scans what the site publishes (dist/, public/, src/content/, src/data/) and the
// public docs for local paths, machine and host names, personal contact details, secrets, `../` links
// that escape the site root, source maps, OS junk files and image metadata.
// Extra private terms (never committed): scripts/leak-denylist.local.txt, one literal per line.
// Run: pnpm check:leaks (after pnpm build). Scan any export folder: node scripts/check-public-leaks.mjs <dir>
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, inflateSync } from "node:zlib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DENYLIST = path.join(HERE, "leak-denylist.local.txt");
const EMBED_ALLOWLIST = path.join(HERE, "leak-embedded-allowlist.json");
const SCAN_DIRS = ["dist", "public", "src/content", "src/data"].map((d) => path.join(ROOT, d));
const DOC_FILES = ["CLAUDE.md", "README.md", "THIRD_PARTY_LICENSES.md", "LICENSE"].map((f) => path.join(ROOT, f));
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const FONT_EXT = /\.(woff2?|ttf|otf|eot)$/i; // binary glyph data: no text to scan

// Extensions that look like a domain after "@" (e.g. "name@2x.png") are filenames, not addresses.
const FILE_TLDS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "css", "js", "mjs", "ts", "json", "woff", "woff2", "ttf", "html", "md", "map", "xml", "txt", "pdf"]);
// Vendored Pagefind bundles: contributor credits (emails) and the upstream CI build paths compiled
// into its gzipped wasm runtime. Neither is the owner's data; the owner's build paths are never exempt.
const VENDOR_DIR = /[\\/]pagefind[\\/]/;

/** Masks a value that must not be echoed into CI logs. */
const redact = (s) => `${s.slice(0, 4)}...(${s.length} chars)`;

/** textOnly rules skip binary files (random bytes match them). @type {{id: string, re: RegExp, docs: boolean, textOnly?: boolean, allow?: (m: string, file: string) => boolean, canary: string}[]} */
const RULES = [
	{ id: "home-path", re: /\/Users\/[\w.-]+|\/home\/[a-z][\w.-]*\/|\b[A-Za-z]:\\+(?:Users|Documents)\b|file:\/\/\/?[A-Za-z]/g, docs: true, allow: (m, file) => /^\/(?:Users|home)\/runner\/?$/.test(m) && VENDOR_DIR.test(file), canary: "/Users/alice/git" },
	// Compiler paths baked into Rust wasm (panic locations, registry sources): they name the builder's home and toolchain.
	{ id: "build-path", re: /\/rustc\/[0-9a-f]{12,}|\.cargo\/registry|\.rustup\/toolchains/g, docs: true, allow: (_m, file) => VENDOR_DIR.test(file), canary: "/rustc/0123456789abcdef0123456789abcdef01234567/library/core" },
	{ id: "home-tilde", re: /(?<=[\s"'`(=,>])~\/[\w.-]/g, docs: true, textOnly: true, canary: "open ~/git/app" },
	{ id: "worktree-path", re: /\.worktrees\b|\.claude\/(?:worktrees|projects)\b/g, docs: false, textOnly: true, canary: ".worktrees/task" },
	{ id: "machine-name", re: /\bmac-?mini[\w-]*|\bmacmini\b/gi, docs: true, canary: "mac-mini" },
	{ id: "internal-host", re: /\b\w+-[\w-]*\.(?:local|lan|corp|internal|ts\.net)\b(?!\.[a-z])|https?:\/\/[\w.-]+\.(?:local|lan|corp|internal|ts\.net)\b(?!\.[a-z])/gi, docs: true, textOnly: true, canary: "https://box.lan/x" },
	{ id: "loopback-port", re: /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}\b/g, docs: false, textOnly: true, canary: "localhost:3000" },
	{ id: "private-ip", re: /(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])/g, docs: true, textOnly: true, canary: "192.168.1.20" },
	{
		id: "secret",
		re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:ant|proj)-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}|hf_[A-Za-z0-9]{30,})\b|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"'\s]{12,}["']/gi,
		docs: true,
		canary: `gh${"p"}_${"a".repeat(36)}`,
	},
	{
		id: "email",
		re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
		docs: true,
		textOnly: true,
		allow: (m, file) => {
			const tld = m.split(".").pop()?.toLowerCase() ?? "";
			if (VENDOR_DIR.test(file)) return true;
			return FILE_TLDS.has(tld) || /@(github\.com|users\.noreply\.github\.com|example\.(com|org|net)|(yourdomain|domain)\.com)$/i.test(m);
		},
		canary: "alice@acme-test.io",
	},
];
const CLEAN_CANARY = "https://ningsuhen.github.io/posts/brev-tree-benchmark/ v1.2.3 git@github.com";

/** Every regex hit in one line that the rule does not allow. */
function hitsIn(rule, line, file = "") {
	return [...line.matchAll(rule.re)].map((m) => m[0]).filter((m) => !rule.allow?.(m, file));
}

/** Self-test: the guard refuses to run if its own rules stop catching known-bad samples. */
function selfTest() {
	const failed = RULES.filter((rule) => hitsIn(rule, rule.canary).length === 0).map((r) => r.id);
	const falsePositives = RULES.filter((rule) => rule.docs && hitsIn(rule, CLEAN_CANARY).length > 0).map((r) => r.id);
	return [...failed.map((id) => `self-test: rule "${id}" misses its canary`), ...falsePositives.map((id) => `self-test: rule "${id}" flags clean text`)];
}

/** Lists every metadata segment that can carry EXIF/XMP/text/GPS data, for PNG, WebP and JPEG. */
function imageMetadata(buf) {
	const out = [];
	if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		const banned = new Set(["tEXt", "zTXt", "iTXt", "eXIf"]);
		for (let off = 8; off + 8 <= buf.length; ) {
			const len = buf.readUInt32BE(off);
			const type = buf.toString("latin1", off + 4, off + 8);
			if (banned.has(type)) out.push(`png chunk ${type}`);
			if (type === "IEND") break;
			off += 12 + len;
		}
	} else if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
		for (let off = 12; off + 8 <= buf.length; ) {
			const type = buf.toString("latin1", off, off + 4);
			const len = buf.readUInt32LE(off + 4);
			if (type === "EXIF" || type === "XMP ") out.push(`webp chunk ${type.trim()}`);
			off += 8 + len + (len % 2);
		}
	} else if (buf[0] === 0xff && buf[1] === 0xd8) {
		const banned = new Map([[0xe1, "APP1 (EXIF/XMP)"], [0xed, "APP13 (IPTC)"], [0xfe, "COM"]]);
		for (let i = 2; i + 4 <= buf.length && buf[i] === 0xff; ) {
			const marker = buf[i + 1];
			if (marker === 0xda) break; // start of scan: image data follows
			if (banned.has(marker)) out.push(`jpeg ${banned.get(marker)}`);
			i += 2 + buf.readUInt16BE(i + 2);
		}
	}
	return out;
}

/** Relative links and CSS urls in an HTML or CSS file that resolve outside its scan root. */
function escapingLinks(file, text, root) {
	const out = [];
	const refs = /\b(?:href|src|action|poster)\s*=\s*["']([^"'#?\s]*)|url\(\s*["']?([^"')\s#?]+)/gi;
	for (const m of text.matchAll(refs)) {
		const ref = m[1] ?? m[2] ?? "";
		if (!ref.includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(ref)) continue;
		const resolved = path.resolve(path.dirname(file), ref);
		if (resolved !== root && !resolved.startsWith(root + path.sep)) out.push(ref.slice(0, 60));
	}
	return out;
}

/**
 * Vendored ORT builds whose bytes are pinned by sha384 integrity in public/tts/kokoro.js. Their last line is a
 * bare `sourceMappingURL=<name>.map` comment; the map itself is never shipped and the name leaks nothing.
 * Stripping the comment would change the bytes and break the pinned hash, so these exact paths are exempt.
 */
const SOURCEMAP_KEPT = ["tts/vendor/ort/ort.webgpu.min.js"];
/** True for the pinned file at any scan root (public/ or dist/). */
const isSourceMapKept = (rel) => SOURCEMAP_KEPT.some((p) => rel === p || rel.endsWith(`/${p}`));

// ---- Embedded payloads ------------------------------------------------------------------
// A page can hide a build artifact inside a base64 blob (a data URI, `const WASM_B64 = "..."`, a JSON
// bundle). The blob decodes to gzip/deflate and then to wasm or text; the builder's home and toolchain
// paths live in the decoded bytes, invisible to a plain text scan. Decode every base64 blob and scan the
// result with the same rules. Opaque binary (fonts, images) is skipped: only gzip/deflate containers and
// wasm/text payloads are scanned.
const GZIP_MAGIC = [0x1f, 0x8b];
const ZLIB_MAGICS = [
	[0x78, 0x01],
	[0x78, 0x5b],
	[0x78, 0x9c],
	[0x78, 0xda],
];
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
const B64_MAX = 20_000_000; // base64 chars; ~15 MB of payload. Larger blobs are not scanned.
// Opaque binary media: a data URI of these types is never a text/wasm payload, so it is not decoded (a page's
// inlined fonts are the common case, and decoding megabytes of them is pure waste).
const OPAQUE_MIME = /^(?:font|image|audio|video)\//;
// A base64 blob, two forms: a data URI `data:<mime>;base64,<blob>` (m[1]=mime, m[2]=blob) or a quoted JS string
// `["']<blob>` (m[3]=blob). The base64 class stops at the first non-base64 char (the closing quote or paren).
const B64_BLOBS = /data:([a-z0-9.\/+-]+);base64,([A-Za-z0-9+/=]{32,})|["']([A-Za-z0-9+/=]{32,})/g;
const startsWith = (buf, magic) => magic.every((b, i) => buf[i] === b);
/** True if the head of a buffer is mostly printable ASCII (text, not opaque binary). */
const isTextish = (buf) => {
	const n = Math.min(buf.length, 4096);
	if (!n) return false;
	let ok = 0;
	for (let i = 0; i < n; i++) {
		const c = buf[i];
		if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) ok++;
	}
	return ok / n >= 0.9;
};
/** base64 → (gzip/deflate →) payload bytes, or null if it is not a scannable container/text. */
function decodePayload(b64) {
	let buf;
	try {
		buf = Buffer.from(b64, "base64");
	} catch {
		return null;
	}
	if (!buf.length) return null;
	if (startsWith(buf, GZIP_MAGIC)) {
		try {
			buf = gunzipSync(buf);
		} catch {
			return null;
		}
	} else if (ZLIB_MAGICS.some((m) => startsWith(buf, m))) {
		try {
			buf = inflateSync(buf);
		} catch {
			return null;
		}
	}
	return startsWith(buf, WASM_MAGIC) || isTextish(buf) ? buf : null;
}

/** The rule/denylist/source-map scan over one block of text. */
function scanLines(text, file, { docs, binary, redactAll }) {
	const problems = [];
	const lines = text.split("\n");
	const rules = RULES.filter((r) => (!docs || r.docs) && (!binary || !r.textOnly));
	const denylist = readDenylist();
	lines.forEach((line, i) => {
		for (const rule of rules) {
			for (const m of hitsIn(rule, line, file)) {
				// Decoded payloads can carry a username or build path; never echo the value, only a marker.
				const secret = redactAll || rule.id === "secret" || rule.id === "email";
				problems.push({ rule: rule.id, line: i + 1, match: secret ? redact(m) : m.slice(0, 80) });
			}
		}
		const lower = line.toLowerCase();
		denylist.forEach((term, k) => {
			if (lower.includes(term)) problems.push({ rule: "denylist", line: i + 1, match: `private term #${k + 1}` });
		});
		if (!docs && line.includes("sourceMappingURL=") && !isSourceMapKept(path.relative(ROOT, file))) problems.push({ rule: "source-map", line: i + 1, match: "sourceMappingURL" });
	});
	return problems;
}

/** Problems found in the base64 blobs embedded in a text file. Each is tagged `embedded`. */
function scanEmbedded(text, file, { docs }) {
	const problems = [];
	const seen = new Set();
	for (const m of text.matchAll(B64_BLOBS)) {
		const mime = m[1]; // data URI media type, or undefined for a bare quoted string
		if (mime && OPAQUE_MIME.test(mime)) continue; // fonts/images/audio/video: never a text/wasm payload
		const b64 = m[2] ?? m[3];
		if (b64.length > B64_MAX || seen.has(b64)) continue;
		seen.add(b64);
		const payload = decodePayload(b64);
		if (!payload) continue;
		const payloadText = payload.toString("latin1");
		const binary = payloadText.slice(0, 4096).includes("\0");
		const payloadSha = createHash("sha256").update(payload).digest("hex");
		for (const p of scanLines(payloadText, file, { docs, binary, redactAll: true })) problems.push({ ...p, embedded: true, payloadSha });
	}
	return problems;
}

/** Problems in one file, as {rule, line, match}. */
function scanFile(file, root, { docs }) {
	const problems = [];
	const name = path.basename(file);
	if (name === ".DS_Store" || name === "Thumbs.db") problems.push({ rule: "os-junk", line: 0, match: name });
	if (file.endsWith(".map")) problems.push({ rule: "source-map", line: 0, match: name });
	if (FONT_EXT.test(name)) return problems;
	let buf = readFileSync(file);
	if (IMAGE_EXT.test(name)) for (const m of imageMetadata(buf)) problems.push({ rule: "image-metadata", line: 0, match: m });
	if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
	const text = buf.toString("latin1");
	const binary = text.slice(0, 4096).includes("\0");
	problems.push(...scanLines(text, file, { docs, binary }));
	// Embedded base64 payloads only make sense inside a text file (a binary file is already scanned whole).
	if (!binary) problems.push(...scanEmbedded(text, file, { docs }));
	if (!docs && /\.(html?|css)$/i.test(name)) {
		for (const ref of escapingLinks(file, text, root)) problems.push({ rule: "escaping-link", line: 0, match: ref });
	}
	return problems;
}

/**
 * Time-boxed exceptions for embedded-payload leaks. Each entry names ONE file by path + sha256; it stops
 * applying the moment the file changes (a re-export) or after `expires`. This is a tripwire, not a blanket
 * skip: it suppresses only the `embedded` findings in that exact file, and only while its hash still matches.
 */
function readEmbedAllowlist() {
	if (!existsSync(EMBED_ALLOWLIST)) return { entries: [] };
	try {
		return JSON.parse(readFileSync(EMBED_ALLOWLIST, "utf8"));
	} catch (e) {
		return { entries: [], error: `cannot parse ${path.relative(ROOT, EMBED_ALLOWLIST)}: ${e.message}` };
	}
}

/**
 * Which embedded payloads are currently allowed, plus warnings for stale/expired entries. An entry pins the
 * sha256 of the DECODED payload (not the whole file): a page ships at both `public/…` and its `dist/…` build
 * copy, which differ only in the injected navbar/license, but carry the identical embedded payload. The entry
 * suppresses that payload everywhere; when the source is re-exported the payload changes and the entry stops
 * matching, so the leak fails again. `file` documents where it was found and is checked for staleness.
 */
function embedAllowlistState() {
	const { entries = [], error } = readEmbedAllowlist();
	const allowedPayloads = new Set(); // sha256 of payloads whose embedded findings are suppressed
	const warnings = [];
	if (error) warnings.push(error);
	const today = new Date().toISOString().slice(0, 10);
	for (const e of entries) {
		if (!e.payloadSha256) {
			warnings.push(`embed allowlist: entry for ${e.file} has no payloadSha256`);
			continue;
		}
		if (!existsSync(path.join(ROOT, e.file))) {
			warnings.push(`embed allowlist: ${e.file} no longer exists (stale entry)`);
			continue;
		}
		if (e.expires && e.expires < today) {
			warnings.push(`embed allowlist: ${e.file} expired on ${e.expires} — the embedded leak now fails until the source is fixed`);
			continue;
		}
		allowedPayloads.add(e.payloadSha256);
	}
	return { allowedPayloads, warnings };
}

/** Optional private terms, lower-cased. Missing file means none. */
function readDenylist() {
	if (!existsSync(DENYLIST)) return [];
	return readFileSync(DENYLIST, "utf8")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"))
		.map((l) => l.toLowerCase());
}

/** Every file under a directory, recursively. */
function* walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else if (entry.isFile()) yield full;
	}
}

function main() {
	const failures = selfTest();
	if (failures.length) {
		console.error(failures.join("\n"));
		process.exit(2);
	}
	const arg = process.argv[2];
	const targets = [];
	if (arg) {
		const dir = path.resolve(arg);
		if (!existsSync(dir)) {
			console.error(`check:leaks: ${dir} not found`);
			process.exit(2);
		}
		targets.push({ dir, root: dir, docs: false });
	} else {
		if (!existsSync(SCAN_DIRS[0])) {
			console.error("check:leaks: dist/ not found; run pnpm build first");
			process.exit(2);
		}
		for (const dir of SCAN_DIRS.filter((d) => existsSync(d))) targets.push({ dir, root: dir, docs: false });
		for (const file of DOC_FILES.filter((f) => existsSync(f))) targets.push({ dir: file, root: ROOT, docs: true, file });
	}
	const { allowedPayloads, warnings: embedWarnings } = embedAllowlistState();
	const found = [];
	let scanned = 0;
	for (const t of targets) {
		const files = t.file ? [t.file] : walk(t.dir);
		for (const file of files) {
			scanned += 1;
			const rel = path.relative(ROOT, file);
			for (const p of scanFile(file, t.root, { docs: t.docs })) {
				// A time-boxed, hash-pinned exception suppresses only the embedded findings of that exact payload,
				// wherever it ships (public/ and dist/ copies together). A re-export changes the payload and re-fails.
				if (p.embedded && allowedPayloads.has(p.payloadSha)) continue;
				found.push({ ...p, file: rel });
			}
		}
	}
	for (const w of embedWarnings) console.log(`warn: ${w}`);
	for (const p of found) console.log(`FAIL [${p.rule}] ${p.file}${p.line ? `:${p.line}` : ""}  ${p.match}`);
	const files = new Set(found.map((p) => p.file)).size;
	if (found.length) {
		console.log(`\n${found.length} leak finding(s) in ${files} file(s). Fix the source, or add a generic replacement; never allowlist a private term.`);
		process.exit(1);
	}
	console.log(`PASS: ${scanned} file(s) clean (${existsSync(DENYLIST) ? "denylist applied" : "no local denylist"}${allowedPayloads.size ? `, ${allowedPayloads.size} embedded payload exception(s) active` : ""}).`);
}

// Run only when invoked directly, so the decoder can be imported by the unit test without scanning the repo.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { decodePayload, scanEmbedded, scanLines, B64_BLOBS };
