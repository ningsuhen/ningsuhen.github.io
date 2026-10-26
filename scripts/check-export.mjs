// check:export — validate standalone page fragments against the fragment contract v1.
//
// A fragment is a folder src/standalone/<kind>/<slug>/ holding meta.json, body.html and (optionally)
// page.css and page.js. The Astro shell (src/layouts/StandaloneShell.astro) supplies all the chrome;
// the fragment supplies content only. This validator is the gate that keeps a fragment conformant
// before it is rendered: it checks the meta schema, the forbidden markup in body.html, the page.css
// prefix and budget, the tab ids, that every Lucide icon exists, that links/assets resolve, that the
// slug does not collide with the old public/ injection path, and that nothing leaks.
//
// It is dependency-free (node built-ins only) and self-contained, so it can be copied into a
// generator repo's CI to validate an export before it is copied in. The meta schema mirrors
// src/standalone/loader.ts (the shell's Zod loader) — keep the two in sync.
//
// Run: pnpm check:export            (every fragment under src/standalone/)
//      pnpm check:export <dir>      (the fragments under <dir>: a fragment folder, a kind folder, or the root)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// Contract constants (fragment contract v1).
const CSS_MAX = 4 * 1024; // page.css <= 4 KB
const DATA_MAX = 100 * 1024; // <script data-rd-data> <= 100 KB (larger data goes to a same-origin sidecar)
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// The shell renders the "· created · updated" stamp from meta; the title must not carry it of its own.
const DATE_STAMP_RE =
	/·\s*created\s+\d{4}-\d{2}-\d{2}\s*·\s*updated\s+\d{4}-\d{2}-\d{2}/;

// body.html is content only. These document/chrome tags are supplied by the shell and are forbidden.
const FORBIDDEN_TAGS = /<(?:html|head|body|style|link|iframe)\b/gi;
// Chrome markers the shell injects (a fragment must not ship its own).
const CHROME_MARKERS = [
	["data-site-navbar", "the navbar"],
	["data-site-license", "the license footer"],
	["data-site-comments", "the comments section"],
	["data-site-breadcrumb", "the breadcrumb"],
	["rd-breadcrumb", "the breadcrumb"],
	["rd-expnav", "the section bar"],
	["rd-toc", "the rail"],
	["rd-hero", "the hero"],
];

// ---- meta.json ---------------------------------------------------------------------------
// Mirrors src/standalone/loader.ts metaSchema (dependency-free, no Zod).
function validateMeta(meta, kind, slug) {
	const p = [];
	const str = (v, name) => {
		if (typeof v !== "string" || !v)
			p.push(`meta.${name}: missing or not a non-empty string`);
	};
	if (meta.contract !== 1)
		p.push(`meta.contract: must be 1 (got ${JSON.stringify(meta.contract)})`);
	str(meta.kind, "kind");
	str(meta.slug, "slug");
	str(meta.title, "title");
	str(meta.summary, "summary");
	if (meta.kind && meta.kind !== kind)
		p.push(`meta.kind "${meta.kind}" does not match the folder kind "${kind}"`);
	if (meta.slug && meta.slug !== slug)
		p.push(`meta.slug "${meta.slug}" does not match the folder slug "${slug}"`);
	if (typeof meta.slug === "string" && !SLUG_RE.test(meta.slug))
		p.push(`meta.slug "${meta.slug}" is not kebab-case`);
	if (typeof meta.created !== "string" || !DATE_RE.test(meta.created))
		p.push(`meta.created "${meta.created}" is not YYYY-MM-DD`);
	if (typeof meta.updated !== "string" || !DATE_RE.test(meta.updated))
		p.push(`meta.updated "${meta.updated}" is not YYYY-MM-DD`);
	if (typeof meta.title === "string" && DATE_STAMP_RE.test(meta.title))
		p.push(
			"meta.title carries a date stamp (the shell renders it; keep the title clean)",
		);
	if (meta.width !== undefined && !["post", "wide"].includes(meta.width))
		p.push(`meta.width "${meta.width}" must be "post" or "wide"`);
	if (meta.layout !== undefined && !["tabbed", "scroll"].includes(meta.layout))
		p.push(`meta.layout "${meta.layout}" must be "tabbed" or "scroll"`);
	if (meta.comments !== undefined && typeof meta.comments !== "boolean")
		p.push("meta.comments must be a boolean");
	if (meta.search !== undefined && typeof meta.search !== "boolean")
		p.push("meta.search must be a boolean");
	if (meta.eyebrow !== undefined && typeof meta.eyebrow !== "string")
		p.push("meta.eyebrow must be a string");
	if (meta.icons !== undefined) {
		if (!Array.isArray(meta.icons) || meta.icons.some((n) => typeof n !== "string" || !SLUG_RE.test(n)))
			p.push('meta.icons must be an array of kebab-case Lucide names (icons the page creates in page.js)');
	}
	if (meta.source !== undefined) {
		if (typeof meta.source !== "object" || meta.source === null)
			p.push("meta.source must be an object");
		else {
			if (typeof meta.source.project !== "string" || !meta.source.project)
				p.push("meta.source.project: missing");
			if (typeof meta.source.build !== "string" || !meta.source.build)
				p.push("meta.source.build: missing (the build hash)");
		}
	}
	return p;
}

// ---- body.html ---------------------------------------------------------------------------
// Mask the data-rd-data JSON (its string values can contain "<body" etc.) so the markup scan is not
// fooled. The size check runs on the unmasked body.
function maskDataScripts(body) {
	return body.replace(
		/<script\b[^>]*data-rd-data[^>]*>[\s\S]*?<\/script>/gi,
		(s) => " ".repeat(s.length),
	);
}

// Pre-rendered Mermaid diagrams (the design system's own output, `id="mmd-…"`) are self-contained
// inline SVG that carries an internal <style> block and style= presentation attributes. They are a
// documented exception to the "no <style>, no style= beyond --*" body rules; a hand-rolled <style>
// or style= anywhere else is still flagged. No nested <svg>, so the non-greedy match is safe.
function maskMermaid(body) {
	return body.replace(/<svg\b[^>]*\bid="mmd-[^"]*"[^>]*>[\s\S]*?<\/svg>/gi, (s) =>
		" ".repeat(s.length),
	);
}

function validateBody(body, meta) {
	const p = [];
	const masked = maskMermaid(maskDataScripts(body));
	for (const m of masked.matchAll(FORBIDDEN_TAGS))
		p.push(
			`forbidden <${m[0].slice(1).toLowerCase()}> in body.html (the shell supplies the document and chrome)`,
		);
	for (const [marker, what] of CHROME_MARKERS)
		if (masked.includes(marker))
			p.push(`body.html ships ${what} ("${marker}"); the shell injects it`);
	// Executable scripts: only <script type="application/json" data-rd-data> is allowed.
	for (const m of masked.matchAll(/<script\b[^>]*>/gi)) {
		const tag = m[0];
		if (
			!(/type=["']application\/json["']/i.test(tag) && /data-rd-data/.test(tag))
		)
			p.push(
				`executable <script> in body.html (only <script type="application/json" data-rd-data> is allowed): ${tag.slice(0, 60)}`,
			);
	}
	// Inline event handlers (on*=). The lookbehind skips data-on* attributes.
	for (const m of masked.matchAll(/(?<![\w-])on[a-z]+\s*=/gi))
		p.push(`inline event handler "${m[0].trim()}" (forbidden)`);
	// Icons: data-rd-icon must be a kebab-case Lucide name (no emoji or glyph).
	for (const m of masked.matchAll(/data-rd-icon=["']([^"']+)["']/gi))
		if (!SLUG_RE.test(m[1]))
			p.push(
				`data-rd-icon "${m[1]}" is not a kebab-case Lucide icon name (no emoji or glyph)`,
			);
	// Inline style: only custom properties (--*) are allowed.
	for (const m of masked.matchAll(/style=["']([^"']*)["']/gi)) {
		for (const d of m[1]
			.split(";")
			.map((s) => s.trim())
			.filter(Boolean))
			if (!d.startsWith("--"))
				p.push(
					`inline style "${d}" (only custom properties --* are allowed in body.html)`,
				);
	}
	// data-rd-data budget (on the real, unmasked content).
	for (const m of body.matchAll(
		/<script\b[^>]*data-rd-data[^>]*>([\s\S]*?)<\/script>/gi,
	)) {
		const n = Buffer.byteLength(m[1], "utf8");
		if (n > DATA_MAX)
			p.push(
				`data-rd-data is ${n} bytes (> 100 KB); move it to a same-origin sidecar file`,
			);
	}
	// Tab ids: a tabbed layout derives its tabs from <section data-rd-tab="id" data-rd-label="…">.
	if (meta.layout === "tabbed") {
		const tabs = [
			...masked.matchAll(/<section\b[^>]*\bdata-rd-tab="([^"]+)"[^>]*>/g),
		];
		if (!tabs.length)
			p.push(
				`layout is "tabbed" but body.html has no <section data-rd-tab="…">`,
			);
		const seen = new Set();
		for (const t of tabs) {
			if (!/\bdata-rd-label="/.test(t[0]))
				p.push(`tab "${t[1]}" is missing data-rd-label`);
			if (seen.has(t[1])) p.push(`duplicate tab id "${t[1]}"`);
			seen.add(t[1]);
		}
	}
	return p;
}

// ---- page.css ------------------------------------------------------------------------------
// Selectors at the top level and inside @-rules (a fragment's CSS is small; this is a pragmatic
// extractor, not a full parser). @-rule preludes are skipped.
const AT_RULES = new Set([
	"font-face",
	"keyframes",
	"media",
	"supports",
	"page",
	"charset",
	"import",
	"namespace",
	"layer",
	"scope",
	"container",
	"property",
]);
function cssSelectors(css) {
	const out = [];
	for (const m of css
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.matchAll(/([^{}@]+)\{/g)) {
		for (const s of m[1].split(",")) {
			const t = s.trim();
			// Skip @-rule preludes (media/…/keyframes/…) and bare @-rule names (font-face).
			if (
				!t ||
				AT_RULES.has(t) ||
				/min-width|max-width|prefers-|orientation/.test(t)
			)
				continue;
			out.push(t);
		}
	}
	return out;
}
function cssDeclarations(css) {
	const out = [];
	for (const m of css
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.matchAll(/\{([^{}]*)\}/g)) {
		for (const d of m[1].split(";")) {
			const i = d.indexOf(":");
			if (i === -1) continue;
			const prop = d.slice(0, i).trim();
			const val = d.slice(i + 1).trim();
			if (prop && val) out.push([prop, val]);
		}
	}
	return out;
}

function validateCss(css, slug) {
	const p = [];
	if (!css) return p; // page.css is optional
	if (Buffer.byteLength(css, "utf8") > CSS_MAX)
		p.push(`page.css is ${Buffer.byteLength(css, "utf8")} bytes (> 4 KB)`);
	if (/@font-face/i.test(css)) p.push("page.css: @font-face is forbidden");
	if (/prefers-color-scheme/i.test(css))
		p.push(
			"page.css: prefers-color-scheme is forbidden (the design system owns light/dark)",
		);
	if (/--rd-[a-z-]+\s*:/i.test(css))
		p.push("page.css: redefines a --rd-* design-system token");
	const prefix = `[data-page="${slug}"]`;
	for (const sel of cssSelectors(css)) {
		if (!sel.startsWith(prefix))
			p.push(
				`page.css selector is not prefixed with ${prefix} (no bare elements): "${sel}"`,
			);
		else if (/(^|[\s,[])\.rd-[a-z]/i.test(sel) || /data-rd-[a-z]/i.test(sel))
			p.push(`page.css overrides a design-system rd-* component: "${sel}"`);
	}
	for (const [prop, val] of cssDeclarations(css)) {
		if (prop.startsWith("--")) continue; // a custom property may hold a raw value
		if (/#([0-9a-f]{3,8})\b|\b(?:rgb|hsl)\(/i.test(val))
			p.push(`page.css raw colour in "${prop}: ${val}" (use a --rd-* token)`);
		if (/\b\d+(?:\.\d+)?(?:px|em|rem|vw|vh)\b/.test(val))
			p.push(`page.css raw size in "${prop}: ${val}" (use a --rd-* token)`);
	}
	return p;
}

// ---- page.js -------------------------------------------------------------------------------
function validateJs(js) {
	const p = [];
	if (!js) return p; // page.js is optional
	if (!/export\s+default/.test(js))
		p.push(`page.js must "export default init({ root, data, rd })"`);
	if (/\bhistory\.(?:pushState|replaceState|go|back|forward)\b/.test(js))
		p.push(
			"page.js: history calls are forbidden (the shell and rd.js own navigation)",
		);
	if (/https?:\/\//.test(js))
		p.push(
			"page.js: external URL (no external requests; use same-origin sidecars)",
		);
	if (/\bwindow\./.test(js))
		p.push(
			`page.js: "window." is a global (use the init API: { root, data, rd })`,
		);
	if (/\bdocument\./.test(js))
		p.push(
			`page.js: "document." is a global (use the init API: { root, data, rd })`,
		);
	return p;
}

// ---- Lucide icons --------------------------------------------------------------------------
function validateIcons(body, problems) {
	const names = new Set();
	for (const m of body.matchAll(/data-rd-icon=["']([a-z0-9-]+)["']/gi))
		names.add(m[1]);
	for (const m of body.matchAll(/#i-([a-z0-9-]+)/g)) names.add(m[1]);
	if (!names.size) return;
	const iconPath = path.join(
		ROOT,
		"node_modules/@iconify-json/lucide/icons.json",
	);
	if (!existsSync(iconPath)) {
		problems.push(
			`note: @iconify-json/lucide not installed; skipped the Lucide existence check for ${[...names].join(", ")}`,
		);
		return;
	}
	const lucide = JSON.parse(readFileSync(iconPath, "utf8"));
	const known = new Set([
		...Object.keys(lucide.icons ?? {}),
		...Object.keys(lucide.aliases ?? {}),
	]);
	for (const n of names)
		if (!known.has(n))
			problems.push(`Lucide icon "${n}" not found in @iconify-json/lucide`);
}

// ---- links and assets ----------------------------------------------------------------------
// Relative refs resolve against the fragment's runtime asset dir (public/<kind>/<slug>/); site-absolute
// refs (/…) against public/. External http(s)/mailto/tel, in-page #anchors and same-page ?query
// navigations (e.g. ?tab=…#… — always the fragment's own URL) are navigations, not subresources, and
// are allowed.
function validateLinks(body, kind, slug) {
	const p = [];
	const base = path.join(ROOT, "public", kind, slug);
	for (const ref of new Set(
		[...body.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map(
			(m) => m[1],
		),
	)) {
		if (/^(?:https?:|mailto:|tel:|#|\?)/.test(ref)) continue;
		let target = ref.startsWith("/")
			? path.join(ROOT, "public", ref)
			: path.resolve(base, ref);
		if (ref.endsWith("/")) target = path.join(target, "index.html");
		if (!existsSync(target))
			p.push(
				`link/asset "${ref}" does not resolve (${path.relative(ROOT, target)})`,
			);
	}
	return p;
}

// ---- public/ collision ---------------------------------------------------------------------
// The registry fails the build if a slug exists in both forms (the old public/ injection path and the
// new fragment). A fragment and its old page must not both ship at /<kind>/<slug>/.
function publicCollision(kind, slug) {
	const p = [];
	if (existsSync(path.join(ROOT, "public", kind, slug, "index.html")))
		p.push(
			`public/${kind}/${slug}/index.html exists: the slug is in both the old injection path and the new fragment (move or delete the old page)`,
		);
	return p;
}

// ---- leak scan -----------------------------------------------------------------------------
// Reuse the maintained rules from check-public-leaks.mjs when it is present (this repo); fall back to a
// built-in scan in a generator repo where the file has not been copied.
const FALLBACK_RULES = [
	{
		id: "home-path",
		re: /\/Users\/[\w.-]+|\/home\/[a-z][\w.-]*\/|\b[A-Za-z]:\\+(?:Users|Documents)\b/g,
	},
	{ id: "machine-name", re: /\bmac-?mini[\w-]*|\bmacmini\b/gi },
	{
		id: "internal-host",
		re: /\b\w+-[\w-]*\.(?:local|lan|corp|internal|ts\.net)\b(?!\.[a-z])/gi,
	},
	{
		id: "private-ip",
		re: /(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3})(?![\d.])/g,
	},
	{
		id: "secret",
		re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:ant|proj)-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g,
	},
	{
		id: "email",
		re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
	},
];
function fallbackScanFile(file, root) {
	const out = [];
	const text = readFileSync(file, "utf8");
	text.split("\n").forEach((line, i) => {
		for (const rule of FALLBACK_RULES)
			for (const m of line.matchAll(rule.re))
				out.push({ rule: rule.id, line: i + 1, match: m[0].slice(0, 80) });
		for (const m of line.matchAll(
			/\b(?:href|src)\s*=\s*["'](\.\.[^"']*)["']/g,
		)) {
			const resolved = path.resolve(path.dirname(file), m[1]);
			if (resolved !== root && !resolved.startsWith(root + path.sep))
				out.push({
					rule: "escaping-link",
					line: i + 1,
					match: m[1].slice(0, 60),
				});
		}
	});
	return out;
}
async function validateLeaks(fragDir) {
	const p = [];
	let scanFile = null;
	try {
		({ scanFile } = await import("./check-public-leaks.mjs"));
	} catch {
		scanFile = null; // generator repo: the scanner was not copied in
	}
	for (const file of walk(fragDir)) {
		const issues = scanFile
			? scanFile(file, fragDir, { docs: false })
			: fallbackScanFile(file, fragDir);
		for (const issue of issues)
			p.push(
				`leak [${issue.rule}] ${path.relative(ROOT, file)}${issue.line ? `:${issue.line}` : ""}  ${issue.match}`,
			);
	}
	if (!scanFile)
		p.push(
			"note: check-public-leaks.mjs not found; used the built-in leak scan (copy it into the generator repo for the full rules)",
		);
	return p;
}

// ---- discovery -----------------------------------------------------------------------------
// A fragment is a directory holding both meta.json and body.html.
function* walk(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(full);
		else if (e.isFile()) yield full;
	}
}
function findFragments(root) {
	const out = [];
	const isFrag = (d) =>
		existsSync(path.join(d, "meta.json")) &&
		existsSync(path.join(d, "body.html"));
	const rec = (d) => {
		if (isFrag(d)) return out.push(d);
		let entries;
		try {
			entries = readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) if (e.isDirectory()) rec(path.join(d, e.name));
	};
	rec(root);
	return out;
}

// ---- self-test -----------------------------------------------------------------------------
// The validator refuses to run if its own detectors stop catching known-bad samples.
function selfTest() {
	const bad = (fn, input, label) =>
		fn(input).length === 0 ? `self-test: ${label} missed its canary` : null;
	const good = (fn, input, label) =>
		fn(input).length > 0 ? `self-test: ${label} was wrongly flagged` : null;
	const checks = [
		bad(
			(m) => validateMeta(m, "research", "x"),
			{
				contract: 2,
				kind: "research",
				slug: "x",
				title: "t",
				created: "2026-01-01",
				updated: "2026-01-01",
				summary: "s",
			},
			"meta.contract",
		),
		bad(
			(b) => validateBody(b, { layout: "scroll" }),
			'<iframe src="x"></iframe>',
			"forbidden <iframe>",
		),
		bad(
			(b) => validateBody(b, { layout: "scroll" }),
			'<button onclick="f()">x</button>',
			"on* handler",
		),
		good(
			(b) => validateBody(b, { layout: "scroll" }),
			'<svg id="mmd-x" style="width:100px"><style>#mmd-x{font-size:14px}</style><rect style="fill:#fff"/></svg>',
			"pre-rendered Mermaid SVG (internal <style>/style= is its own output)",
		),
		bad(
			(b) => validateBody(b, { layout: "scroll" }),
			'<div><style>.x{color:#fff}</style></div>',
			"hand-rolled <style> outside a Mermaid SVG",
		),
		good(
			(b) => validateLinks(b, "research", "x"),
			'<a href="?tab=pipelines#p-model">Pipelines</a>',
			"same-page ?query navigation is not a subresource",
		),
		bad(
			(b) => validateBody(b, { layout: "tabbed" }),
			"<div></div>",
			"tabbed with no tabs",
		),
		bad(
			(c) => validateCss(c, "x"),
			"p { color: #fff; }",
			"unprefixed selector",
		),
		bad(
			(c) => validateCss(c, "x"),
			`[data-page="x"] p { color: #fff; }`,
			"raw colour",
		),
		bad(
			(j) => validateJs(j),
			"export default () => { history.pushState({}, '', '/x'); };",
			"history call",
		),
	];
	return checks.filter(Boolean);
}

// ---- main ----------------------------------------------------------------------------------
async function main() {
	const failures = selfTest();
	if (failures.length) {
		console.error(failures.join("\n"));
		process.exit(2);
	}
	const arg = process.argv[2];
	const root = arg ? path.resolve(arg) : path.join(ROOT, "src/standalone");
	if (!existsSync(root)) {
		console.error(`check:export: ${root} not found`);
		process.exit(2);
	}
	const frags = findFragments(root);
	if (!frags.length) {
		console.log(
			`check:export: no fragments under ${path.relative(ROOT, root)} (nothing to validate)`,
		);
		return;
	}
	const results = [];
	for (const frag of frags) {
		const rel = path.relative(ROOT, frag);
		const kind = path.basename(path.dirname(frag));
		const slug = path.basename(frag);
		const problems = [];
		let meta;
		try {
			meta = JSON.parse(readFileSync(path.join(frag, "meta.json"), "utf8"));
		} catch (e) {
			problems.push(`meta.json: cannot parse (${e.message})`);
			meta = {};
		}
		problems.push(...validateMeta(meta, kind, slug));
		const body = readFileSync(path.join(frag, "body.html"), "utf8");
		problems.push(...validateBody(body, meta));
		const css = existsSync(path.join(frag, "page.css"))
			? readFileSync(path.join(frag, "page.css"), "utf8")
			: "";
		problems.push(...validateCss(css, slug));
		const js = existsSync(path.join(frag, "page.js"))
			? readFileSync(path.join(frag, "page.js"), "utf8")
			: "";
		problems.push(...validateJs(js));
		validateIcons(body, problems);
		problems.push(...validateLinks(body, kind, slug));
		problems.push(...publicCollision(kind, slug));
		problems.push(...(await validateLeaks(frag)));
		results.push({ rel, problems });
	}
	const notes = results.flatMap((r) =>
		r.problems
			.filter((p) => p.startsWith("note:"))
			.map((p) => `${r.rel}: ${p}`),
	);
	const hard = results.flatMap((r) =>
		r.problems
			.filter((p) => !p.startsWith("note:"))
			.map((p) => `${r.rel}: ${p}`),
	);
	for (const n of notes) console.log(`note: ${n}`);
	if (hard.length) {
		console.error(
			`\ncheck:export FAILED (${hard.length}):\n - ${hard.join("\n - ")}`,
		);
		process.exit(1);
	}
	console.log(`check:export passed: ${frags.length} fragment(s) conformant.`);
}

main();
