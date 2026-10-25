// Loads every standalone public/**/*.html page from the built site in a real browser and fails on layout
// regressions in the injected navbar. Run after `pnpm build`:  pnpm check:standalone
// Browser: set CHROME_PATH, or `pnpm exec playwright-core install chromium` (CI does this).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { standalonePages } from "./lib/standalone-pages.mjs";

const DIST = path.resolve("dist");
const PUBLIC = path.resolve("public");
const VIEWPORTS = [
	{ width: 1440, height: 900 },
	{ width: 375, height: 800 },
];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	try {
		const p = chromium.executablePath();
		if (existsSync(p)) return p;
	} catch {}
	const cache = path.join(homedir(), "Library/Caches/ms-playwright");
	if (existsSync(cache)) {
		for (const d of readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell")).sort().reverse()) {
			for (const sub of readdirSync(path.join(cache, d))) {
				const exe = path.join(cache, d, sub, "chrome-headless-shell");
				if (existsSync(exe)) return exe;
			}
		}
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

// Headless Chrome hides scrollbars by default, which would hide a 15px page scrollbar from this check.
const browser = await chromium.launch({ executablePath: findChrome(), ignoreDefaultArgs: ["--hide-scrollbars"] });
const failures = [];
const pages = standalonePages();
for (const rel of pages) {
	const src = readFileSync(path.join(PUBLIC, rel), "utf8");
	const optedOut = /<meta[^>]+name=["']site-navbar["'][^>]+content=["']off["']/i.test(src);
	const urlPath = `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
	for (const vp of VIEWPORTS) {
		const ctx = await browser.newContext({ viewport: vp });
		const page = await ctx.newPage();
		// Standalone pages must be self-contained: no cross-origin subresource requests (script/css/font/
		// image/fetch). Outbound <a href> navigations are user-initiated and are not subresources.
		// blob: URLs are in-page workers/eval (not network), and the in-flight ai-economy report still loads
		// d3 from a CDN until its re-export lands — both are exempt, mirroring SCRIPT_ROUTED_HASHES elsewhere.
		const EXEMPT_EXTERNAL = new Set(["/research/ai-economy/"]);
		const externalReqs = [];
		page.on("request", (rq) => {
			const u = rq.url();
			if (u.startsWith(base) || u.startsWith("blob:") || rq.resourceType() === "document") return;
			if (EXEMPT_EXTERNAL.has(urlPath)) return;
			externalReqs.push(`${rq.resourceType()} ${u}`);
		});
		await page.goto(base + urlPath, { waitUntil: "load" });
		const m = await page.evaluate(() => {
			const lic = document.querySelector("div[data-site-license]");
			const lr = lic?.getBoundingClientRect();
			const host = document.querySelector("div[data-site-navbar]");
			const r = host?.getBoundingClientRect();
			const doc = document.documentElement;
			return {
				has: !!host,
				lic: !!lic,
				licLeft: lr ? Math.round(lr.left + scrollX) : null,
				licWidth: lr ? Math.round(lr.width) : null,
				licText: lic?.shadowRoot?.textContent ?? "",
				top: r ? Math.round(r.top + scrollY) : null,
				left: r ? Math.round(r.left + scrollX) : null,
				width: r ? Math.round(r.width) : null,
				cw: doc.clientWidth,
				sw: doc.scrollWidth,
				theme: doc.getAttribute("data-theme"),
				mojibake: /Â|â€/.test(document.body.innerText),
				compat: document.compatMode,
				lang: document.documentElement.lang,
			};
		});
		const tag = `${urlPath} @${vp.width}`;
		if (optedOut) {
			if (m.has) failures.push(`${tag}: navbar present although the page opted out`);
		} else if (!m.has) failures.push(`${tag}: navbar missing`);
		else {
			if (m.top !== 0 || m.left !== 0) failures.push(`${tag}: navbar not flush top-left (top=${m.top}, left=${m.left})`);
			if (Math.abs(m.width - m.cw) > 1) failures.push(`${tag}: navbar width ${m.width} != viewport ${m.cw}`);
			if (m.theme !== "light" && m.theme !== "dark") failures.push(`${tag}: <html data-theme> not set (${m.theme})`);
		}
		if (!m.lic) failures.push(`${tag}: license notice missing`);
		else {
			if (m.licLeft !== 0 || Math.abs(m.licWidth - m.cw) > 1) failures.push(`${tag}: license footer not flush full-width (left=${m.licLeft}, width=${m.licWidth})`);
			if (!/without my written permission/.test(m.licText)) failures.push(`${tag}: license text missing the no-reuse clause`);
		}
		if (m.sw > m.cw + 1) failures.push(`${tag}: horizontal overflow (scrollWidth ${m.sw} > ${m.cw})`);
		if (m.mojibake) failures.push(`${tag}: mojibake in page text (missing/wrong charset)`);
		if (m.compat !== "CSS1Compat") failures.push(`${tag}: rendered in quirks mode (missing doctype)`);
		if (!m.lang) failures.push(`${tag}: <html lang> missing`);
		if (externalReqs.length) failures.push(`${tag}: external subresource request(s): ${[...new Set(externalReqs)].slice(0, 4).join(", ")}`);
		await ctx.close();
	}
}

// Navigation regression: from a site page, a link to a standalone page must be a normal full navigation,
// and Back must restore the site page intact (Swup used to intercept the link and corrupt the page).
const standaloneUrls = new Set(pages.map((rel) => `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`));
for (const sitePath of ["/experiments/", "/research/", "/ideas/"]) {
	const ctx = await browser.newContext({ viewport: VIEWPORTS[0] });
	const page = await ctx.newPage();
	const resp = await page.goto(base + sitePath, { waitUntil: "load" });
	if (resp && resp.ok()) {
		const title = await page.title();
		const hrefs = await page.$$eval("a[href]", (as) => [...new Set(as.map((a) => new URL(a.href).pathname))]);
		for (const h of hrefs.filter((x) => standaloneUrls.has(x))) {
			await page.goto(base + sitePath, { waitUntil: "load" });
			await page.evaluate(() => { window.__nav_marker = 1; });
			await Promise.all([page.waitForURL(`**${h}`), page.click(`a[href="${h}"]`)]);
			await page.waitForLoadState("load");
			const full = await page.evaluate(() => window.__nav_marker === undefined);
			await page.goBack({ waitUntil: "load" });
			const back = await page.evaluate(() => ({ title: document.title, container: !!document.querySelector("#swup-container"), nav: !!document.querySelector("#navbar") }));
			if (!full) failures.push(`${sitePath} -> ${h}: link was soft-navigated (Swup intercepted a standalone page)`);
			if (back.title !== title || !back.container || !back.nav) failures.push(`${sitePath} -> ${h} -> Back: page broken (title "${back.title}", container=${back.container}, navbar=${back.nav})`);
		}
	}
	await ctx.close();
}
// URL structure: a report lives at /research/<slug>/, a live experiment at /experiments/<slug>/. Every standalone page in
// those folders must be linked from its list page (a page nobody can reach is a bug), and no folder index may shadow the Astro page.
for (const [section, listPath] of [
	["research", "/research/"],
	["experiments", "/experiments/"],
	["ideas", "/ideas/"],
]) {
	if (pages.includes(path.join(section, "index.html"))) failures.push(`public/${section}/index.html exists: the Astro page owns /${section}/`);
	const expected = pages
		.filter((rel) => rel.startsWith(`${section}${path.sep}`) && rel.split(path.sep).length === 3)
		.map((rel) => `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`);
	const ctx = await browser.newContext({ viewport: VIEWPORTS[0] });
	const page = await ctx.newPage();
	const resp = await page.goto(base + listPath, { waitUntil: "load" });
	const hrefs = resp?.ok() ? await page.$$eval("a[href]", (as) => as.map((a) => new URL(a.href).pathname)) : [];
	for (const u of expected) if (!hrefs.includes(u)) failures.push(`${u}: standalone page is not linked from ${listPath}`);
	await ctx.close();
}

// Old URLs: every redirect in astro.config.mjs must land on its target in a real browser (meta refresh followed).
const configSrc = readFileSync("astro.config.mjs", "utf8");
const redirectBlock = configSrc.slice(configSrc.indexOf("redirects: {"), configSrc.indexOf("},", configSrc.indexOf("redirects: {")));
for (const [, from, to] of redirectBlock.matchAll(/"([^"]+)":\s*"([^"]+)"/g)) {
	const ctx = await browser.newContext({ viewport: VIEWPORTS[0] });
	const page = await ctx.newPage();
	await page.goto(base + from, { waitUntil: "load" }).catch(() => {});
	try {
		await page.waitForURL(base + to, { timeout: 5000 });
		await page.waitForLoadState("load");
		const body = await page.evaluate(() => document.body.innerText.trim().length);
		if (!body) failures.push(`${from} -> ${to}: redirect target is empty`);
	} catch {
		failures.push(`${from}: does not redirect to ${to} (ends at ${page.url().replace(base, "")})`);
	}
	await ctx.close();
}
// Site pages: the navbar used to overflow the page between 768 and 1023px (links shown at md, search only at lg).
for (const sitePath of ["/", "/archive/", "/research/", "/experiments/", "/ideas/"]) {
	for (const vp of [375, 768, 1024, 1280, 1440].map((width) => ({ width, height: 1000 }))) {
		const ctx = await browser.newContext({ viewport: vp });
		const page = await ctx.newPage();
		await page.goto(base + sitePath, { waitUntil: "load" });
		const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		if (sw > 1) failures.push(`${sitePath} @${vp.width}: page scrolls horizontally by ${sw}px`);
		await ctx.close();
	}
}
// Site pages: no duplicate ids (the footer used to render twice), no empty or "#" links (pagination, post prev/next).
for (const sitePath of ["/", "/archive/", "/posts/ai-boom-trajectories/"]) {
	const ctx = await browser.newContext({ viewport: VIEWPORTS[0] });
	const page = await ctx.newPage();
	await page.goto(base + sitePath, { waitUntil: "load" });
	const m = await page.evaluate(() => {
		const ids = {};
		document.querySelectorAll("[id]").forEach((e) => (ids[e.id] = (ids[e.id] || 0) + 1));
		return { dup: Object.keys(ids).filter((k) => ids[k] > 1), emptyLinks: document.querySelectorAll('a[href=""], a[href="#"]').length };
	});
	if (m.dup.length) failures.push(`${sitePath}: duplicate ids ${m.dup.join(", ")}`);
	if (m.emptyLinks) failures.push(`${sitePath}: ${m.emptyLinks} empty link(s) (href="" or "#")`);
	await ctx.close();
}
// Every main page must have exactly one <h1>: the shared layout supplies a screen-reader heading on
// pages whose visible title is a styled div, and the section/404 pages render their own visible <h1>.
for (const sitePath of ["/", "/about/", "/archive/", "/research/", "/experiments/", "/ideas/", "/license/", "/posts/ai-boom-trajectories/"]) {
	const ctx = await browser.newContext({ viewport: VIEWPORTS[0] });
	const page = await ctx.newPage();
	await page.goto(base + sitePath, { waitUntil: "load" });
	const h1 = await page.evaluate(() => document.querySelectorAll("h1").length);
	if (h1 !== 1) failures.push(`${sitePath}: expected exactly one <h1>, found ${h1}`);
	await ctx.close();
}
// Site pages: the footer small-print links (RSS / Sitemap / Astro / Fuwari) must keep a >= 24px tap
// target on phones. Each is inline-flex with a 24px min-height, so the element itself is the tap target.
{
	const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
	const page = await ctx.newPage();
	await page.goto(base + "/", { waitUntil: "load" });
	const small = await page.evaluate(() =>
		[...document.querySelectorAll("a")]
			.filter((a) => /^(RSS|Sitemap|Astro|Fuwari)$/.test(a.textContent.trim()))
			.map((a) => Math.round(a.getBoundingClientRect().height))
			.filter((h) => h > 0)
	);
	for (const h of small) if (h < 24) failures.push(`/ @375: footer small-print link tap target ${h}px (< 24px)`);
	await ctx.close();
}
// Wide container (tabbed reports, class rd-container--wide = the navbar's width): from 1200px up, the content's
// left and right edges must sit on the navbar card's edges, so the page reads as one column with the navbar.
const WIDE_VIEWPORTS = [1440, 1280, 1200, 1024, 768, 375];
for (const rel of pages.filter((p) => /<main\b[^>]*class=["'][^"']*\brd-container--wide\b/.test(readFileSync(path.join(PUBLIC, p), "utf8")))) {
	const urlPath = `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
	for (const width of WIDE_VIEWPORTS) {
		const ctx = await browser.newContext({ viewport: { width, height: 900 } });
		const page = await ctx.newPage();
		await page.goto(base + urlPath, { waitUntil: "load" });
		const m = await page.evaluate(() => {
			const bar = document.querySelector("div[data-site-navbar]")?.shadowRoot?.querySelector("header")?.getBoundingClientRect();
			const main = document.querySelector(".rd-container--wide")?.getBoundingClientRect();
			return { bar: bar ? [bar.left, bar.right] : null, main: main ? [main.left, main.right] : null };
		});
		const tag = `${urlPath} @${width}`;
		if (!m.bar || !m.main) failures.push(`${tag}: navbar header or .rd-container--wide not found`);
		else if (width >= 1200 && (Math.abs(m.main[0] - m.bar[0]) > 1 || Math.abs(m.main[1] - m.bar[1]) > 1)) {
			failures.push(`${tag}: wide content edges ${m.main.map(Math.round).join("..")} differ from the navbar card ${m.bar.map(Math.round).join("..")}`);
		}
		await ctx.close();
	}
}
// Tabbed reports (rd-tabbed): from 1200px up the tab bar and the content sit on the navbar card's edges. The "On this
// page" rail is outside that width in the right margin from 1536px up (the main post page's rule), and a disclosure below.
// Drift guard: the report rail must match the main post page's TOC (x, width, top, first entry, badge and text metrics),
// and both must highlight the headings whose section meets the viewport (the same rule, at the same scroll offsets).
const TAB_VIEWPORTS = [1920, 1600, 1536, 1440, 1280, 1024, 768, 375];
const railLog = [];
const tabbed = pages.filter((p) => /<main\b[^>]*class=["'][^"']*\brd-tabbed\b/.test(readFileSync(path.join(PUBLIC, p), "utf8")));
for (const rel of tabbed) {
	const urlPath = `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
	for (const width of TAB_VIEWPORTS) {
		const ctx = await browser.newContext({ viewport: { width, height: 900 } });
		const page = await ctx.newPage();
		await page.goto(base + urlPath, { waitUntil: "load" });
		const m = await page.evaluate(() => {
			const R = (el) => { const b = el?.getBoundingClientRect(); return b ? { l: b.left, r: b.right, t: b.top, w: b.width } : null; };
			const navb = R(document.querySelector("div[data-site-navbar]")?.shadowRoot?.querySelector("header"));
			const panel = [...document.querySelectorAll(".rd-tabpanel")].find((p) => !p.hidden);
			const rail = panel?.querySelector(".rd-toc");
			return {
				navb, tabs: R(document.querySelector('.rd-expnav[role="tablist"]')), main: R(document.querySelector("main.rd-tabbed")),
				rail: R(rail), railFixed: !!rail && getComputedStyle(rail).position === "fixed",
				tabCount: document.querySelectorAll('.rd-expnav[role="tablist"] [role="tab"]').length,
				panelCount: document.querySelectorAll(".rd-tabpanel").length,
			};
		});
		const tag = `${urlPath} @${width}`;
		if (!m.navb || !m.tabs || !m.main) failures.push(`${tag}: navbar, tab bar or main.rd-tabbed not found`);
		if (m.tabCount < 1 || m.tabCount !== m.panelCount) failures.push(`${tag}: ${m.tabCount} tabs for ${m.panelCount} panels (expected at least 1, one per panel)`);
		if (width >= 1200 && m.navb && m.tabs && m.main) {
			for (const [name, box] of [["tab bar", m.tabs], ["content", m.main]]) {
				if (Math.abs(box.l - m.navb.l) > 1 || Math.abs(box.r - m.navb.r) > 1) failures.push(`${tag}: ${name} ${Math.round(box.l)}..${Math.round(box.r)} differs from the navbar card ${Math.round(m.navb.l)}..${Math.round(m.navb.r)}`);
			}
		}
		if (m.railFixed !== (width >= 1536)) failures.push(`${tag}: rail ${m.railFixed ? "fixed in the margin" : "not in the margin"} but the rule is 1536px and up`);
		if (m.railFixed && m.rail && m.navb && (m.rail.l < m.navb.r + 15 || m.rail.r > width)) failures.push(`${tag}: rail ${Math.round(m.rail.l)}..${Math.round(m.rail.r)} overlaps the content or leaves the viewport`);
		railLog.push(`${width}:${m.railFixed ? "rail" : "disclosure"}`);
		await ctx.close();
	}
}
// Section bar (rd-expnav) block for scripts/check-standalone-pages.mjs. Inserted before the "Drift" comment.
// Section bar (rd-expnav) on every standalone page with one: directly under the breadcrumb band, which sits directly under
// the navbar card (--rd-crumb-h, 40px; 16px when the page has no trail), the first link on the navbar's brand edge from 1200px
// up (the container padding below). Once scrolled 800px the navbar stays on top (sticky, like the main site), the band
// sticks under it and the bar under the band. Jump targets land below all three: scroll-margin-top clears them.
const BAR_VIEWPORTS = [1440, 1280, 1200, 1024, 768, 375];
const barPages = pages.filter((p) => /<nav\b[^>]*class=["'][^"']*\brd-expnav\b/.test(readFileSync(path.join(PUBLIC, p), "utf8")));
const CRUMB_BAND_PX = 40; // --rd-crumb-h (2.5rem): the breadcrumb band under the navbar card
const MAIN_GAP_PX = 16; // the main site's rhythm (MainGridLayout gap-4; the TOC sits 16px from the navbar card). A fixed reference, not --rd-navbar-gap: the token must match it.
for (const rel of barPages) {
	const urlPath = `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
	for (const width of BAR_VIEWPORTS) {
		const ctx = await browser.newContext({ viewport: { width, height: 900 } });
		const page = await ctx.newPage();
		await page.goto(base + urlPath, { waitUntil: "load" });
		const m = await page.evaluate(() => {
			const R = (el) => { const b = el?.getBoundingClientRect(); return b ? { t: b.top, b: b.bottom, l: b.left } : null; };
			const host = document.querySelector("div[data-site-navbar]");
			const bar = document.querySelector(".rd-expnav");
			return {
				navb: R(host?.shadowRoot?.querySelector("header")), brandL: R(host?.shadowRoot?.querySelector(".brand"))?.l,
				bar: R(bar), firstL: R(bar?.querySelector("a"))?.l, padL: bar ? parseFloat(getComputedStyle(bar).paddingLeft) : null,
				band: R(document.querySelector(".rd-crumb-band")), bandEmpty: !!document.querySelector(".rd-crumb-band--empty"),
				bandBg: getComputedStyle(document.querySelector(".rd-crumb-band") ?? document.body, "::before").backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor,
			};
		});
		const tag = `${urlPath} @${width}`;
		if (!m.navb || !m.bar || m.firstL == null) failures.push(`${tag}: navbar card or section bar not found`);
		else {
			// The band (.rd-crumb-band) sits directly under the navbar card and holds the trail; the section bar sits directly under it.
			// A page without a band (its own shell) keeps the main site's 16px rhythm.
			const bandH = m.band ? m.band.b - m.band.t : null;
			const gap = m.band && !m.bandEmpty ? CRUMB_BAND_PX : MAIN_GAP_PX;
			if (m.band) {
				if (Math.abs(m.band.t - m.navb.b) > 0.5) failures.push(`${tag}: band top ${m.band.t.toFixed(1)}px, navbar card bottom ${m.navb.b.toFixed(1)}px`);
				if (Math.abs(bandH - gap) > 0.5) failures.push(`${tag}: band ${bandH.toFixed(1)}px tall, expected ${gap}px`);
				if (m.bandBg !== m.bodyBg) failures.push(`${tag}: band background ${m.bandBg} is not the page background ${m.bodyBg} (must be opaque)`);
				if (width >= 768 && Math.abs(m.bar.t - m.band.b) > 1) failures.push(`${tag}: section bar ${(m.bar.t - m.band.b).toFixed(1)}px below the band, expected 0`);
			} else if (width >= 768 && Math.abs(m.bar.t - m.navb.b - gap) > 1) failures.push(`${tag}: section bar ${(m.bar.t - m.navb.b).toFixed(1)}px below the navbar card, expected ${gap}px (the main site rhythm)`);
			const edge = width >= 1200 ? m.brandL : m.bar.l + m.padL;
			if (Math.abs(m.firstL - edge) > 1) failures.push(`${tag}: first tab at ${m.firstL.toFixed(1)}px, expected ${edge.toFixed(1)}px (${width >= 1200 ? "navbar brand edge" : "container padding"})`);
		}
		await page.evaluate(() => window.scrollTo({ top: 800, behavior: "instant" }));
		// Wait for the scroll to land (or the page's end when shorter), then two frames for the sticky layout to settle.
		await page.waitForFunction(() => window.scrollY >= Math.min(800, document.documentElement.scrollHeight - window.innerHeight) - 0.5);
		await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
		const s = await page.evaluate(() => {
			const bar = document.querySelector(".rd-expnav");
			const host = document.querySelector("div[data-site-navbar]");
			const hd = host.shadowRoot.querySelector("header").getBoundingClientRect();
			const band = document.querySelector(".rd-crumb-band");
			const bb = band?.getBoundingClientRect();
			// Nothing may show through the band: at every sample point inside it, the topmost element is the band (or its content),
			// and its background is opaque (alpha 1), so the page never shows through at this scroll position.
			const hits = bb ? [0.02, 0.5, 0.98].map((k) => {
				const x = bb.left + bb.width * k;
				const el = document.elementFromPoint(x, bb.top + bb.height / 2);
				return !!el?.closest(".rd-crumb-band");
			}) : [];
			const alpha = bb ? getComputedStyle(band, "::before").backgroundColor : "";
			return { top: bar.getBoundingClientRect().top, navBottom: hd.bottom, navTop: hd.top, scrollY: window.scrollY, bandTop: bb?.top ?? null, bandBottom: bb?.bottom ?? null, hits, bandBg: alpha, bodyBg: getComputedStyle(document.body).backgroundColor };
		});
		// The navbar is sticky (parity with the main site); the band sticks under it and the section bar under the band.
		if (s.scrollY < 799) failures.push(`${tag}: page too short to scroll 800px (reached ${s.scrollY})`);
		else if (Math.abs(s.navTop) > 0.5) failures.push(`${tag}: navbar not sticky at the top (top ${s.navTop.toFixed(1)}px, scrollY ${s.scrollY})`);
		else if (s.bandTop !== null && Math.abs(s.bandTop - s.navBottom) > 0.5) failures.push(`${tag}: stuck band at ${s.bandTop.toFixed(1)}px, expected directly under the navbar (bottom ${s.navBottom.toFixed(1)}px)`);
		else if (s.bandTop !== null && Math.abs(s.top - s.bandBottom) > 0.5) failures.push(`${tag}: stuck section bar at ${s.top.toFixed(1)}px, expected directly under the band (bottom ${s.bandBottom.toFixed(1)}px, scrollY ${s.scrollY})`);
		else if (s.bandTop === null && Math.abs(s.top - s.navBottom - MAIN_GAP_PX) > 0.5) failures.push(`${tag}: stuck section bar at ${s.top.toFixed(1)}px, expected ${MAIN_GAP_PX}px under the navbar (bottom ${s.navBottom.toFixed(1)}px, scrollY ${s.scrollY})`);
		if (s.bandTop !== null && s.hits.some((h) => !h)) failures.push(`${tag}: content shows through the band at scrollY ${s.scrollY} (another element is on top of the band)`);
		if (s.bandTop !== null && s.bandBg !== s.bodyBg) failures.push(`${tag}: band background not opaque at scrollY ${s.scrollY}`);
		// Jump targets (section links in the bar) land below both bars: scroll-margin-top clears the navbar and the bar.
		const jump = await page.evaluate(async () => {
			const bar = document.querySelector(".rd-expnav");
			const link = [...bar.querySelectorAll('a[href^="#"]')].find((a) => document.getElementById(a.getAttribute("href").slice(1))?.offsetParent);
			if (!link) return null;
			const target = document.getElementById(link.getAttribute("href").slice(1));
			target.scrollIntoView({ block: "start", behavior: "instant" });
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1;
			return { id: target.id, gap: target.getBoundingClientRect().top - bar.getBoundingClientRect().bottom, atEnd };
		});
		if (jump && !jump.atEnd && jump.gap < -0.5) failures.push(`${tag}: jump target #${jump.id} lands ${(-jump.gap).toFixed(1)}px under the stuck section bar`);
		await ctx.close();
	}
}
// Main site reference (the gap the standalone bar copies): on a post, the first card starts at least the token below the navbar card.
{
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await ctx.newPage();
	await page.goto(base + "/posts/rust-learnings/", { waitUntil: "load" });
	await page.waitForTimeout(600);
	const m = await page.evaluate(() => {
		const navb = document.querySelector("#navbar .card-base")?.getBoundingClientRect().bottom;
		const top = Math.min(...[...document.querySelectorAll("#main-grid .card-base")].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().top));
		return { navb, top };
	});
	if (m.navb == null || !Number.isFinite(m.top)) failures.push("main site reference: navbar card or first card not found on /posts/rust-learnings/");
	else if (m.top - m.navb < MAIN_GAP_PX - 1) failures.push(`main site: first card ${(m.top - m.navb).toFixed(1)}px below the navbar card, less than ${MAIN_GAP_PX}px`);
	await ctx.close();
}

// Drift: the report rail against the main post TOC, at 1536 and 1920 (both shown there).
const mainTocPage = "/posts/rust-learnings/";
if (tabbed.length && existsSync(path.join(DIST, "posts/rust-learnings/index.html"))) {
	for (const width of [1536, 1920]) {
		const grab = async (urlPath, sel) => {
			const ctx = await browser.newContext({ viewport: { width, height: 900 } });
			const page = await ctx.newPage();
			await page.goto(base + urlPath, { waitUntil: "load" });
			await page.waitForTimeout(400);
			const r = await page.evaluate((s) => {
				const q = (x) => document.querySelector(x);
				const rail = q(s.rail), first = rail?.querySelector("a");
				const b = (el) => el && el.getBoundingClientRect();
				const cs = (el, p) => el && getComputedStyle(el).getPropertyValue(p);
				const badge = first?.children[0], text = first?.children[1];
				return {
					railX: b(rail)?.left, railW: b(rail)?.width, railTop: b(rail)?.top,
					firstTop: b(first) && b(first).top - b(rail).top, firstH: b(first)?.height,
					badgeW: b(badge)?.width, badgeH: b(badge)?.height, badgeBg: cs(badge, "background-color"),
					badgeFg: cs(badge, "color"), badgeFont: cs(badge, "font-size"), badgeWeight: cs(badge, "font-weight"),
					textFont: cs(text, "font-size"), textLh: cs(text, "line-height"), textColor: cs(text, "color"),
					radius: cs(first, "border-radius"), minH: cs(first, "min-height"), padL: cs(first, "padding-left"), gap: cs(first, "column-gap"),
				};
			}, sel);
			await ctx.close();
			return r;
		};
		const mainR = await grab(mainTocPage, { rail: "#toc-inner-wrapper" });
		const repR = await grab(`/${pages.find((p) => tabbed.includes(p)).replace(/index\.html$/, "").split(path.sep).join("/")}`, { rail: ".rd-tabpanel:not([hidden]) .rd-toc" });
		const exact = ["badgeBg", "badgeFg", "badgeFont", "badgeWeight", "textFont", "textLh", "textColor", "radius", "minH", "padL", "gap"];
		for (const k of exact) if (mainR[k] !== repR[k]) failures.push(`TOC drift @${width}: ${k} main=${mainR[k]} report=${repR[k]}`);
		for (const k of ["railX", "railW", "railTop", "firstTop", "badgeW", "badgeH"]) {
			if (mainR[k] == null || repR[k] == null) { if (width >= 1536) failures.push(`TOC drift @${width}: ${k} missing`); continue; }
			if (Math.abs(mainR[k] - repR[k]) > 1) failures.push(`TOC drift @${width}: ${k} main=${mainR[k]} report=${repR[k]}`);
		}
	}
	// Highlight rule: the entries marked .visible must be exactly the headings whose section meets the viewport.
	// Main TOC: links in #toc, the section is each heading's parent. Report: the visible panel's rail, its sections.
	const SCROLLS = [0, 500, 1100, 1700];
	const rule = async (urlPath, linkSel, idOf) => {
		const ctx = await browser.newContext({ viewport: { width: 1920, height: 900 } });
		const page = await ctx.newPage();
		await page.goto(base + urlPath, { waitUntil: "load" });
		const out = [];
		for (const y of SCROLLS) {
			await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
			await page.waitForTimeout(700);
			out.push(await page.evaluate(({ linkSel, idOf }) => {
				const links = [...document.querySelectorAll(linkSel)].filter((a) => a.offsetParent !== null || a.getClientRects().length);
				const vh = window.innerHeight;
				const sectionOf = (a) => {
					const id = decodeURIComponent(a.hash.slice(1));
					const h = document.getElementById(id);
					return idOf === "parent" ? h?.parentElement : h;
				};
				const meets = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; };
				const expected = links.map((a) => meets(sectionOf(a)));
				const marked = links.map((a) => a.classList.contains("visible"));
				return { n: links.length, expected: expected.join(""), marked: marked.join(""), any: marked.some(Boolean) };
			}, { linkSel, idOf }));
		}
		await ctx.close();
		return out;
	};
	const mainRule = await rule(mainTocPage, "#toc table-of-contents a", "parent");
	const repPage = `/${pages.find((p) => tabbed.includes(p)).replace(/index\.html$/, "").split(path.sep).join("/")}`;
	const repRule = await rule(repPage, ".rd-tabpanel:not([hidden]) .rd-toc a", "self");
	mainRule.forEach((r, i) => { if (r.expected !== r.marked) failures.push(`TOC highlight @scroll${SCROLLS[i]} main: marked ${r.marked} != intersecting ${r.expected}`); });
	repRule.forEach((r, i) => { if (r.expected !== r.marked) failures.push(`TOC highlight @scroll${SCROLLS[i]} report: marked ${r.marked} != intersecting ${r.expected}`); });
}

// Footer, every page at these widths: the license card is never wider than the navbar card (edges within 0.5px), the
// small print is <= 13px, and each page has one license block (Astro: one visible) and one copyright line. From 1200px
// up the standalone card sits exactly on the navbar's edges.
const FOOTER_WIDTHS = [1920, 1440, 1280, 1200, 1024, 768, 375];
const LICENSE_ASIDE = 'aria-label="Copyright and license"';
const licensedPosts = readdirSync(path.join(DIST, "posts"), { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => `/posts/${d.name}/`)
	.filter((u) => existsSync(path.join(DIST, u, "index.html")) && readFileSync(path.join(DIST, u, "index.html"), "utf8").includes(LICENSE_ASIDE));
const within = (inner, outer) => inner[0] >= outer[0] - 0.5 && inner[1] <= outer[1] + 0.5;
const fmt = (r) => r.map(Math.round).join("..");
for (const width of FOOTER_WIDTHS) {
	for (const urlPath of [...pages.map((rel) => `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`), "/", "/archive/", "/research/", "/experiments/", "/ideas/", ...licensedPosts]) {
		const isStandalone = standaloneUrls.has(urlPath);
		const hasLicense = isStandalone || readFileSync(path.join(DIST, urlPath, "index.html"), "utf8").includes(LICENSE_ASIDE);
		const ctx = await browser.newContext({ viewport: { width, height: 900 } });
		const page = await ctx.newPage();
		await page.goto(base + urlPath, { waitUntil: "load" });
		const m = await page.evaluate(() => {
			const visible = (e) => e.offsetParent !== null;
			const sr = document.querySelectorAll("div[data-site-license]");
			const shadowFooter = sr[0]?.shadowRoot?.querySelector("footer");
			const bar = (document.querySelector("div[data-site-navbar]")?.shadowRoot?.querySelector("header") ?? document.querySelector("#navbar .card-base"))?.getBoundingClientRect();
			const aside = [...document.querySelectorAll('aside[aria-label="Copyright and license"]')].filter(visible)[0];
			const card = (shadowFooter ?? aside)?.getBoundingClientRect();
			const fontRoot = shadowFooter ?? aside;
			const fonts = [...(fontRoot?.querySelectorAll("p, a") ?? [])].map((e) => parseFloat(getComputedStyle(e).fontSize));
			const copyText = shadowFooter ? shadowFooter.textContent : document.body.innerText;
			return {
				licenses: shadowFooter ? sr.length : [...document.querySelectorAll('aside[aria-label="Copyright and license"]')].filter(visible).length,
				bar: bar ? [bar.left, bar.right] : null,
				card: card ? [card.left, card.right] : null,
				site: [...document.querySelectorAll(".footer")].filter(visible).map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.right]; }),
				maxFont: Math.max(0, ...fonts),
				copyrights: (copyText.match(/all rights reserved/gi) ?? []).length,
			};
		});
		const tag = `${urlPath} @${width}`;
		const want = hasLicense ? 1 : 0;
		if (isStandalone && !m.card) failures.push(`${tag}: license notice missing`);
		if (m.licenses !== want) failures.push(`${tag}: ${m.licenses} license block(s), expected ${want}`);
		if (m.copyrights !== 1) failures.push(`${tag}: "All rights reserved" appears ${m.copyrights} time(s), expected 1`);
		if (m.card && m.maxFont > 13) failures.push(`${tag}: license text ${m.maxFont}px (small print must be <= 13px)`);
		if (m.bar && m.card && !within(m.card, m.bar)) failures.push(`${tag}: license card ${fmt(m.card)} wider than the navbar card ${fmt(m.bar)}`);
		if (m.bar && m.card && isStandalone && width >= 1200 && (Math.abs(m.card[0] - m.bar[0]) > 1 || Math.abs(m.card[1] - m.bar[1]) > 1)) {
			failures.push(`${tag}: license card ${fmt(m.card)} differs from the navbar card ${fmt(m.bar)}`);
		}
		if (m.bar && !isStandalone) for (const s of m.site) if (!within(s, m.bar)) failures.push(`${tag}: site footer ${fmt(s)} outside the navbar card ${fmt(m.bar)}`);
		await ctx.close();
	}
}

// Navbar parity with the main site: on a standalone page the navbar must match the main navbar's rects, colours and
// fonts at every width (short and scrolling pages), take no width from the page scrollbar, stick to the top, and its
// open panels must be the topmost thing at their centre (not under a page's sticky bar).
const PARITY_PAGE = "/research/brev-tree-benchmark/";
const PARITY_WIDTHS = [375, 768, 1024, 1280, 1440, 1920];
const navState = () => {
	const host = document.querySelector("[data-site-navbar]");
	const root = host ? host.shadowRoot : document;
	const bar = host ? root.querySelector("header") : document.querySelector("#navbar .card-base");
	const controls = {};
	for (const el of bar.querySelectorAll("a, button")) {
		if (el.closest(".closed, .float-panel-closed")) continue;
		const r = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		if (cs.display === "none" || r.width === 0) continue;
		const name = (el.getAttribute("aria-label") || el.textContent || "").trim();
		controls[name] = { x: r.left, w: r.width, h: r.height, color: cs.color, fs: cs.fontSize, fw: cs.fontWeight };
	}
	const br = bar.getBoundingClientRect();
	return { bar: { x: br.left, w: br.width, h: br.height, bg: getComputedStyle(bar).backgroundColor }, controls, sbw: innerWidth - document.documentElement.clientWidth, scrollable: document.documentElement.scrollHeight > innerHeight };
};
if (standaloneUrls.has(PARITY_PAGE)) {
	const near = (a, b) => Math.abs(a - b) <= 1;
	const load = async (urlPath, theme, width, height) => {
		const ctx = await browser.newContext({ viewport: { width, height } });
		await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
		const page = await ctx.newPage();
		await page.goto(base + urlPath, { waitUntil: "load" });
		await page.waitForSelector(urlPath === "/" ? "#navbar .card-base" : "[data-site-navbar]", { timeout: 15000 });
		await page.waitForTimeout(300);
		return { ctx, page };
	};
	for (const theme of ["light", "dark"]) for (const w of PARITY_WIDTHS) for (const h of [900, 4000]) {
		const tag = `${PARITY_PAGE} ${theme} @${w}x${h} navbar parity`;
		const m = await load("/", theme, w, h);
		const main = await m.page.evaluate(navState);
		await m.ctx.close();
		const s = await load(PARITY_PAGE, theme, w, h);
		const std = await s.page.evaluate(navState);
		if (h === 900) {
			// Panels: open each trigger that shows at this width, after scrolling so a sticky page bar sits under them.
			await s.page.evaluate(() => window.scrollTo(0, 800));
			await s.page.waitForTimeout(100);
			for (const sel of ["button.sbtn", "button.pal", "button.menu"]) {
				if (!(await s.page.locator(sel).first().isVisible())) continue;
				try {
					await s.page.click(sel, { timeout: 5000 });
				} catch {
					failures.push(`${PARITY_PAGE} @${w} ${sel}: not clickable (covered by page content)`);
					continue;
				}
				await s.page.waitForTimeout(300);
				const hit = await s.page.evaluate((sel) => {
					const host = document.querySelector("[data-site-navbar]");
					const panel = host.shadowRoot.querySelector(sel === "button.sbtn" ? ".sp" : sel === "button.pal" ? ".panel" : ".menu-panel");
					const r = panel.getBoundingClientRect();
					const cx = r.left + r.width / 2, cy = Math.min(r.top + r.height / 2, r.bottom - 4);
					const inner = host.shadowRoot.elementFromPoint(cx, cy);
					return { open: !panel.classList.contains("closed") && r.width > 0, inside: panel.contains(inner), onTop: document.elementFromPoint(cx, cy) === host };
				}, sel);
				if (!hit.open || !hit.inside || !hit.onTop) failures.push(`${PARITY_PAGE} @${w} ${sel}: panel not open, or covered (open=${hit.open} inside=${hit.inside} onTop=${hit.onTop})`);
			}
			const sticky = await s.page.evaluate(() => {
				const host = document.querySelector("[data-site-navbar]");
				const cs = getComputedStyle(host);
				return { pos: cs.position, z: +cs.zIndex, top: host.getBoundingClientRect().top };
			});
			if (sticky.pos !== "sticky" || sticky.z < 1000 || sticky.top !== 0) failures.push(`${PARITY_PAGE} @${w}: navbar not sticky above content (position=${sticky.pos}, z=${sticky.z}, top=${sticky.top})`);
		}
		await s.ctx.close();
		if (main.bar.bg !== std.bar.bg || !near(main.bar.x, std.bar.x) || !near(main.bar.w, std.bar.w) || !near(main.bar.h, std.bar.h)) failures.push(`${tag}: bar ${JSON.stringify(std.bar)} vs main ${JSON.stringify(main.bar)}`);
		if (std.sbw !== 0) failures.push(`${tag}: page scrollbar takes ${std.sbw}px of layout width (main takes 0)`);
		// Every visible link (Ideas included) must sit inside the navbar card, on both navbars: an overflowing nav wraps or spills out.
		for (const [who, st] of [["main", main], ["standalone", std]]) {
			for (const [name, c] of Object.entries(st.controls)) {
				if (c.x < st.bar.x - 1 || c.x + c.w > st.bar.x + st.bar.w + 1) failures.push(`${tag}: "${name}" ${Math.round(c.x)}..${Math.round(c.x + c.w)} outside the ${who} navbar card ${Math.round(st.bar.x)}..${Math.round(st.bar.x + st.bar.w)}`);
			}
		}
		if (std.scrollable !== main.scrollable && h === 900) failures.push(`${tag}: scroll state differs (main ${main.scrollable}, standalone ${std.scrollable})`);
		for (const [name, mc] of Object.entries(main.controls)) {
			const sc = std.controls[name];
			if (!sc) { failures.push(`${tag}: "${name}" missing from the standalone navbar`); continue; }
			if (!near(mc.x, sc.x) || !near(mc.w, sc.w) || !near(mc.h, sc.h)) failures.push(`${tag}: "${name}" at ${sc.x}/${sc.w}x${sc.h}, main ${mc.x}/${mc.w}x${mc.h}`);
			if (name !== "Ning Waikhom" && (mc.color !== sc.color || mc.fs !== sc.fs || mc.fw !== sc.fw)) failures.push(`${tag}: "${name}" is ${sc.color} ${sc.fs} ${sc.fw}, main ${mc.color} ${mc.fs} ${mc.fw}`);
		}
		for (const name of Object.keys(std.controls)) if (!main.controls[name]) failures.push(`${tag}: "${name}" only in the standalone navbar`);
	}
}

// Comments (giscus, click to load). Reports, live experiments and ideas get a section above the license card; other
// standalone pages get none (static, from the built HTML). In a browser: nothing reaches giscus.app before "Load comments"
// is pressed; after it the client script loads, the section keeps the column and the footer order, and a theme change
// reaches the giscus frame. giscus.app is stubbed here (no network), so this checks our side of the contract only.
const COMMENTS_PAGE = /^\/(research|experiments|ideas)\/[^/]+\/$/;
const COMMENTS_OPT_OUT = /<meta[^>]+name=["']rd-comments["'][^>]+content=["']off["']/i;
const commentsSrc = readFileSync("src/config.ts", "utf8");
const commentCfg = (key) => commentsSrc.match(new RegExp(`\\b${key}: "([^"]+)"`))?.[1];
const GISCUS_STUB = "(function(){var s=document.currentScript;var f=document.createElement('iframe');f.className='giscus-frame';f.src='about:blank';s.parentElement.appendChild(f);f.contentWindow.postMessage=function(m,o){(window.__posted=window.__posted||[]).push([m,o])};})();";
for (const rel of pages) {
	const urlPath = `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
	const expected = COMMENTS_PAGE.test(urlPath) && !COMMENTS_OPT_OUT.test(readFileSync(path.join(PUBLIC, rel), "utf8"));
	const built = readFileSync(path.join(DIST, rel), "utf8");
	const has = built.includes("data-site-comments");
	if (has !== expected) failures.push(`${urlPath}: comments section ${has ? "present" : "missing"}, expected ${expected ? "present" : "absent"}`);
	else if (has && built.indexOf("data-site-comments") > built.indexOf("data-site-license")) failures.push(`${urlPath}: comments section is below the license card`);
	if (!expected) continue;
	for (const width of [1440, 375]) {
		const tag = `${urlPath} @${width} comments`;
		const ctx = await browser.newContext({ viewport: { width, height: 900 } });
		const page = await ctx.newPage();
		let clicked = false;
		const before = [];
		const after = [];
		await page.route("https://giscus.app/**", (route) => {
			const u = route.request().url();
			(clicked ? after : before).push(u);
			if (u.endsWith("/client.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: GISCUS_STUB });
			return route.abort();
		});
		await page.goto(base + urlPath, { waitUntil: "load" });
		await page.waitForTimeout(300);
		const pre = await page.evaluate(() => {
			const box = (el) => el?.getBoundingClientRect();
			const sec = box(document.querySelector("[data-site-comments]"));
			const lic = box(document.querySelector("div[data-site-license]"));
			const main = box(document.querySelector("main"));
			return {
				sec: sec && { top: sec.top, bottom: sec.bottom, w: sec.width },
				lic: lic && lic.top,
				mainBottom: main ? main.bottom : null,
				button: !!document.querySelector(".rd-comments__load"),
				frames: document.querySelectorAll("iframe.giscus-frame, script[src*='giscus']").length,
				cw: document.documentElement.clientWidth,
				sw: document.documentElement.scrollWidth,
			};
		});
		if (!pre.sec || !pre.button) failures.push(`${tag}: section or "Load comments" button not found`);
		else {
			if (pre.lic !== null && pre.sec.bottom > pre.lic + 1) failures.push(`${tag}: section ends below the license card top`);
			if (pre.mainBottom !== null && pre.mainBottom > pre.sec.top + 1) failures.push(`${tag}: section starts above the end of the content`);
			// 872px (54.5rem) column, narrower when the page's own body gutter is in the way; never wider.
			if (pre.sec.w > Math.min(872, pre.cw) + 1) failures.push(`${tag}: column ${Math.round(pre.sec.w)}px is wider than 872px or the viewport`);
			if (width >= 1000 && Math.abs(pre.sec.w - 872) > 1) failures.push(`${tag}: column ${Math.round(pre.sec.w)}px, expected 872px (54.5rem)`);
		}
		if (before.length) failures.push(`${tag}: request(s) to giscus.app before the click: ${[...new Set(before)].slice(0, 3).join(", ")}`);
		if (pre.frames) failures.push(`${tag}: giscus script or frame present before the click`);
		clicked = true;
		await page.click(".rd-comments__load");
		await page.waitForSelector("iframe.giscus-frame", { timeout: 5000 }).catch(() => {});
		const post = await page.evaluate(() => {
			const s = document.querySelector('script[src="https://giscus.app/client.js"]');
			return {
				focus: document.activeElement?.id ?? "",
				button: !!document.querySelector(".rd-comments__load"),
				repoId: s?.getAttribute("data-repo-id"),
				categoryId: s?.getAttribute("data-category-id"),
				mapping: s?.getAttribute("data-mapping"),
				theme: s?.getAttribute("data-theme"),
				frame: !!document.querySelector("iframe.giscus-frame"),
			};
		});
		if (!after.some((u) => u.endsWith("/client.js"))) failures.push(`${tag}: giscus client.js not requested after the click`);
		if (post.button || !post.frame) failures.push(`${tag}: button not replaced by the giscus frame`);
		if (post.repoId !== commentCfg("repoId") || post.categoryId !== commentCfg("categoryId")) failures.push(`${tag}: repo/category ids differ from src/config.ts`);
		if (post.mapping !== "pathname") failures.push(`${tag}: data-mapping is ${post.mapping}, expected pathname`);
		if (post.focus !== "rd-comments-slot") failures.push(`${tag}: focus not moved into the comments after the click (${post.focus || "none"})`);
		const themeNow = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
		if (post.theme !== (themeNow === "dark" ? "dark" : "light")) failures.push(`${tag}: giscus theme ${post.theme} does not match the page (${themeNow})`);
		await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
		await page.waitForFunction(() => (window.__posted || []).some((p) => p[1] === "https://giscus.app" && p[0].giscus?.setConfig?.theme === "dark"), null, { timeout: 3000 }).catch(() => {});
		const synced = await page.evaluate(() => (window.__posted || []).some((p) => p[1] === "https://giscus.app" && p[0].giscus?.setConfig?.theme === "dark"));
		if (!synced) failures.push(`${tag}: theme change to dark was not posted to the giscus frame`);
		await ctx.close();
	}
}

// A breadcrumb link must resolve to a page or file in dist (directory links end in /).
const crumbTargetExists = (href) => existsSync(path.join(DIST, href.endsWith("/") ? path.join(href, "index.html") : href));
// Breadcrumb (rd-breadcrumb, injected by standalone-header.ts) on every standalone page: exactly one, the trail the path
// and title give, real links that resolve, the current item as text, JSON-LD that matches, clear of the navbar and the
// section bar, one line, no overflow, 24px tap targets, and aligned with the page's heading (it is the first child of <main>).
const CRUMB_SECTIONS = { research: "Research", experiments: "Experiments", ideas: "Ideas", "design-system": "Design system" };
const CRUMB_WIDTHS = [1440, 768, 375];
const CRUMB_SITE = "https://ningsuhen.github.io/";
const decodeEntities = (t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
for (const rel of pages) {
	const src = readFileSync(path.join(PUBLIC, rel), "utf8");
	const urlPath = `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
	const segs = urlPath.split("/").filter(Boolean);
	const section = CRUMB_SECTIONS[segs[0] ?? ""];
	const onSection = !!section && segs.length === 1;
	// Pages on the design system (linked research.css, or an inlined copy with the band rules) get the band; a fragment
	// export without <body> gets it before its <main>. Other pages keep their own shell.
	const onDs = /design-system\/(?:research|rd)\.css/.test(src) || src.includes(".rd-crumb-band {");
	const optedOut = /<meta[^>]+name=["']rd-breadcrumb["'][^>]+content=["']off["']/i.test(src);
	const titleRaw = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
	const pageTitle = decodeEntities(titleRaw.replace(/\s*·\s*created\s+\d{4}-\d{2}-\d{2}\s*·\s*updated\s+\d{4}-\d{2}-\d{2}\s*$/, "").trim());
	const names = ["Home", ...(section && !onSection ? [section] : []), onSection ? section : pageTitle];
	const hrefs = ["/", ...(section && !onSection ? [`/${segs[0]}/`] : [])];
	const tag = `${urlPath} [breadcrumb]`;
	const wantCount = onDs && !optedOut ? 1 : 0;
	for (const w of CRUMB_WIDTHS) {
		const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
		const page = await ctx.newPage();
		await page.goto(`${base}${urlPath}`, { waitUntil: "load" });
		const m = await page.evaluate(() => {
			const r = (el) => (el ? el.getBoundingClientRect() : null);
			const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
			const host = document.querySelector("div[data-site-navbar]");
			const header = host?.shadowRoot?.querySelector("header");
			const expnav = document.querySelector(".rd-expnav");
			const h1 = [...document.querySelectorAll("h1")].find((h) => h.offsetParent !== null);
			const textLeft = (el) => {
				if (!el) return null;
				const range = document.createRange();
				range.selectNodeContents(el);
				return range.getBoundingClientRect().left;
			};
			const items = nav ? [...nav.querySelectorAll("li")] : [];
			let ld = null;
			try { ld = JSON.parse(nav?.previousElementSibling?.textContent ?? "null"); } catch { ld = "unparseable"; }
			const cur = nav?.querySelector('[aria-current="page"]');
			return {
				count: document.querySelectorAll('nav[aria-label="Breadcrumb"]').length,
				bands: document.querySelectorAll(".rd-crumb-band").length,
				labels: items.map((li) => li.textContent.trim()),
				hrefs: items.map((li) => li.querySelector("a")?.getAttribute("href") ?? null),
				currentOk: !!cur && cur.tagName === "SPAN" && !cur.closest("a") && cur === items[items.length - 1]?.firstElementChild,
				ld,
				navBox: r(nav) && { x: r(nav).left, w: r(nav).width, top: r(nav).top, bottom: r(nav).bottom },
				headerBottom: header ? header.getBoundingClientRect().bottom : null,
				expnavTop: r(expnav)?.top ?? null,
				olH: nav ? nav.querySelector("ol").getBoundingClientRect().height : 0,
				linkH: nav ? [...nav.querySelectorAll("a")].map((a) => a.getBoundingClientRect().height) : [],
				pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
				navOverflow: nav ? nav.scrollWidth - nav.clientWidth : 0,
				textLeft: nav ? textLeft(nav.querySelector("li")) : null,
				h1Left: textLeft(h1),
				vw: document.documentElement.clientWidth,
			};
		});
		await ctx.close();
		if (m.count !== wantCount) { failures.push(`${tag} @${w}: ${m.count} breadcrumb(s), expected ${wantCount}`); continue; }
		if (m.bands !== (onDs ? 1 : 0)) failures.push(`${tag} @${w}: ${m.bands} breadcrumb band(s), expected ${onDs ? 1 : 0} (the band holds the trail)`);
		if (!wantCount) continue;
		const tg = `${tag} @${w}`;
		if (JSON.stringify(m.labels) !== JSON.stringify(names)) failures.push(`${tg}: trail "${m.labels.join(" > ")}", expected "${names.join(" > ")}"`);
		if (JSON.stringify(m.hrefs.slice(0, -1)) !== JSON.stringify(hrefs)) failures.push(`${tg}: links ${JSON.stringify(m.hrefs)}, expected ${JSON.stringify(hrefs)}`);
		if (m.hrefs[m.hrefs.length - 1] !== null || !m.currentOk) failures.push(`${tg}: current item must be aria-current text, not a link`);
		for (const h of m.hrefs.filter(Boolean)) if (!crumbTargetExists(h)) failures.push(`${tg}: link ${h} does not resolve in dist`);
		if (!m.ld || typeof m.ld === "string" || m.ld["@type"] !== "BreadcrumbList") failures.push(`${tg}: JSON-LD BreadcrumbList missing`);
		else {
			const items = m.ld.itemListElement ?? [];
			if (JSON.stringify(items.map((i) => i.name)) !== JSON.stringify(names)) failures.push(`${tg}: JSON-LD names ${JSON.stringify(items.map((i) => i.name))}`);
			const last = items[items.length - 1]?.item ?? "";
			if (!last.startsWith(CRUMB_SITE) || last !== CRUMB_SITE + urlPath.slice(1)) failures.push(`${tg}: JSON-LD last item ${last}, expected ${CRUMB_SITE}${urlPath.slice(1)}`);
		}
		const b = m.navBox;
		if (m.headerBottom !== null && b.top < m.headerBottom - 0.5) failures.push(`${tg}: top ${Math.round(b.top)} under the navbar (bottom ${Math.round(m.headerBottom)})`);
		if (m.expnavTop !== null && m.expnavTop < b.bottom - 0.5) failures.push(`${tg}: section bar at ${Math.round(m.expnavTop)} overlaps the trail (bottom ${Math.round(b.bottom)})`);
		if (m.olH > 26) failures.push(`${tg}: trail wraps (${Math.round(m.olH)}px tall, one line is 24px)`);
		if (m.pageOverflow > 0 || m.navOverflow > 0) failures.push(`${tg}: horizontal overflow (page ${m.pageOverflow}px, trail ${m.navOverflow}px)`);
		if (w === 375 && m.linkH.some((h) => h < 23.5)) failures.push(`${tg}: link under 24px tall (${m.linkH.map(Math.round).join(", ")})`);
		if (m.textLeft !== null && m.h1Left !== null && Math.abs(m.textLeft - m.h1Left) > 1.5) failures.push(`${tg}: trail text at ${Math.round(m.textLeft)}, page heading at ${Math.round(m.h1Left)}`);
	}
}

// Breadcrumb band opacity: the band under the navbar card must never let the page show through. On every page with a band,
// at 375, 768 and 1440, light and dark, at four scroll positions: the band has the navbar card's frame (same left edge and
// width), sits directly under the card at --rd-crumb-h (16px when empty), the topmost element at a grid of points inside it is
// the band (or its trail), and the screenshot pixels of its top and bottom strips (clear of the 24px text line) are exactly
// the page background. A transparent or covered band shows content there.
const BAND_WIDTHS = [375, 768, 1440];
const bandPages = pages.filter((rel) => {
	const src = readFileSync(path.join(PUBLIC, rel), "utf8");
	return /design-system\/(?:research|rd)\.css/.test(src) || src.includes(".rd-crumb-band {");
});
for (const rel of bandPages) {
	const urlPath = `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
	for (const theme of ["light", "dark"]) for (const width of BAND_WIDTHS) {
		const tag = `${urlPath} ${theme} @${width} [band]`;
		const ctx = await browser.newContext({ viewport: { width, height: 900 } });
		await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
		const page = await ctx.newPage();
		await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
		await page.goto(base + urlPath, { waitUntil: "load" });
		await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
		const maxY = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
		for (const y of [0, Math.round(maxY * 0.25), Math.round(maxY * 0.6), maxY]) {
			await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y);
			await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
			const m = await page.evaluate(() => {
				const band = document.querySelector("[data-site-breadcrumb]");
				const hd = document.querySelector("div[data-site-navbar]")?.shadowRoot?.querySelector("header")?.getBoundingClientRect();
				if (!band || !hd) return null;
				// The opaque surface is the band's ::before (the navbar card's frame); the band box spans the body's content box.
				const r = band.getBoundingClientRect();
				const sur = getComputedStyle(band, "::before");
				const b = { left: r.left + parseFloat(sur.left), width: parseFloat(sur.width), top: r.top, height: r.height };
				const covered = [];
				for (const kx of [0.01, 0.25, 0.5, 0.75, 0.99]) for (const ky of [0.1, 0.5, 0.9]) {
					const x = b.left + b.width * kx, yy = b.top + b.height * ky;
					const el = document.elementFromPoint(x, yy);
					if (!el?.closest("[data-site-breadcrumb]")) covered.push(`${Math.round(x)},${Math.round(yy)}=${el ? el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "") : "none"}`);
				}
				// The page background as the screen shows it: paint the band's computed colour on a canvas (sRGB, like the screenshot).
				const c = document.createElement("canvas").getContext("2d");
				c.fillStyle = sur.backgroundColor;
				c.fillRect(0, 0, 1, 1);
				const bg = [...c.getImageData(0, 0, 1, 1).data];
				return { x: b.left, w: b.width, t: b.top, h: b.height, hdX: hd.left, hdW: hd.width, hdB: hd.bottom, covered, bg, bodyBg: getComputedStyle(document.body).backgroundColor, bandBg: sur.backgroundColor, empty: band.classList.contains("rd-crumb-band--empty") };
			});
			const at = `${tag} scrollY ${y}`;
			if (!m) { failures.push(`${at}: band or navbar card not found`); break; }
			if (Math.abs(m.x - m.hdX) > 0.5 || Math.abs(m.w - m.hdW) > 0.5) failures.push(`${at}: band ${m.x.toFixed(1)}+${m.w.toFixed(1)}px, navbar card ${m.hdX.toFixed(1)}+${m.hdW.toFixed(1)}px (same frame expected)`);
			if (Math.abs(m.t - m.hdB) > 0.5) failures.push(`${at}: band top ${m.t.toFixed(1)}px, navbar card bottom ${m.hdB.toFixed(1)}px`);
			if (Math.abs(m.h - (m.empty ? 16 : 40)) > 0.5) failures.push(`${at}: band ${m.h.toFixed(1)}px tall, expected ${m.empty ? 16 : 40}px`);
			if (m.bandBg !== m.bodyBg) failures.push(`${at}: band background ${m.bandBg}, page background ${m.bodyBg}`);
			if (m.covered.length) failures.push(`${at}: something covers the band at ${m.covered.slice(0, 3).join(" ")}`);
			// Pixels: 3px strips at the band's top and bottom (the trail's 24px line sits in the middle 24px of 40).
			const strip = m.empty ? m.h : 3;
			for (const top of m.empty ? [m.t] : [m.t + 1, m.t + m.h - 1 - strip]) {
				const png = await page.screenshot({ clip: { x: Math.max(0, m.x), y: top, width: Math.min(m.w, width - Math.max(0, m.x)), height: strip }, animations: "disabled", caret: "hide" });
				const off = await page.evaluate(async ({ b64, bg }) => {
					const img = new Image();
					img.src = `data:image/png;base64,${b64}`;
					await img.decode();
					const c = document.createElement("canvas");
					c.width = img.naturalWidth; c.height = img.naturalHeight;
					const g = c.getContext("2d");
					g.drawImage(img, 0, 0);
					const d = g.getImageData(0, 0, c.width, c.height).data;
					let bad = 0, first = null;
					for (let i = 0; i < d.length; i += 4) {
						if (Math.abs(d[i] - bg[0]) > 3 || Math.abs(d[i + 1] - bg[1]) > 3 || Math.abs(d[i + 2] - bg[2]) > 3) { bad++; if (!first) first = `x=${(i / 4) % c.width} rgb(${d[i]},${d[i + 1]},${d[i + 2]})`; }
					}
					return { bad, first, n: d.length / 4 };
				}, { b64: png.toString("base64"), bg: m.bg });
				if (off.bad) failures.push(`${at}: ${off.bad}/${off.n} band pixels at y=${Math.round(top)} are not the page background (first ${off.first}, expected rgb(${m.bg.slice(0, 3).join(",")}))`);
			}
		}
		await ctx.close();
	}
}

// Stuck rail under the section bar: below 1536px the tab panel's "On this page" rail sticks under the bar. It must sit flush
// against the bar's bottom (navbar + band + bar, no gap), so nothing scrolls through between them. On every page with a
// sticky rail, at 375, 768 and 1440, light and dark, at three scroll positions inside the visible panel: when the rail is
// stuck its top equals the bar's bottom, the topmost element just under the bar is the rail, and the screenshot pixels of a
// 2px strip at the rail's top are the page background.
const railPages = bandPages.filter((rel) => readFileSync(path.join(PUBLIC, rel), "utf8").includes('class="rd-toc"') && /\brd-expnav\b/.test(readFileSync(path.join(PUBLIC, rel), "utf8")));
for (const rel of railPages) {
	const urlPath = `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
	for (const theme of ["light", "dark"]) for (const width of BAND_WIDTHS) {
		const tag = `${urlPath} ${theme} @${width} [rail under the bar]`;
		const ctx = await browser.newContext({ viewport: { width, height: 900 } });
		await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
		const page = await ctx.newPage();
		await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
		await page.goto(base + urlPath, { waitUntil: "load" });
		await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
		// Scroll targets where the rail is stuck: inside its container, past its natural top, before its container ends.
		const span = await page.evaluate(() => {
			const rail = [...document.querySelectorAll(".rd-toc")].find((r) => r.getClientRects().length && getComputedStyle(r).position === "sticky");
			if (!rail) return null;
			const box = rail.parentElement.getBoundingClientRect();
			const top = box.top + window.scrollY, bottom = box.bottom + window.scrollY, h = rail.getBoundingClientRect().height;
			return { from: top + 200, to: bottom - h - window.innerHeight * 0.5 };
		});
		if (!span || span.to <= span.from) { await ctx.close(); continue; }
		let stuck = 0;
		for (const k of [0, 0.5, 1]) {
			const y = Math.round(span.from + (span.to - span.from) * k);
			await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y);
			await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
			const m = await page.evaluate(() => {
				const bar = document.querySelector(".rd-expnav").getBoundingClientRect();
				const railEl = [...document.querySelectorAll(".rd-toc")].find((r) => r.getClientRects().length && getComputedStyle(r).position === "sticky");
				const rail = railEl.getBoundingClientRect();
				const stuckTop = parseFloat(getComputedStyle(railEl).top);
				const hits = [];
				for (const kx of [0.02, 0.5, 0.98]) {
					const x = rail.left + rail.width * kx, yy = bar.bottom + 1;
					const el = document.elementFromPoint(x, yy);
					if (!el?.closest(".rd-toc")) hits.push(`${Math.round(x)},${Math.round(yy)}=${el ? el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : "") : "none"}`);
				}
				const c = document.createElement("canvas").getContext("2d");
				c.fillStyle = getComputedStyle(document.body).backgroundColor;
				c.fillRect(0, 0, 1, 1);
				return { barBottom: bar.bottom, railTop: rail.top, railLeft: rail.left, railW: rail.width, stuck: Math.abs(rail.top - stuckTop) < 0.5, stuckTop, hits, bg: [...c.getImageData(0, 0, 1, 1).data] };
			});
			const at = `${tag} scrollY ${y}`;
			if (!m.stuck) continue;
			stuck++;
			if (Math.abs(m.railTop - m.barBottom) > 0.5) failures.push(`${at}: stuck rail top ${m.railTop.toFixed(1)}px, section bar bottom ${m.barBottom.toFixed(1)}px (content shows through the ${(m.railTop - m.barBottom).toFixed(1)}px gap)`);
			if (m.hits.length) failures.push(`${at}: under the section bar the topmost element is not the rail: ${m.hits.join(" ")}`);
			const png = await page.screenshot({ clip: { x: Math.max(0, m.railLeft), y: m.barBottom, width: Math.min(m.railW, width - Math.max(0, m.railLeft)), height: 2 }, animations: "disabled", caret: "hide" });
			const off = await page.evaluate(async ({ b64, bg }) => {
				const img = new Image();
				img.src = `data:image/png;base64,${b64}`;
				await img.decode();
				const c = document.createElement("canvas");
				c.width = img.naturalWidth; c.height = img.naturalHeight;
				const g = c.getContext("2d");
				g.drawImage(img, 0, 0);
				const d = g.getImageData(0, 0, c.width, c.height).data;
				let bad = 0, first = null;
				for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) > 3 || Math.abs(d[i + 1] - bg[1]) > 3 || Math.abs(d[i + 2] - bg[2]) > 3) { bad++; first ??= `x=${(i / 4) % c.width} rgb(${d[i]},${d[i + 1]},${d[i + 2]})`; }
				return { bad, first, n: d.length / 4 };
			}, { b64: png.toString("base64"), bg: m.bg });
			if (off.bad) failures.push(`${at}: ${off.bad}/${off.n} pixels just under the section bar are not the page background (first ${off.first})`);
		}
		// Below 1536px the rail is sticky; a page whose panel is too short to stick it at all is not a pass by default.
		if (!stuck) failures.push(`${tag}: rail never stuck at the sampled scroll positions (check the sample or the page)`);
		await ctx.close();
	}
}

await browser.close();
server.close();

if (failures.length) {
	console.error(`standalone page check FAILED (${failures.length}):\n - ${failures.join("\n - ")}`);
	process.exit(1);
}
console.log(`standalone page check passed: ${pages.length} page(s) x ${VIEWPORTS.length} viewports; tabbed rail by width: ${railLog.join(" ") || "none"}`);
