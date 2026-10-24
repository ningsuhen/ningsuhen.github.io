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

const browser = await chromium.launch({ executablePath: findChrome() });
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
await browser.close();
server.close();

if (failures.length) {
	console.error(`standalone page check FAILED (${failures.length}):\n - ${failures.join("\n - ")}`);
	process.exit(1);
}
console.log(`standalone page check passed: ${pages.length} page(s) x ${VIEWPORTS.length} viewports`);
