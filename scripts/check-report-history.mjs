// History model for tabbed pages (any built page with .rd-tabpanel): every user navigation is one history entry,
// Back/Forward/reload restore the tab, section, filter and scroll, and deep links open their tab. Run after a build:
//   pnpm check:report-history            (every dist page with .rd-tabpanel)
//   node scripts/check-report-history.mjs <dist-dir>
// Browser: set CHROME_PATH, or `pnpm exec playwright-core install chromium` (CI does this).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const DIST = path.resolve(process.argv[2] ?? "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2" };
const VIEWPORT = { width: 1440, height: 900 };

function tabbedPages(dir = DIST, rel = "") {
	return readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
		const r = path.join(rel, e.name);
		if (e.isDirectory()) return tabbedPages(dir, r);
		return e.name === "index.html" && /class="[^"]*\brd-tabpanel\b/.test(readFileSync(path.join(dir, r), "utf8")) ? [r] : [];
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
const tested = [];
let checks = 0;
function check(label, ok, detail = "") {
	checks += 1;
	if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
}

const snap = (page) =>
	page.evaluate(() => {
		const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')];
		const active = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
		const shownOk = tabs.every((t, i) => {
			const p = document.getElementById(t.getAttribute("aria-controls"));
			return p && p.hidden === (i !== active);
		});
		return { len: history.length, hash: location.hash, active, shownOk, y: Math.round(window.scrollY) };
	});

// Smooth scrolling (html has scroll-behavior: smooth): wait until the position stops moving.
async function settle(page) {
	let last = -1;
	for (let i = 0; i < 50; i++) {
		const y = await page.evaluate(() => window.scrollY);
		if (y === last) return;
		last = y;
		await page.waitForTimeout(60);
	}
}

async function open(url) {
	const ctx = await browser.newContext({ viewport: VIEWPORT });
	const page = await ctx.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(base + url, { waitUntil: "load" });
	await settle(page);
	return { ctx, page, errors };
}

const relPath = (rel) => `/${rel.replace(/index\.html$/, "")}`;

// One page: every test below. A crash (a locator that never shows up) is a failed check, not an abort.
async function testPage(rel) {
	const url = relPath(rel);
	const label = (s) => `${url} ${s}`;

	// Discover tabs, one deep-link target per panel, and one "On this page" link per panel.
	const probe = await open(url);
	// Text that only quotes the markup (a guide's code sample) is not a tabbed page: a real panel element is required.
	if (!(await probe.page.evaluate(() => document.querySelector(".rd-tabpanel") !== null))) {
		await probe.ctx.close();
		return;
	}
	tested.push(url);
	const meta = await probe.page.evaluate(() => {
		const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')];
		return tabs.map((t) => {
			const panel = document.getElementById(t.getAttribute("aria-controls"));
			const target = panel ? [...panel.querySelectorAll("[id]")].find((e) => !/^H[1-6]$/.test(e.tagName) && e.id !== panel.id) : null;
			const toc = panel
				? [...panel.querySelectorAll('.rd-toc a[href^="#"]')]
						.map((a) => document.getElementById(a.getAttribute("href").slice(1)))
						.find((e) => e && panel.contains(e) && e !== target)
				: null;
			return { id: t.getAttribute("aria-controls"), target: target?.id ?? null, toc: toc?.id ?? null };
		});
	});
	const hasTablist = await probe.page.evaluate(() => document.querySelectorAll('[role="tablist"] [role="tab"]').length > 0);
	check(label("has a tablist with tabs"), hasTablist);
	check(label("load without hash: first tab shown, no entry added"), (await snap(probe.page)).active === 0);
	check(label("page script errors on load"), probe.errors.length === 0, probe.errors.join(" | "));
	await probe.ctx.close();
	if (!hasTablist) return;

	// 1. Tab clicks: one entry each; Back and Forward walk the tabs.
	{
		const { ctx, page, errors } = await open(url);
		for (let i = 1; i < meta.length; i++) {
			const before = await snap(page);
			await page.click(`[role="tab"][aria-controls="${meta[i].id}"]`);
			await settle(page);
			const after = await snap(page);
			check(label(`tab ${meta[i].id} click: +1 entry`), after.len === before.len + 1, `${before.len}->${after.len}`);
			check(label(`tab ${meta[i].id} click: hash and tab`), after.hash === `#${meta[i].id}` && after.active === i && after.shownOk, `${after.hash} ${after.active}`);
		}
		const last = meta.length - 1;
		await page.goBack();
		await settle(page);
		const b1 = await snap(page);
		check(label("Back from last tab: previous tab"), b1.active === last - 1 && b1.shownOk, `active ${b1.active}`);
		await page.goForward();
		await settle(page);
		const f1 = await snap(page);
		check(label("Forward: last tab again"), f1.active === last && f1.hash === `#${meta[last].id}`, `active ${f1.active}`);
		// Clicking the tab that is already shown adds nothing.
		const same = await snap(page);
		await page.click(`[role="tab"][aria-controls="${meta[last].id}"]`);
		await settle(page);
		check(label("click the shown tab: no entry"), (await snap(page)).len === same.len);
		check(label("page script errors on tab clicks"), errors.length === 0, errors.join(" | "));
		await ctx.close();
	}

	// 2. Keyboard on the tab list: arrows, Home, End and Space behave like a click.
	{
		const { ctx, page } = await open(url);
		await page.focus(`[role="tab"][aria-controls="${meta[0].id}"]`);
		const s0 = await snap(page);
		await page.keyboard.press("ArrowRight");
		await settle(page);
		const s1 = await snap(page);
		check(label("ArrowRight: +1 entry, next tab"), s1.len === s0.len + 1 && s1.active === 1 && s1.hash === `#${meta[1].id}`, `active ${s1.active}`);
		await page.keyboard.press("End");
		await settle(page);
		const s2 = await snap(page);
		check(label("End: +1 entry, last tab"), s2.len === s1.len + 1 && s2.active === meta.length - 1);
		await page.keyboard.press("Home");
		await settle(page);
		const s3 = await snap(page);
		check(label("Home: +1 entry, first tab"), s3.len === s2.len + 1 && s3.active === 0);
		await page.focus(`[role="tab"][aria-controls="${meta[1].id}"]`);
		await page.keyboard.press(" ");
		await settle(page);
		const s4 = await snap(page);
		check(label("Space on a focused tab: +1 entry, that tab"), s4.len === s3.len + 1 && s4.active === 1);
		await ctx.close();
	}

	// 3. Deep links: any section opens its tab, lands below the bar, takes focus, and adds no entry.
	for (let i = 0; i < meta.length; i++) {
		if (!meta[i].target) continue;
		const { ctx, page, errors } = await open(`${url}#${meta[i].target}`);
		const s = await snap(page);
		check(label(`deep link #${meta[i].target}: its tab shown`), s.active === i && s.shownOk, `active ${s.active}`);
		check(label(`deep link #${meta[i].target}: no entry added`), s.len === 2, `len ${s.len}`);
		const pos = await page.evaluate((id) => {
			const el = document.getElementById(id);
			const bar = document.querySelector('[role="tablist"]');
			const top = el.getBoundingClientRect().top;
			return { top, bar: bar.getBoundingClientRect().bottom, h: window.innerHeight, focusIn: el.contains(document.activeElement) };
		}, meta[i].target);
		check(label(`deep link #${meta[i].target}: target below the bar`), pos.top >= pos.bar - 2 && pos.top < pos.h, `top ${Math.round(pos.top)}`);
		check(label(`deep link #${meta[i].target}: focus on the target`), pos.focusIn);
		check(label(`deep link #${meta[i].target}: no page errors`), errors.length === 0, errors.join(" | "));
		await ctx.close();
	}

	// 4. "On this page" links: one entry, Back restores the tab and the scroll, Forward goes back to the target.
	for (let i = 0; i < meta.length; i++) {
		if (!meta[i].toc) continue;
		const { ctx, page } = await open(url);
		await page.click(`[role="tab"][aria-controls="${meta[i].id}"]`);
		await settle(page);
		await page.evaluate(() => window.scrollTo({ top: 150, behavior: "instant" }));
		await settle(page);
		const y0 = (await snap(page)).y;
		const s0 = await snap(page);
		await page.click(`#${meta[i].id} .rd-toc a[href="#${meta[i].toc}"]`);
		await settle(page);
		const s1 = await snap(page);
		check(label(`TOC #${meta[i].toc}: +1 entry, hash`), s1.len === s0.len + 1 && s1.hash === `#${meta[i].toc}`, `${s0.len}->${s1.len}`);
		await page.goBack();
		await settle(page);
		const b = await snap(page);
		check(label(`TOC #${meta[i].toc}: Back restores tab, hash and scroll`), b.hash === s0.hash && b.active === i && Math.abs(b.y - y0) <= 3, `y ${b.y} vs ${y0}`);
		await page.goForward();
		await settle(page);
		const f = await snap(page);
		check(label(`TOC #${meta[i].toc}: Forward restores the target`), f.hash === `#${meta[i].toc}` && f.active === i && Math.abs(f.y - s1.y) <= 3, `y ${f.y} vs ${s1.y}`);
		// Already there: the same link adds nothing.
		await page.click(`#${meta[i].id} .rd-toc a[href="#${meta[i].toc}"]`);
		await settle(page);
		check(label(`TOC #${meta[i].toc} again while there: no entry`), (await snap(page)).len === f.len);
		// Reload keeps the scroll position of the entry.
		await page.reload({ waitUntil: "load" });
		await settle(page);
		const r = await snap(page);
		check(label(`TOC #${meta[i].toc}: reload keeps tab and scroll`), r.hash === f.hash && r.active === i && Math.abs(r.y - f.y) <= 3, `y ${r.y} vs ${f.y}`);
		await ctx.close();
	}

	// 5. Controls that change the view (aria-pressed filters, "Show more"): one entry per change, Back and Forward
	// restore them. Each tab is tried, so the control is found wherever it lives.
	for (let i = 0; i < meta.length; i++) {
		const { ctx, page } = await open(url);
		await page.click(`[role="tab"][aria-controls="${meta[i].id}"]`);
		await settle(page);
		const toggle = page.locator(".rd-tabpanel:not([hidden]) button[aria-pressed]");
		const more = page.locator(".rd-tabpanel:not([hidden]) #ledger-more:not([hidden])");
		let k = -1;
		for (let j = 0; j < (await toggle.count()); j++) {
			if ((await toggle.nth(j).getAttribute("aria-pressed")) !== "true") { k = j; break; }
		}
		if (k >= 0) {
			const b = toggle.nth(k);
			const s0 = await snap(page);
			await b.click();
			await settle(page);
			const s1 = await snap(page);
			check(label(`filter on ${meta[i].id}: +1 entry, pressed`), s1.len === s0.len + 1 && (await b.getAttribute("aria-pressed")) === "true", `len ${s0.len}->${s1.len}`);
			check(label(`filter on ${meta[i].id}: scroll unchanged`), Math.abs(s1.y - s0.y) <= 3, `y ${s0.y}->${s1.y}`);
			await page.goBack();
			await settle(page);
			check(label(`filter on ${meta[i].id}: Back restores the previous state`), (await b.getAttribute("aria-pressed")) === "false" && (await snap(page)).active === i);
			await page.goForward();
			await settle(page);
			check(label(`filter on ${meta[i].id}: Forward restores it`), (await b.getAttribute("aria-pressed")) === "true");
		}
		if (await more.count()) {
			const count0 = await page.locator("#ledger-count").textContent();
			const s0 = await snap(page);
			await more.click();
			await settle(page);
			const s1 = await snap(page);
			check(label("Show more: +1 entry"), s1.len === s0.len + 1, `${s0.len}->${s1.len}`);
			await page.goBack();
			await settle(page);
			check(label("Show more: Back restores the count"), (await page.locator("#ledger-count").textContent()) === count0);
		}
		await ctx.close();
	}

	// 6. bfcache restore (pageshow persisted) re-syncs without writing an entry, and a bad hash falls back to tab 0.
	{
		const { ctx, page, errors } = await open(url);
		await page.click(`[role="tab"][aria-controls="${meta[meta.length - 1].id}"]`);
		await settle(page);
		const s0 = await snap(page);
		await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
		await settle(page);
		const s1 = await snap(page);
		check(label("pageshow persisted: no entry, tab and hash agree"), s1.len === s0.len && s1.active === s0.active && s1.shownOk);
		await ctx.close();
		const bad = await open(`${url}#no-such-id`);
		check(label("unknown hash: first tab, no error"), (await snap(bad.page)).active === 0 && bad.errors.length === 0, bad.errors.join(" | "));
		await bad.ctx.close();
		check(label("page script errors"), errors.length === 0, errors.join(" | "));
	}
}

for (const rel of tabbedPages()) {
	try {
		await testPage(rel);
	} catch (e) {
		check(`${relPath(rel)} test crashed`, false, String(e.message).split("\n")[0]);
	}
}

await browser.close();
server.close();
if (failures.length) {
	console.error(`report history: ${failures.length} of ${checks} checks failed`);
	for (const f of failures) console.error(`  FAIL ${f}`);
	process.exit(1);
}
console.log(`report history: ${checks} checks passed on ${tested.length} page(s)`);
