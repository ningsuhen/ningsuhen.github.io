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
			const host = document.querySelector("[data-site-navbar]");
			const r = host?.getBoundingClientRect();
			const doc = document.documentElement;
			return {
				has: !!host,
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
		if (m.sw > m.cw + 1) failures.push(`${tag}: horizontal overflow (scrollWidth ${m.sw} > ${m.cw})`);
		if (m.mojibake) failures.push(`${tag}: mojibake in page text (missing/wrong charset)`);
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
