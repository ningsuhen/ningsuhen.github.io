// Loads every standalone public/**/*.html page from the built site in a real browser and fails on layout
// regressions in the injected navbar. Run after `pnpm build`:  pnpm check:standalone
// Browser: set CHROME_PATH, or `pnpm exec playwright-core install chromium` (CI does this).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const DIST = path.resolve("dist");
const PUBLIC = path.resolve("public");
const VIEWPORTS = [
	{ width: 1440, height: 900 },
	{ width: 375, height: 800 },
];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function htmlPages(dir = "") {
	return readdirSync(path.join(PUBLIC, dir), { withFileTypes: true }).flatMap((e) => {
		const rel = path.join(dir, e.name);
		if (e.isDirectory()) return htmlPages(rel);
		return e.name.endsWith(".html") ? [rel] : [];
	});
}

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
const pages = htmlPages();
for (const rel of pages) {
	const src = readFileSync(path.join(PUBLIC, rel), "utf8");
	const optedOut = /<meta[^>]+name=["']site-navbar["'][^>]+content=["']off["']/i.test(src);
	const urlPath = `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
	for (const vp of VIEWPORTS) {
		const ctx = await browser.newContext({ viewport: vp });
		const page = await ctx.newPage();
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
		await ctx.close();
	}
}

// Navigation regression: from a site page, a link to a standalone page must be a normal full navigation,
// and Back must restore the site page intact (Swup used to intercept the link and corrupt the page).
const standaloneUrls = new Set(pages.map((rel) => `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`));
for (const sitePath of ["/experiments/", "/research/"]) {
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
]) {
	if (pages.includes(path.join(section, "index.html"))) failures.push(`public/${section}/index.html exists: the Astro page owns /${section}/`);
	// Draft entries are hidden on purpose (work in progress), so they are exempt.
	const drafts = new Set(
		JSON.parse(readFileSync(path.join("src/data", `${section}.json`), "utf8"))
			.items.filter((i) => i.status.toLowerCase() === "draft")
			.map((i) => i.href),
	);
	const expected = pages
		.filter((rel) => rel.startsWith(`${section}${path.sep}`) && rel.split(path.sep).length === 3)
		.map((rel) => `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`)
		.filter((u) => !drafts.has(u));
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
for (const sitePath of ["/", "/archive/", "/research/"]) {
	for (const vp of [{ width: 768, height: 1000 }, { width: 375, height: 800 }]) {
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
		if (m.tabCount !== m.panelCount || m.tabCount !== 8) failures.push(`${tag}: ${m.tabCount} tabs for ${m.panelCount} panels (expected 8 and 8)`);
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
	for (const urlPath of [...pages.map((rel) => `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`), "/", "/archive/", "/research/", "/experiments/", ...licensedPosts]) {
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

await browser.close();
server.close();

if (failures.length) {
	console.error(`standalone page check FAILED (${failures.length}):\n - ${failures.join("\n - ")}`);
	process.exit(1);
}
console.log(`standalone page check passed: ${pages.length} page(s) x ${VIEWPORTS.length} viewports; tabbed rail by width: ${railLog.join(" ") || "none"}`);
