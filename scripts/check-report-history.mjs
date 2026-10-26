// History model for tabbed pages (any built page with .rd-tabpanel). The tab, the hypothesis filter and its paging are the
// query string (?tab=, &filter=, &shown=) and are real links, so the browser navigates and keeps its own history. A
// section is the hash; a section jump inside the current tab pushes one entry. Back, Forward, reload and bfcache restore
// the tab, filter, section and scroll; they never add an entry. Legacy hash-only tab URLs map to ?tab= on load. Run after a build:
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
		return { len: history.length, search: location.search, hash: location.hash, active, shownOk, y: Math.round(window.scrollY) };
	});

// Smooth scrolling (html has scroll-behavior: smooth): wait until the position stops moving.
// Smooth scrolling (html has scroll-behavior: smooth): wait until the position is unchanged over several reads in a row
// (one unchanged read can be a frame gap under load, not the end of the scroll).
async function settle(page) {
	let last = -1;
	let still = 0;
	for (let i = 0; i < 80 && still < 3; i++) {
		const y = await page.evaluate(() => window.scrollY);
		still = y === last ? still + 1 : 0;
		last = y;
		await page.waitForTimeout(60);
	}
}

// The page sets data-history-ready on <html> once its restore has run (load, then fonts). Every tabbed page must set it,
// so a page without the marker fails the check instead of being read too early.
async function ready(page) {
	await page.waitForFunction(() => document.documentElement.hasAttribute("data-history-ready"), null, { timeout: 15000 });
}

// A link that navigates (tab, filter, paging) or a same-document jump: wait for the navigation, then for the page.
async function act(page, action) {
	await action();
	await page.waitForLoadState("load");
	await ready(page);
	await settle(page);
}

// marker: wait for the restore marker (not for the probe, which decides whether a page is tabbed at all).
async function open(url, marker = true) {
	const ctx = await browser.newContext({ viewport: VIEWPORT });
	const page = await ctx.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(base + url, { waitUntil: "load" });
	if (marker) await ready(page);
	await settle(page);
	return { ctx, page, errors };
}

const relPath = (rel) => `/${rel.replace(/index\.html$/, "")}`;

// One page: every test below. A crash (a locator that never shows up) is a failed check, not an abort.
async function testPage(rel) {
	const url = relPath(rel);
	const label = (s) => `${url} ${s}`;

	// Discover tabs, one deep-link target per panel, and one "On this page" link per panel.
	const probe = await open(url, false);
	// Text that only quotes the markup (a guide's code sample) is not a tabbed page: a real panel element is required.
	if (!(await probe.page.evaluate(() => document.querySelector(".rd-tabpanel") !== null))) {
		await probe.ctx.close();
		return;
	}
	tested.push(url);
	await ready(probe.page);
	const meta = await probe.page.evaluate(() => {
		const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')];
		return tabs.map((t) => {
			const panel = document.getElementById(t.getAttribute("aria-controls"));
			// A deep-link target must render and take focus: skip headings, the panel itself, and SVG <defs> content (markers,
			// gradients) which is reference-only and has no box.
			const target = panel ? [...panel.querySelectorAll("[id]")].find((e) => !/^H[1-6]$/.test(e.tagName) && e.id !== panel.id && !e.closest("defs")) : null;
			const toc = panel
				? [...panel.querySelectorAll('.rd-toc a[href^="#"]')]
						.map((a) => document.getElementById(a.getAttribute("href").slice(1)))
						.find((e) => e && panel.contains(e) && e !== target)
				: null;
			return { id: t.getAttribute("aria-controls"), href: t.getAttribute("href"), target: target?.id ?? null, toc: toc?.id ?? null };
		});
	});
	const hasTablist = await probe.page.evaluate(() => document.querySelectorAll('[role="tablist"] [role="tab"]').length > 0);
	check(label("has a tablist with tabs"), hasTablist);
	check(label("tabs are real links to ?tab="), meta.every((m) => m.href === `?tab=${m.id}`), meta.map((m) => m.href).join(" "));
	check(label("load without a query: first tab shown, no entry added"), (await snap(probe.page)).active === 0);
	check(label("page script errors on load"), probe.errors.length === 0, probe.errors.join(" | "));
	await probe.ctx.close();
	if (!hasTablist) return;

	// 1. Tab links: one entry each (a real navigation); Back and Forward walk the tabs.
	{
		const { ctx, page, errors } = await open(url);
		for (let i = 1; i < meta.length; i++) {
			const before = await snap(page);
			await act(page, () => page.click(`[role="tab"][aria-controls="${meta[i].id}"]`));
			const after = await snap(page);
			check(label(`tab ${meta[i].id} click: +1 entry`), after.len === before.len + 1, `${before.len}->${after.len}`);
			check(label(`tab ${meta[i].id} click: ?tab and tab`), after.search === `?tab=${meta[i].id}` && after.active === i && after.shownOk, `${after.search} ${after.active}`);
		}
		const last = meta.length - 1;
		await act(page, () => page.goBack());
		const b1 = await snap(page);
		check(label("Back from last tab: previous tab"), b1.active === last - 1 && b1.shownOk, `active ${b1.active}`);
		await act(page, () => page.goForward());
		const f1 = await snap(page);
		check(label("Forward: last tab again"), f1.active === last && f1.search === `?tab=${meta[last].id}`, `active ${f1.active}`);
		// Following the tab that is already shown adds nothing.
		const same = await snap(page);
		await act(page, () => page.click(`[role="tab"][aria-controls="${meta[last].id}"]`));
		check(label("click the shown tab: no entry"), (await snap(page)).len === same.len);
		check(label("page script errors on tab clicks"), errors.length === 0, errors.join(" | "));
		await ctx.close();
	}

	// 2. Keyboard on the tab list: arrows and Home/End move focus only; Space follows the focused tab (one entry).
	{
		const { ctx, page } = await open(url);
		await page.focus(`[role="tab"][aria-controls="${meta[0].id}"]`);
		const s0 = await snap(page);
		await page.keyboard.press("ArrowRight");
		const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-controls"));
		check(label("ArrowRight: focus on the next tab, no entry"), focused === meta[1 % meta.length].id && (await snap(page)).len === s0.len, `focus ${focused}`);
		await page.keyboard.press("End");
		check(label("End: focus on the last tab"), (await page.evaluate(() => document.activeElement?.getAttribute("aria-controls"))) === meta[meta.length - 1].id);
		await page.keyboard.press("Home");
		await page.focus(`[role="tab"][aria-controls="${meta[1].id}"]`);
		await page.keyboard.press(" ");
		await page.waitForURL((u) => u.search === `?tab=${meta[1].id}`);
		await act(page, async () => {});
		const s4 = await snap(page);
		check(label("Space on a focused tab: +1 entry, that tab"), s4.len === s0.len + 1 && s4.active === 1, `active ${s4.active}`);
		await ctx.close();
	}

	// 3. Deep links: a section opens its tab (the URL gains ?tab=, no entry), scrolls below the bar and takes focus.
	for (let i = 0; i < meta.length; i++) {
		if (!meta[i].target) continue;
		const { ctx, page, errors } = await open(`${url}#${meta[i].target}`);
		const s = await snap(page);
		check(label(`deep link #${meta[i].target}: its tab shown`), s.active === i && s.shownOk, `active ${s.active}`);
		check(label(`deep link #${meta[i].target}: ?tab added, no entry added`), s.len === 2 && s.search === `?tab=${meta[i].id}` && s.hash === `#${meta[i].target}`, `len ${s.len} ${s.search}`);
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
	// A legacy hash-only tab URL (#tab-id) maps to ?tab= with no entry and no hash.
	{
		const legacy = await open(`${url}#${meta[meta.length - 1].id}`);
		const s = await snap(legacy.page);
		check(label("legacy #tab-id: ?tab, no hash, no entry"), s.len === 2 && s.search === `?tab=${meta[meta.length - 1].id}` && s.hash === "" && s.active === meta.length - 1, `${s.search} ${s.hash}`);
		await legacy.ctx.close();
	}

	// 4. "On this page" links (the right rail): one pushState entry per jump; Back restores the tab, the section and the
	// scroll; Forward goes back to the target; reload keeps all of it.
	for (let i = 0; i < meta.length; i++) {
		if (!meta[i].toc) continue;
		const { ctx, page } = await open(`${url}?tab=${meta[i].id}`);
		// Start from a scrolled position (so Back has a non-zero y to restore) where the link is clear of the sticky chrome
		// (navbar, breadcrumb band, section bar and any page bar under them): a covered link would make the click scroll the
		// page first, and the test would then compare against the wrong start. 150px when that is clear, else just above it.
		const startY = await page.evaluate((sel) => {
			const link = document.querySelector(sel);
			if (!link) return 150;
			const chrome = Math.max(0, ...[...document.querySelectorAll("body *, [data-site-navbar]")]
				.filter((el) => !el.closest(".rd-tabpanel") && getComputedStyle(el).position === "sticky" && el.getClientRects().length)
				.map((el) => parseFloat(getComputedStyle(el).top) + el.getBoundingClientRect().height)
				.filter((b) => Number.isFinite(b) && b < window.innerHeight / 2));
			const clear = Math.floor(link.getBoundingClientRect().top + window.scrollY - chrome - 24);
			return Math.max(1, Math.min(150, clear));
		}, `#${meta[i].id} .rd-toc a[href="#${meta[i].toc}"]`);
		await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), startY);
		await settle(page);
		const s0 = await snap(page);
		await act(page, () => page.click(`#${meta[i].id} .rd-toc a[href="#${meta[i].toc}"]`));
		const s1 = await snap(page);
		check(label(`TOC #${meta[i].toc}: +1 entry, hash, same tab`), s1.len === s0.len + 1 && s1.hash === `#${meta[i].toc}` && s1.active === i && s1.search === s0.search, `${s0.len}->${s1.len}`);
		await act(page, () => page.goBack());
		const b = await snap(page);
		check(label(`TOC #${meta[i].toc}: Back restores hash, tab and scroll`), b.hash === s0.hash && b.active === i && Math.abs(b.y - s0.y) <= 3, `y ${b.y} vs ${s0.y}`);
		await act(page, () => page.goForward());
		const f = await snap(page);
		check(label(`TOC #${meta[i].toc}: Forward restores the target`), f.hash === `#${meta[i].toc}` && f.active === i && Math.abs(f.y - s1.y) <= 3, `y ${f.y} vs ${s1.y}`);
		await act(page, () => page.click(`#${meta[i].id} .rd-toc a[href="#${meta[i].toc}"]`));
		check(label(`TOC #${meta[i].toc} again while there: no entry`), (await snap(page)).len === f.len);
		await act(page, () => page.reload());
		const r = await snap(page);
		check(label(`TOC #${meta[i].toc}: reload keeps tab and scroll`), r.hash === f.hash && r.search === f.search && r.active === i && Math.abs(r.y - f.y) <= 3, `y ${r.y} vs ${f.y}`);
		await ctx.close();
	}

	// 5. Filter and paging links on the hypotheses tab: a real navigation each (one entry), Back and Forward restore them.
	for (let i = 0; i < meta.length; i++) {
		const { ctx, page } = await open(`${url}?tab=${meta[i].id}`);
		const filterLink = page.locator('.rd-tabpanel:not([hidden]) #ledger-filters a[data-filter]:not([aria-current="true"])').first();
		if (!(await filterLink.count())) {
			await ctx.close();
			continue;
		}
		const value = await filterLink.getAttribute("data-filter");
		const s0 = await snap(page);
		await act(page, () => filterLink.click());
		const s1 = await snap(page);
		check(label(`filter ${value}: +1 entry, ?filter`), s1.len === s0.len + 1 && s1.search.includes(`filter=${value}`) && s1.active === i, `len ${s0.len}->${s1.len}`);
		check(label(`filter ${value}: the link is the current one`), (await page.locator(`#ledger-filters a[data-filter="${value}"][aria-current="true"]`).count()) === 1);
		await act(page, () => page.goBack());
		check(label(`filter ${value}: Back restores the previous filter`), (await snap(page)).search === s0.search && (await page.locator('.rd-tabpanel:not([hidden]) #ledger-filters a[aria-current="true"]').getAttribute("data-filter")) === "all");
		await act(page, () => page.goForward());
		check(label(`filter ${value}: Forward restores it`), (await snap(page)).search.includes(`filter=${value}`));
		await ctx.close();
	}
	for (let i = 0; i < meta.length; i++) {
		const { ctx, page } = await open(`${url}?tab=${meta[i].id}`);
		const more = page.locator(".rd-tabpanel:not([hidden]) #ledger-more:not([hidden])");
		if (!(await more.count())) {
			await ctx.close();
			continue;
		}
		const count0 = await page.locator("#ledger-count").textContent();
		const s0 = await snap(page);
		await act(page, () => more.click());
		const s1 = await snap(page);
		check(label("Show more: +1 entry, ?shown"), s1.len === s0.len + 1 && s1.search.includes("shown="), `${s0.len}->${s1.len}`);
		await act(page, () => page.goBack());
		check(label("Show more: Back restores the count"), (await page.locator("#ledger-count").textContent()) === count0);
		await ctx.close();
	}

	// 6. bfcache restore (pageshow persisted) re-syncs without an entry; an unknown tab or hash falls back to tab 0.
	{
		const { ctx, page, errors } = await open(url);
		await act(page, () => page.click(`[role="tab"][aria-controls="${meta[meta.length - 1].id}"]`));
		const s0 = await snap(page);
		await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
		await settle(page);
		const s1 = await snap(page);
		check(label("pageshow persisted: no entry, tab and query agree"), s1.len === s0.len && s1.active === s0.active && s1.shownOk && s1.search === s0.search);
		await ctx.close();
		const bad = await open(`${url}?tab=no-such-tab#no-such-id`);
		check(label("unknown tab and hash: first tab, no error"), (await snap(bad.page)).active === 0 && bad.errors.length === 0, bad.errors.join(" | "));
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
