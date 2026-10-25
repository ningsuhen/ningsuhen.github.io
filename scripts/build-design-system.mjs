// Design-system bundle: build public/design-system/{rd.css, research.css, rd.js} from the sources
// in src/design-system/.
//
// Sources are the source of truth; the shipped files are generated:
//   - rd.css         the forward bundle: the frozen core + the new component layers. What new pages link.
//   - research.css   a compatibility alias, byte-identical to the pre-split research.css, for the pages
//                    that still link or inline it. It is the FROZEN core only — it does not grow with
//                    new components, so those pages keep their exact bytes. Deleted once they migrate.
//   - rd.js          the runtime (expnav, rail, fullscreen, …), esbuild-bundled and minified.
//   - manifest.json  version + content hashes, for cache-busting (?v=) and the bundle-fresh check.
//
// The core is a faithful concatenation of the original research.css, so the alias is byte-identical to
// the pre-split file and nothing changes visually for the pages that use it. New components (T3+) are
// added to EXTENSIONS and ship only in rd.css.
//
// Runs as `prebuild` and `precommit`; idempotent and deterministic (no timestamps), so a fresh build
// always reproduces the committed bytes (that is what check:design-system's bundle-fresh rule asserts).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".");
const SRC = path.join(ROOT, "src/design-system");
const OUT = path.join(ROOT, "public/design-system");

// The frozen core: the original research.css, split at its section boundaries. Their concatenation
// must reproduce the pre-split file exactly (milestone 1's byte-equivalence gate).
const CORE = [
	"tokens.css",
	"base.css",
	"components/math.css",
	"components/icons.css",
	"components/layout.css",
];

// New component layers (T3+). Appended to rd.css only; the research.css alias stays the frozen core.
const EXTENSIONS = ["components/fullscreen.css", "components/buttons.css", "components/filter.css", "components/field.css", "components/choice.css", "components/stepper.css", "components/chat.css", "components/quiz.css", "components/meter.css"];

// The runtime entry; esbuild bundles it (resolving the relative ./expnav.js etc.) into rd.js.
const JS_ENTRY = "js/index.js";

const VERSION = "1.1.0";
const BANNER = `/*! rd ${VERSION} */\n`;

const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const read = (rel) => readFileSync(path.join(SRC, rel), "utf8");

/** Build all outputs. Pure: returns the content and manifest, writes nothing. */
export async function build() {
	const core = CORE.map(read).join("");
	const extensions = EXTENSIONS.map(read).join("");
	const rdCss = core + extensions;
	const researchCss = core; // frozen alias

	const rdJs = await bundleJs();

	const manifest = {
		version: VERSION,
		hash: hash(rdCss),
		files: {
			"rd.css": hash(rdCss),
			"research.css": hash(researchCss),
			"rd.js": hash(rdJs),
		},
	};
	return { rdCss, researchCss, rdJs, manifest };
}

/** esbuild: bundle + minify the runtime, with the version banner. */
async function bundleJs() {
	const esbuild = await import("esbuild");
	const r = await esbuild.build({
		entryPoints: [path.join(SRC, JS_ENTRY)],
		bundle: true,
		minify: true,
		format: "esm", // shipped as <script type="module">; index.js sets window.rd itself
		legalComments: "none",
		write: false,
		platform: "browser",
		target: ["es2020"],
	});
	return BANNER + r.outputFiles[0].text;
}

/** Write the generated files. */
function write({ rdCss, researchCss, rdJs, manifest }) {
	writeFileSync(path.join(OUT, "rd.css"), rdCss);
	writeFileSync(path.join(OUT, "research.css"), researchCss); // frozen compatibility alias
	writeFileSync(path.join(OUT, "rd.js"), rdJs);
	writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

/** bundle-fresh: the committed generated files equal a fresh build from the sources. Non-mutating.
 *  Returns the list of problems (empty = fresh). Used by the pre-commit hook and check:design-system. */
export async function checkFresh() {
	const { rdCss, researchCss, rdJs, manifest } = await build();
	const problems = [];
	const check = (rel, content) => {
		const p = path.join(OUT, rel);
		if (!existsSync(p)) problems.push(`public/design-system/${rel} is missing (run pnpm build)`);
		else if (readFileSync(p, "utf8") !== content) problems.push(`public/design-system/${rel} is stale: it differs from a fresh build of src/design-system/ (run pnpm build)`);
	};
	check("rd.css", rdCss);
	check("research.css", researchCss);
	check("rd.js", rdJs);
	return { problems, manifest };
}

async function main() {
	const check = process.argv.includes("--check");
	const { rdCss, researchCss, rdJs, manifest } = await build();
	if (check) {
		const { problems } = await checkFresh();
		if (problems.length) {
			console.error(`design-system bundle not fresh:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
			process.exit(1);
		}
		console.log(`design-system bundle fresh: rd.css ${manifest.files["rd.css"]}, rd.js ${manifest.files["rd.js"]}`);
		return;
	}
	write({ rdCss, researchCss, rdJs, manifest });
	console.log(`design-system bundle: rd.css ${rdCss.length} bytes (${manifest.files["rd.css"]}), research.css ${researchCss.length} bytes (frozen), rd.js ${rdJs.length} bytes (${manifest.files["rd.js"]})`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
