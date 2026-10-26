// split-fragment — migrate a self-contained standalone page into a fragment (contract v1).
//
// Reads an existing public/<kind>/<slug>/index.html and writes src/standalone/<kind>/<slug>/
// (meta.json, body.html, page.css). It does the mechanical conversion the shell makes redundant:
//   - strip the chrome the shell owns (hero, tab bar, "On this page" rails, the Lucide sprite);
//   - turn each <div class="rd-tabpanel" id="…"> into <section data-rd-tab data-rd-label
//     [data-rd-icon] id="…"> (the shell derives the tab bar from these; the inner rail is dropped);
//   - move the hero's chips to the top of the first tab's body;
//   - prefix every page-CSS selector with [data-page="<slug>"];
//   - tag the JSON data script with data-rd-data (the one script a fragment may ship).
//
// It then reports what it could NOT convert, because the contract forbids those in a fragment and
// they need a human: inline style="…" attributes (→ presentation attributes), executable <script>
// (→ a hand-written page.js init({ root, data, rd })), and emoji/glyph icons (→ Lucide). Finally it
// runs check:export on the generated fragment and surfaces its findings, so the report is grounded
// in the real gate. A clean page passes check:export (exit 0); a dirty page writes the fragment and
// lists exactly what still fails (exit 1).
//
// Usage:
//   node scripts/split-fragment.mjs <public-page>            write the fragment
//   node scripts/split-fragment.mjs <public-page> --dry-run  print the report, write nothing
//   node scripts/split-fragment.mjs <public-page> --force    overwrite an existing fragment
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse, parseFragment, serialize, serializeOuter } from "parse5";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// The public folder name maps to the fragment kind the route/loader uses.
const KIND_MAP = {
	ideas: "idea",
	research: "research",
	playground: "playground",
	experiments: "playground",
};

// ---- small DOM helpers (parse5 nodes are plain objects: no removeChild/insertBefore) -----------
const classOf = (n) => n.attrs?.find((a) => a.name === "class")?.value ?? "";
const attr = (n, k) => n.attrs?.find((a) => a.name === k)?.value ?? "";
const textOf = (n) =>
	(n.childNodes ?? []).map((c) => (c.nodeName === "#text" ? c.value : textOf(c))).join("");
const hasClass = (n, re) => re.test(classOf(n));
const removeNode = (n) => {
	const p = n.parentNode;
	if (!p) return;
	p.childNodes = (p.childNodes ?? []).filter((c) => c !== n);
};
const insertBefore = (n, ref) => {
	const p = n.parentNode ?? ref.parentNode;
	const i = (p?.childNodes ?? []).indexOf(ref);
	p.childNodes.splice(i === -1 ? p.childNodes.length : i, 0, n);
};

// ---- meta.json --------------------------------------------------------------------------------
// The title carries "· created YYYY-MM-DD · updated YYYY-MM-DD"; the shell renders that stamp, so the
// fragment title is clean and the dates live in meta.
function extractMeta(doc, kind, slug) {
	const html = doc.childNodes.find((n) => n.nodeName === "html");
	const head = html?.childNodes.find((n) => n.nodeName === "head");
	const titleNode = head?.childNodes.find((n) => n.nodeName === "title");
	let title = textOf(titleNode).trim();
	let created = "";
	let updated = "";
	const m = title.match(
		/·\s*created\s+(\d{4}-\d{2}-\d{2})\s*·\s*updated\s+(\d{4}-\d{2}-\d{2})/,
	);
	if (m) {
		created = m[1];
		updated = m[2];
		title = title.replace(/·\s*created[\s\S]*$/, "").trim();
	}
	const description =
		head?.childNodes
			.filter((n) => n.nodeName === "meta" && attr(n, "name") === "description")
			.map((n) => attr(n, "content"))
			.find(Boolean) ?? "";

	// The hero (eyebrow + lede) and the main's width class drive the remaining meta. (The hero is inside <main>.)
	const body = html?.childNodes.find((n) => n.nodeName === "body");
	let hero = null;
	{
		const find = (n) => {
			for (const c of n.childNodes ?? []) {
				if (c.nodeName === "header" && hasClass(c, /rd-hero/)) {
					hero = c;
					return;
				}
				find(c);
			}
		};
		if (body) find(body);
	}
	const eyebrowNode = (hero?.childNodes ?? []).find((n) => hasClass(n, /rd-eyebrow/));
	const eyebrow = eyebrowNode && textOf(eyebrowNode).trim();
	const main = (body?.childNodes ?? []).find((n) => n.nodeName === "main");
	const width = main && hasClass(main, /rd-container--wide/) ? "wide" : "post";
	const tabbed = (body?.childNodes ?? []).some(
		(n) => n.nodeName === "main" && (n.childNodes ?? []).some((c) => hasClass(c, /rd-tabpanel/)),
	);

	return {
		contract: 1,
		kind,
		slug,
		title,
		created,
		updated,
		summary: description,
		...(eyebrow ? { eyebrow } : {}),
		width,
		layout: tabbed ? "tabbed" : "scroll",
	};
}

// ---- CSS prefixing ----------------------------------------------------------------------------
// Prefix every selector with [data-page="<slug>"]. Recurses into @media/@supports/@container; leaves
// @keyframes/@font-face and the like untouched (their inner "selectors" are from/to/%, not elements).
const NESTED_AT = new Set(["media", "supports", "container", "scope"]);
function prefixCss(cssText, prefix) {
	const src = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
	let out = "";
	let i = 0;
	while (i < src.length) {
		while (i < src.length && /\s/.test(src[i])) i++;
		if (i >= src.length) break;
		const start = i;
		while (i < src.length && src[i] !== "{") i++;
		if (i >= src.length) {
			out += src.slice(start);
			break;
		}
		const prelude = src.slice(start, i).trim();
		i++; // consume "{"
		let depth = 1;
		let j = i;
		while (j < src.length && depth > 0) {
			if (src[j] === "{") depth++;
			else if (src[j] === "}") depth--;
			if (depth === 0) break;
			j++;
		}
		const body = src.slice(i, j);
		i = j + 1; // consume "}"
		if (prelude.startsWith("@")) {
			const name = prelude.match(/^@([a-z-]+)/)?.[1] ?? "";
			out += NESTED_AT.has(name)
				? `${prelude} { ${prefixCss(body, prefix)} }`
				: `${prelude} { ${body} }`;
		} else {
			const sels = prelude
				.split(",")
				.map((s) => (s.trim() ? `${prefix} ${s.trim()}` : s))
				.join(", ");
			out += `${sels} { ${body} }`;
		}
	}
	return out;
}

// ---- body conversion --------------------------------------------------------------------------
// Returns { body, tabs, chips, executableScripts, dataScripts } after stripping chrome and converting
// the tab panels. The document is mutated in place.
function convertBody(doc) {
	const html = doc.childNodes.find((n) => n.nodeName === "html");
	const body = html?.childNodes.find((n) => n.nodeName === "body");
	if (!body) return null;

	// 1. Tab map from the expnav (id → { label, icon }), then drop the expnav.
	const tabs = {};
	const expnav = (body.childNodes ?? []).find(
		(n) => n.nodeName === "nav" && hasClass(n, /rd-expnav/),
	);
	if (expnav) {
		for (const a of expnav.childNodes ?? []) {
			if (a.nodeName !== "a") continue;
			const id = attr(a, "id").replace(/^tab-/, "");
			if (!id) continue;
			tabs[id] = {
				label: textOf(a).trim(),
				icon: (serializeOuter(a).match(/#i-([a-z0-9-]+)/) ?? [])[1] ?? null,
			};
		}
		removeNode(expnav);
	}

	// 2. Hero: keep eyebrow/lede in meta, lift the chips, drop the header. (The hero is inside <main>.)
	let chips = [];
	let hero = null;
	{
		const find = (n) => {
			for (const c of n.childNodes ?? []) {
				if (c.nodeName === "header" && hasClass(c, /rd-hero/)) {
					hero = c;
					return;
				}
				find(c);
			}
		};
		find(body);
	}
	if (hero) {
		const walk = (n) => {
			for (const c of n.childNodes ?? []) {
				if (c.nodeName === "span" && hasClass(c, /rd-chip/)) chips.push(serializeOuter(c));
				walk(c);
			}
		};
		walk(hero);
		removeNode(hero);
	}

	// 3. Drop the Lucide sprite (a display:none <svg> full of <symbol>) and its comment markers.
	for (const n of [...(body.childNodes ?? [])]) {
		if (
			n.nodeName === "svg" &&
			/display:\s*none/.test(attr(n, "style")) &&
			(n.childNodes ?? []).some((c) => c.nodeName === "symbol")
		)
			removeNode(n);
		if (n.nodeName === "#comment" && /lucide-sprite/.test(n.data ?? "")) removeNode(n);
	}

	// 4. Convert each tab panel <div class="rd-tabpanel" id="…"> into a <section data-rd-tab …>.
	const sections = [];
	const main = (body.childNodes ?? []).find((n) => n.nodeName === "main");
	for (const n of [...(main?.childNodes ?? [])]) {
		if (n.nodeName === "div" && hasClass(n, /rd-tabpanel/)) {
			const id = attr(n, "id");
			const tab = tabs[id] ?? { label: id, icon: null };
			n.nodeName = "section";
			n.tagName = "section";
			n.attrs = [
				{ name: "data-rd-tab", value: id },
				{ name: "data-rd-label", value: tab.label },
				...(tab.icon ? [{ name: "data-rd-icon", value: tab.icon }] : []),
				{ name: "id", value: id },
			];
			sections.push(n);
		}
	}

	// 5. Drop every "On this page" rail (the loader regenerates them from h2/h3[id]).
	const drop = (n) => {
		for (const c of [...(n.childNodes ?? [])]) {
			if (c.nodeName === "nav" && hasClass(c, /rd-toc/)) removeNode(c);
			drop(c);
		}
	};
	drop(body);

	// 6. Move the hero chips to the top of the first tab's body.
	if (chips.length && sections.length) {
		const frag = parseFragment(`<div class="rd-hero__meta">${chips.join("")}</div>`);
		const wrap = frag.childNodes[0];
		insertBefore(wrap, sections[0].childNodes[0]);
	}

	// 7. Scripts: tag the JSON data script with data-rd-data; collect the executable ones.
	const dataScripts = [];
	const executableScripts = [];
	const walkScripts = (n) => {
		for (const c of n.childNodes ?? []) {
			if (c.nodeName === "script") {
				const type = attr(c, "type");
				const src = attr(c, "src");
				if (src) continue; // external (the shell loads rd.js)
				if (/json/.test(type)) {
					if (!c.attrs?.some((a) => a.name === "data-rd-data"))
						c.attrs = [...(c.attrs ?? []), { name: "data-rd-data", value: "" }];
					dataScripts.push(attr(c, "id") || "data");
				} else {
					executableScripts.push(firstComment(textOf(c)));
				}
			}
			walkScripts(c);
		}
	};
	walkScripts(body);

	return {
		body: serialize(body),
		tabs: Object.keys(tabs).length,
		chips: chips.length,
		executableScripts,
		dataScripts,
	};
}

// The first line-comment in a script, as a one-line description of what it does.
function firstComment(js) {
	const m = js.match(/\/\/\s*([^\n]+)/);
	return m ? m[1].trim() : "(no leading comment)";
}

// ---- "couldn't convert" report ----------------------------------------------------------------
// The three things the contract forbids in a fragment that a migration must surface by hand.
const EMOJI_RE =
	/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
function findings(bodyHtml) {
	// Mask the data-rd-data JSON (its strings can contain any character) so the scans are not fooled.
	const masked = bodyHtml.replace(
		/<script\b[^>]*data-rd-data[^>]*>[\s\S]*?<\/script>/gi,
		(s) => " ".repeat(s.length),
	);
	const inlineStyles = [...masked.matchAll(/style="([^"]*)"/gi)]
		.map((m) =>
			m[1]
				.split(";")
				.map((s) => s.trim())
				.filter((s) => s && !s.startsWith("--")),
		)
		.flat();
	const emoji = [...new Set([...masked.matchAll(EMOJI_RE)].map((m) => m[0]))];
	return { inlineStyles, emoji };
}

// ---- check:export (the real gate) -------------------------------------------------------------
function runCheckExport(fragDir) {
	const r = spawnSync(process.execPath, [path.join(HERE, "check-export.mjs"), fragDir], {
		encoding: "utf8",
	});
	return {
		passed: r.status === 0,
		output: (r.stdout ?? "") + (r.stderr ?? ""),
	};
}

// ---- orchestration ----------------------------------------------------------------------------
export function split(pagePath, { dryRun = false, force = false, root = ROOT } = {}) {
	const abs = path.resolve(pagePath);
	if (!existsSync(abs)) throw new Error(`no such page: ${pagePath}`);
	// public/<kindFolder>/<slug>/index.html
	const slug = path.basename(path.dirname(abs));
	const kindFolder = path.basename(path.dirname(path.dirname(abs)));
	const kind = KIND_MAP[kindFolder];
	if (!kind) throw new Error(`unrecognised kind folder "${kindFolder}" (expected ideas/research/playground)`);

	const fragDir = path.join(root, "src/standalone", kind, slug);
	if (existsSync(path.join(fragDir, "meta.json")) && !force)
		throw new Error(`fragment already exists at ${path.relative(root, fragDir)} (use --force to overwrite)`);

	const doc = parse(readFileSync(abs, "utf8"));
	const meta = extractMeta(doc, kind, slug);
	const conv = convertBody(doc);
	if (!conv) throw new Error("no <body> found in the page");
	const styleNode = doc.childNodes
		.find((n) => n.nodeName === "html")
		?.childNodes.find((n) => n.nodeName === "head")
		?.childNodes.find((n) => n.nodeName === "style");
	const css = prefixCss(styleNode ? textOf(styleNode) : "", `[data-page="${slug}"]`);
	const { inlineStyles, emoji } = findings(conv.body);

	const report = {
		page: path.relative(ROOT, abs),
		fragDir: path.relative(ROOT, fragDir),
		kind,
		slug,
		meta,
		tabs: conv.tabs,
		chips: conv.chips,
		dataScripts: conv.dataScripts,
		cssBytes: Buffer.byteLength(css, "utf8"),
		inlineStyles,
		executableScripts: conv.executableScripts,
		emoji,
	};

	if (!dryRun) {
		mkdirSync(fragDir, { recursive: true });
		writeFileSync(path.join(fragDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
		writeFileSync(path.join(fragDir, "body.html"), conv.body + "\n");
		if (css.trim()) writeFileSync(path.join(fragDir, "page.css"), css + "\n");
	}

	return { report, css, body: conv.body, fragDir };
}

// ---- CLI --------------------------------------------------------------------------------------
function main() {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const force = args.includes("--force");
	const pagePath = args.find((a) => !a.startsWith("--"));
	if (!pagePath) {
		console.error("usage: node scripts/split-fragment.mjs <public-page> [--dry-run] [--force]");
		process.exit(2);
	}
	let res;
	try {
		res = split(pagePath, { dryRun, force });
	} catch (e) {
		console.error(`split-fragment: ${e.message}`);
		process.exit(2);
	}
	const { report, fragDir } = res;
	console.log(`\nsplit-fragment: ${report.page} → ${report.fragDir}/`);
	console.log(
		`  meta.json  kind=${report.kind} layout=${report.meta.layout} width=${report.meta.width} ${report.tabs} tab(s)`,
	);
	console.log(`  body.html  chrome stripped (hero, tab bar, rails, sprite); ${report.chips} hero chip(s) moved`);
	console.log(`  page.css   ${report.cssBytes} bytes, prefixed [data-page="${report.slug}"]`);
	if (report.dataScripts.length)
		console.log(`  data       ${report.dataScripts.join(", ")} → data-rd-data`);

	console.log("\n  couldn't convert (needs hand work):");
	if (report.inlineStyles.length)
		console.log(`    - ${report.inlineStyles.length} inline style="…" → presentation attributes`);
	if (report.executableScripts.length) {
		console.log(
			`    - ${report.executableScripts.length} executable <script> → page.js init({root,data,rd}):`,
		);
		report.executableScripts.forEach((c) => console.log(`        · ${c}`));
	}
	if (report.emoji.length)
		console.log(`    - ${report.emoji.length} emoji/glyph icon(s): ${report.emoji.join(" ")}`);
	if (!report.inlineStyles.length && !report.executableScripts.length && !report.emoji.length)
		console.log("    (none — clean page)");

	if (dryRun) {
		console.log("\n  --dry-run: nothing written.");
		process.exit(0);
	}

	const gate = runCheckExport(fragDir);
	console.log(`\n  check:export ${gate.passed ? "passed" : "FAILED"}:`);
	for (const line of gate.output.trim().split("\n")) console.log(`    ${line}`);
	process.exit(gate.passed ? 0 : 1);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
