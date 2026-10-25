// Regression check for the one theme model (main site + standalone pages). Run after `pnpm build`: pnpm check:theme
// Model: localStorage "theme" = light | dark | auto; anything else (or unset) is light. Only auto follows the OS.
// Asserts, for OS scheme x stored value, across loads, Swup and full navigations, Back/Forward, both toggles,
// a 5 s idle, a live OS change and a second tab: the shown theme, the `dark` class, <html data-theme> on
// standalone pages, the navbar bar's mirror of it, and that page loads never write `theme`.
// Browser: CHROME_PATH, or the playwright-core chromium. THEME_DIST overrides the build dir (negative test).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const DIST = path.resolve(process.env.THEME_DIST ?? "dist");
const MAIN = ["/archive/", "/posts/ai-boom-trajectories/", "/research/", "/experiments/", "/ideas/"];
const STANDALONE = ["/research/ai-economy/", "/research/brev-tree-benchmark/", "/experiments/brev-tree-traversal/", "/design-system/"];
const SEEDS = [null, "garbage", "light", "dark", "auto"];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
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

// The model in one line: dark when the choice is dark, or auto and the OS is dark.
const wantDark = (stored, osDark) => stored === "dark" || (stored === "auto" && osDark);

const readState = (page) =>
	page.evaluate(() => {
		const r = document.documentElement;
		let ls = null;
		try {
			ls = localStorage.getItem("theme");
		} catch {
			ls = "ERR";
		}
		let bg = "rgba(0, 0, 0, 0)";
		for (let e = document.body; e && bg === "rgba(0, 0, 0, 0)"; e = e.parentElement) bg = getComputedStyle(e).backgroundColor;
		const cv = document.createElement("canvas");
		cv.width = cv.height = 1;
		const x = cv.getContext("2d");
		x.fillStyle = bg;
		x.fillRect(0, 0, 1, 1);
		const [R, G, B] = x.getImageData(0, 0, 1, 1).data;
		const host = document.querySelector("[data-site-navbar]");
		return {
			path: location.pathname,
			ls,
			dark: r.classList.contains("dark"),
			dt: r.getAttribute("data-theme"),
			shownDark: (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255 < 0.5,
			bar: host ? host.getAttribute("data-theme") : null,
		};
	});

const failures = [];
let checks = 0;
async function check(label, page, storedWant, osDark) {
	const st = await readState(page);
	const dark = wantDark(storedWant, osDark);
	const standalone = STANDALONE.includes(st.path);
	const problems = [];
	if (st.ls !== storedWant) problems.push(`theme=${st.ls} want ${storedWant}`);
	if (st.dark !== dark) problems.push(`class dark=${st.dark}`);
	if (st.shownDark !== dark) problems.push(`shown ${st.shownDark ? "dark" : "light"}`);
	if (standalone && st.dt !== (dark ? "dark" : "light")) problems.push(`data-theme=${st.dt}`);
	if (standalone && st.bar !== null && st.bar !== (dark ? "dark" : "light")) problems.push(`navbar bar=${st.bar}`);
	if (!standalone && st.dt !== "github-dark") problems.push(`main data-theme=${st.dt}`);
	checks++;
	if (problems.length) failures.push(`${label} [${st.path}]: ${problems.join(", ")}`);
}

for (const os of ["light", "dark"]) {
	for (const seed of SEEDS) {
		const tag = `os=${os} seed=${seed ?? "unset"}`;
		const ctx = await browser.newContext({ colorScheme: os, viewport: { width: 1280, height: 800 } });
		const page = await ctx.newPage();
		let osNow = os;
		let stored = seed;
		await page.goto(base + "/archive/");
		if (seed !== null) await page.evaluate((v) => localStorage.setItem("theme", v), seed);

		await page.goto(base + "/");
		await page.waitForSelector("#scheme-switch");
		await check(`${tag} first load`, page, stored, osNow === "dark");
		await page.reload();
		await page.waitForSelector("#scheme-switch");
		await check(`${tag} reload`, page, stored, osNow === "dark");

		for (const target of [...MAIN, "/"]) {
			await page.locator(`a[href="${target}"]`).first().click();
			await page.waitForURL(base + target);
			await page.waitForTimeout(700);
			await check(`${tag} swup -> ${target}`, page, stored, osNow === "dark");
		}
		for (const target of STANDALONE) {
			await page.goto(base + target);
			await page.waitForSelector("[data-site-navbar]");
			await check(`${tag} full -> ${target}`, page, stored, osNow === "dark");
		}
		await page.locator("[data-site-navbar] a", { hasText: "Home" }).first().click();
		await page.waitForURL(base + "/");
		await page.waitForSelector("#scheme-switch");
		await check(`${tag} standalone Home ->`, page, stored, osNow === "dark");
		await page.goBack();
		await page.waitForTimeout(500);
		await check(`${tag} Back`, page, stored, osNow === "dark");
		await page.goForward();
		await page.waitForTimeout(500);
		await check(`${tag} Forward`, page, stored, osNow === "dark");

		// Main toggle flips what is shown and never lands on auto.
		await page.goto(base + "/");
		await page.waitForSelector("#scheme-switch");
		const shownDark = (await readState(page)).shownDark;
		await page.locator("#scheme-switch").click();
		stored = shownDark ? "light" : "dark";
		await page.waitForTimeout(300);
		await check(`${tag} main toggle`, page, stored, osNow === "dark");

		// Standalone toggle does the same on a report.
		await page.goto(base + STANDALONE[0]);
		await page.waitForSelector("[data-site-navbar]");
		const shownStandalone = (await readState(page)).shownDark;
		await page.locator("[data-site-navbar] .theme").click();
		stored = shownStandalone ? "light" : "dark";
		await page.waitForTimeout(300);
		await check(`${tag} standalone toggle`, page, stored, osNow === "dark");

		// Idle: nothing changes on its own.
		await page.waitForTimeout(5000);
		await check(`${tag} after 5s idle`, page, stored, osNow === "dark");

		// Live OS change: only auto follows it.
		osNow = osNow === "dark" ? "light" : "dark";
		await page.emulateMedia({ colorScheme: osNow });
		await page.waitForTimeout(300);
		await check(`${tag} OS flipped to ${osNow}`, page, stored, osNow === "dark");
		await page.goto(base + STANDALONE[1]);
		await page.waitForSelector("[data-site-navbar]");
		await check(`${tag} OS flipped, standalone`, page, stored, osNow === "dark");
		osNow = osNow === "dark" ? "light" : "dark";
		await page.emulateMedia({ colorScheme: osNow });
		await page.waitForTimeout(300);
		await check(`${tag} OS flipped back`, page, stored, osNow === "dark");

		// Second tab: a standalone report follows a change made on the main site.
		const other = await ctx.newPage();
		await other.goto(base + STANDALONE[2]);
		await other.waitForSelector("[data-site-navbar]");
		await page.goto(base + "/");
		await page.waitForSelector("#scheme-switch");
		const nowDark = (await readState(page)).shownDark;
		await page.locator("#scheme-switch").click();
		stored = nowDark ? "light" : "dark";
		await page.waitForTimeout(400);
		await check(`${tag} tab B toggled`, page, stored, osNow === "dark");
		await check(`${tag} tab A follows`, other, stored, osNow === "dark");
		await ctx.close();
	}
}

await browser.close();
server.close();
if (failures.length) {
	console.error(`check-theme: ${failures.length} of ${checks} checks failed`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`check-theme: ${checks} checks passed (2 OS schemes x ${SEEDS.length} stored values, incl. navigations, toggles, idle, OS change, second tab)`);
