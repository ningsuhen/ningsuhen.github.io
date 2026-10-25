// Design-system bundle: build public/design-system/rd.css from the sources in src/design-system/.
//
// Sources are the source of truth; the shipped files are generated:
//   - rd.css         the bundle (what new pages link)
//   - research.css   a compatibility alias, byte-identical to rd.css, for pages that still
//                    link or inline it (deleted once they migrate; see the export contract)
//   - manifest.json  version + content hashes, for cache-busting (?v=) and the bundle-fresh check
//
// Milestone 1 (this commit) is a faithful concatenation: rd.css is byte-identical to the
// pre-split research.css, so nothing changes visually. esbuild minify (and the `/*! rd … */`
// banner) are the later step — minifying changes the bytes, so it is opt-in via --minify and
// must not be on until the byte-equivalent milestone is merged.
//
// Runs as `prebuild` and `precommit`; idempotent and deterministic (no timestamps), so a fresh
// build always reproduces the committed bytes (that is what check:design-system's bundle-fresh
// rule asserts).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".");
const SRC = path.join(ROOT, "src/design-system");
const OUT = path.join(ROOT, "public/design-system");

// Fixed order: the concatenation must reproduce research.css exactly. tokens → base → the
// component layers, in the order they appear in the original file. (The fine-grained component
// split — button.css, chip.css, … — is a later step; these are the current section boundaries.)
const SOURCES = [
	"tokens.css",
	"base.css",
	"components/math.css",
	"components/icons.css",
	"components/layout.css",
];

const VERSION = "1.0.0";

/** Concatenate the sources in order. Pure: returns the bundle content and its hash. */
export function build() {
	const parts = SOURCES.map((rel) => readFileSync(path.join(SRC, rel), "utf8"));
	const content = parts.join("");
	const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
	const manifest = {
		version: VERSION,
		hash,
		files: { "rd.css": hash, "research.css": hash },
	};
	return { content, hash, manifest };
}

/** esbuild minify path (later step). Off by default: it changes the bytes, so milestone 1 stays a
 *  faithful concatenation. Kept here so the plumbing exists and is testable. */
async function minify(content) {
	const esbuild = await import("esbuild");
	const r = await esbuild.build({
		stdin: { contents: content, loader: "css", resolveDir: SRC },
		bundle: false,
		minify: true,
		write: false,
	});
	return r.outputFiles[0].text;
}

/** Write the generated files. Returns the manifest. */
function write(content, manifest) {
	writeFileSync(path.join(OUT, "rd.css"), content);
	writeFileSync(path.join(OUT, "research.css"), content); // compatibility alias
	writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

/** bundle-fresh: the committed generated files equal a fresh build from the sources. Non-mutating.
 *  Returns the list of problems (empty = fresh). Used by the pre-commit hook and check:design-system. */
export function checkFresh() {
	const { content, manifest } = build();
	const problems = [];
	const rd = path.join(OUT, "rd.css");
	const alias = path.join(OUT, "research.css");
	if (!existsSync(rd)) problems.push("public/design-system/rd.css is missing (run pnpm build)");
	else if (readFileSync(rd, "utf8") !== content) problems.push("public/design-system/rd.css is stale: it differs from a fresh build of src/design-system/ (run pnpm build)");
	if (!existsSync(alias)) problems.push("public/design-system/research.css (alias) is missing (run pnpm build)");
	else if (readFileSync(alias, "utf8") !== content) problems.push("public/design-system/research.css (alias) is stale: it differs from a fresh build of src/design-system/ (run pnpm build)");
	return problems;
}

async function main() {
	const check = process.argv.includes("--check");
	const minify = process.argv.includes("--minify");
	const { content: plain, hash, manifest } = build();
	if (check) {
		const problems = checkFresh();
		if (problems.length) {
			console.error(`design-system bundle not fresh:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
			process.exit(1);
		}
		console.log(`design-system bundle fresh: hash ${hash}`);
		return;
	}
	let content = plain;
	if (minify) {
		content = await minify(plain);
		// Re-hash the minified bytes so ?v= and the manifest track what actually ships.
		manifest.hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
		manifest.files = { "rd.css": manifest.hash, "research.css": manifest.hash };
	}
	write(content, manifest);
	console.log(`design-system bundle: rd.css ${content.length} bytes, hash ${manifest.hash}${minify ? " (minified)" : ""}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
