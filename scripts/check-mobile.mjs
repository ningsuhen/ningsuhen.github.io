// check-mobile — mobile sweep: render every page at 375px (light) and report, per page,
//   - horizontal overflow (document wider than the viewport, + the widest offenders);
//   - tap targets under 24px (visible interactive elements);
//   - text under 11px (visible leaf text);
//   - clipped content (elements whose content overflows a hidden/scroll box).
//
// Report-only: it lists findings per page and tags each page as site-owned or an EcoSimulation/Brev
// export (so fix PRs go only to the site-owned ones). It is a sweep, not a gate.
//
// Run: pnpm check:mobile            (needs a build; CHROME_PATH or a local chromium)
//      pnpm check:mobile --json <out>   also write the raw report to <out>
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { standalonePages } from "./lib/standalone-pages.mjs";

const DIST = path.resolve(process.env.MOBILE_DIST ?? "dist");
const WIDTH = 375; // the phone width the sweep targets
const HEIGHT = 800;
const TAP_MIN = 24; // px, the minimum tap-target edge
const TEXT_MIN = 11; // px, the minimum readable font size

const SITE_PAGES = [
	"/",
	"/archive/",
	"/research/",
	"/playground/",
	"/ideas/",
	"/about/",
	"/license/",
	"/posts/ai-boom-trajectories/",
];
const PAGES = [
	...standalonePages().map(
		(rel) =>
			`/${rel
				.replace(/index\.html$/, "")
				.split(path.sep)
				.join("/")}`,
	),
	"/design-system/",
	...SITE_PAGES,
]
	.filter((p, i, a) => a.indexOf(p) === i)
	.sort();

// Owner of a page: EcoSimulation / Brev exports are reported, not fixed, by this sweep.
function owner(urlPath) {
	if (/\/(research|playground)\/(ai-economy|ecosimulation|brev-[\w-]+)\/?/.test(urlPath))
		return urlPath.includes("brev") ? "Brev" : "EcoSimulation";
	return "site";
}

const TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css",
	".js": "text/javascript",
	".json": "application/json",
	".webp": "image/webp",
	".png": "image/png",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
};
function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	try {
		const p = chromium.executablePath();
		if (existsSync(p)) return p;
	} catch {}
	const cache = path.join(homedir(), "Library/Caches/ms-playwright");
	if (existsSync(cache))
		for (const d of readdirSync(cache)
			.filter((n) => n.startsWith("chromium_headless_shell"))
			.sort()
			.reverse())
			for (const sub of readdirSync(path.join(cache, d))) {
				const exe = path.join(cache, d, sub, "chrome-headless-shell");
				if (existsSync(exe)) return exe;
			}
	return undefined;
}

const server = createServer((req, res) => {
	let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
	if (p.endsWith("/")) p += "index.html";
	const file = path.join(DIST, path.normalize(p));
	if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
		res.statusCode = 404;
		return res.end("not found");
	}
	res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// The four checks, run in the page. { tapMin, textMin } are passed in (they are Node-scope constants,
// not available in the browser). Returns a compact finding list (capped so the report stays readable).
const CHECK = ({ tapMin, textMin }) => {
	const vw = window.innerWidth;
	const visible = (el) => {
		const cs = getComputedStyle(el);
		return cs.display !== "none" && cs.visibility !== "hidden" && el.getBoundingClientRect().width > 0;
	};
	const label = (el) =>
		`${el.tagName.toLowerCase()}` +
		(el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "");

	// 1. Horizontal overflow.
	const overflowPx = Math.max(0, document.documentElement.scrollWidth - vw);
	const wide = [];
	document.querySelectorAll("body *").forEach((el) => {
		if (!visible(el)) return;
		const r = el.getBoundingClientRect();
		if (r.right > vw + 1) wide.push({ el: label(el), right: Math.round(r.right), w: Math.round(r.width) });
	});
	wide.sort((a, b) => b.right - a.right);

	// 2. Tap targets under TAP_MIN.
	const smallTap = [];
	document
		.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="tab"], [tabindex]')
		.forEach((el) => {
			if (!visible(el)) return;
			const r = el.getBoundingClientRect();
			if (r.height < tapMin || r.width < tapMin)
				smallTap.push({
					el: label(el),
					text: (el.textContent || "").trim().slice(0, 24),
					w: Math.round(r.width),
					h: Math.round(r.height),
				});
		});

	// 3. Text under TEXT_MIN (leaf text nodes only).
	const smallText = [];
	document.querySelectorAll("body *").forEach((el) => {
		if (!visible(el)) return;
		const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
		if (!hasText) return;
		const fs = parseFloat(getComputedStyle(el).fontSize);
		if (fs < textMin) smallText.push({ el: label(el), fs: +fs.toFixed(1), text: el.textContent.trim().slice(0, 24) });
	});

	// 4. Clipped content: a NON-scrollable box (overflow:hidden) whose content is wider/taller than the
	// box — content the user cannot reach. Skipped: scrollable boxes (overflow:auto/scroll — code blocks,
	// tables, the tab bar are meant to scroll), screen-reader 1px duplicates (katex-mathml, tt-sr, sr-only),
	// and deliberate collapsibles (collapse-wrapper is collapsed by design).
	const clipped = [];
	document.querySelectorAll("body *").forEach((el) => {
		if (!visible(el)) return;
		if (el.clientWidth <= 1 && el.clientHeight <= 1) return; // screen-reader 1px box
		if (el.className && /collapse/i.test(el.className)) return; // deliberate collapsible
		const cs = getComputedStyle(el);
		const ox = cs.overflowX,
			oy = cs.overflowY;
		if (ox === "hidden" && el.scrollWidth > el.clientWidth + 1)
			clipped.push({ el: label(el), sw: el.scrollWidth, cw: el.clientWidth });
		if (oy === "hidden" && el.scrollHeight > el.clientHeight + 1)
			clipped.push({ el: label(el) + " (v)", sh: el.scrollHeight, ch: el.clientHeight });
	});

	const cap = (a, n = 12) => a.slice(0, n);
	return {
		title: document.title,
		bodyChars: document.body?.innerText?.length ?? 0,
		overflowPx,
		wide: cap(wide),
		smallTap: cap(smallTap),
		smallText: cap(smallText),
		clipped: cap(clipped),
	};
};

const browser = await chromium.launch({ executablePath: findChrome() });
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
const page = await ctx.newPage();
await page.route(/^https?:\/\//, (r) =>
	r.request().url().startsWith(base) ? r.continue() : r.abort(),
);
await ctx.addInitScript(() => {
	try {
		localStorage.setItem("theme", "light");
	} catch {}
});

const report = [];
for (const urlPath of PAGES) {
	try {
		await page.goto(base + urlPath, { waitUntil: "load" });
		await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
		await page.waitForTimeout(500); // settle: fonts, layout, the theme script
		const r = await page.evaluate(CHECK, { tapMin: TAP_MIN, textMin: TEXT_MIN });
		report.push({ page: urlPath, owner: owner(urlPath), ...r });
	} catch (e) {
		report.push({ page: urlPath, owner: owner(urlPath), error: e.message });
	}
}
await browser.close();
server.close();

// ---- report ------------------------------------------------------------------------------------
const bad = (r) =>
	r.overflowPx > 0 || r.smallTap?.length || r.smallText?.length || r.clipped?.length;
const rows = report.map((r) => {
	const issues = [];
	if (r.overflowPx > 0) issues.push(`overflow +${r.overflowPx}px`);
	if (r.smallTap?.length) issues.push(`${r.smallTap.length} tap<${TAP_MIN}`);
	if (r.smallText?.length) issues.push(`${r.smallText.length} text<${TEXT_MIN}`);
	if (r.clipped?.length) issues.push(`${r.clipped.length} clipped`);
	return { page: r.page, owner: r.owner, issues: issues.join(", ") || "ok", detail: r };
});

console.log(`\nmobile sweep @ ${WIDTH}px (light) — ${report.length} page(s)\n`);
console.log("| page | owner | loaded | findings |");
console.log("|---|---|---|---|");
for (const r of rows)
	console.log(
		`| ${r.page} | ${r.owner} | ${(r.detail.bodyChars ?? 0).toLocaleString()} ch | ${r.issues} |`,
	);

const site = rows.filter((r) => r.owner === "site" && r.issues !== "ok");
const export_ = rows.filter((r) => r.owner !== "site" && r.issues !== "ok");
console.log(`\n${site.length} site-owned page(s) with findings (fix candidates); ${export_.length} EcoSimulation/Brev export(s) (report only).`);
for (const r of site)
	console.log(`  site: ${r.page}\n${JSON.stringify(r.detail, null, 2).split("\n").map((l) => "    " + l).join("\n")}`);
for (const r of export_) console.log(`  ${r.owner}: ${r.page} — ${r.issues}`);

const jsonArg = process.argv[3];
if (process.argv[2] === "--json" && jsonArg)
	writeFileSync(jsonArg, JSON.stringify(report, null, 2));
