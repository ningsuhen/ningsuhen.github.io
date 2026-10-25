// Long navigation sequences over the built site (run after `pnpm build`): `pnpm check:navigation`.
// Clicks navbar links, Back/Forward, reloads, scrolls and hash jumps across site pages and standalone reports.
// After every step: exactly one navbar (site navbar on site pages, injected navbar on standalone pages), exactly one
// license footer on standalone pages, the layout equals a fresh load of the same URL at the same scroll, and no
// console or page errors. Fixed seeds, so a failure replays exactly. A final burst pass fires the actions back to back.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";

const DIST = path.resolve("dist");
const VIEWPORTS = [
	{ width: 1440, height: 900 },
	{ width: 375, height: 800 },
];
const SITE = ["/", "/archive/", "/about/", "/research/", "/experiments/", "/posts/ai-boom-trajectories/"];
// Standalone pages that a list page links to: public/<section>/<slug>/index.html with a Live (or Coming soon-free) entry.
// Found from the data files, so a new report is covered without editing this script.
const STANDALONE = ["research", "experiments"].flatMap((section) => {
	const entries = JSON.parse(readFileSync(path.resolve("src/data", `${section}.json`), "utf8")).items;
	return entries
		.filter((e) => !["draft", "coming soon"].includes(e.status.toLowerCase()))
		.map((e) => e.href)
		.filter((href) => existsSync(path.resolve("public", href.replace(/^\/|\/$/g, ""), "index.html")));
});
const LIST_OF = (page) => (page.startsWith("/research/") ? "/research/" : "/experiments/");
const NAV = ["/", "/archive/", "/about/", "/research/", "/experiments/"];
const STEPS = 14;
const IGNORE = /giscus|Failed to load resource|pagefind\.js/; // third-party embeds and the Pagefind search import (aborted on leave)
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".xml": "application/xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

const server = createServer((req, res) => {
	let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
	if (p.endsWith("/")) p += "index.html";
	const file = path.join(DIST, path.normalize(p));
	if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
		res.statusCode = 404;
		return res.end("not found");
	}
	res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });

// Theme and hue are fixed so a fresh load and a navigated page are comparable.
const INIT = () => {
	localStorage.setItem("theme", "light");
	localStorage.setItem("hue", "250");
};

const FINGERPRINT = () => {
	const q = (s) => document.querySelector(s);
	const box = (e, doc = true) => {
		if (!e) return null;
		const b = e.getBoundingClientRect();
		return [b.left, b.top + (doc ? scrollY : 0), b.width, b.height].map(Math.round);
	};
	const wrap = q("#navbar-wrapper");
	return {
		path: location.pathname,
		title: document.title,
		h1: q("h1")?.textContent.trim() ?? null,
		navHosts: document.querySelectorAll("div[data-site-navbar]").length,
		navWrapper: document.querySelectorAll("#navbar-wrapper").length,
		licHosts: document.querySelectorAll("div[data-site-license]").length,
		navRect: box(q("div[data-site-navbar]") ?? wrap, false),
		navHidden: !!wrap?.classList.contains("navbar-hidden"),
		navOpacity: wrap ? getComputedStyle(wrap).opacity : null,
		scrollY: Math.round(scrollY),
		licRect: box(q("div[data-site-license]")),
		// The visible footer (mobile or desktop): on site pages it must carry the same license block as a fresh load.
		footer: (() => {
			const f = [...document.querySelectorAll("div.footer")].find((d) => getComputedStyle(d).display !== "none");
			return f ? f.innerText.replace(/\s+/g, " ").trim().slice(0, 60) + " | aside=" + !!f.querySelector("aside") : null;
		})(),
		mainRect: box(q("#main-grid") ?? q("main")),
		h1Rect: box(q("h1")),
		articles: document.querySelectorAll("article").length,
		dataTheme: document.documentElement.getAttribute("data-theme"),
		dark: document.documentElement.classList.contains("dark"),
		hue: document.documentElement.style.getPropertyValue("--hue"),
		bodyCls: [...document.body.classList].filter((c) => !/^is-/.test(c)).sort().join(" "),
		overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
	};
};

// Standalone reports size themselves from scroll position (scroll spy, IntersectionObserver), so their document
// geometry is not comparable across a fresh load; their navbar, license text and counts still are.
const REPORT_GEOMETRY = ["mainRect", "h1Rect", "licRect", "scrollY"];
const diff = (a, b, ignore = []) =>
	Object.keys({ ...a, ...b })
		.filter((k) => !ignore.includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
		.map((k) => `${k}: ${JSON.stringify(a[k])} (sequence) != ${JSON.stringify(b[k])} (fresh)`);

// Clicks the navbar link (the mobile menu is opened first). Content links are the fallback, for cards on a list page.
async function clickLink(page, href) {
	const sel = (sfx) => `#navbar a[href="${href}"]${sfx}, [data-site-navbar] nav a[href="${href}"]${sfx}`;
	// A closed menu panel only fades out, so it still matches :visible: open it by its state.
	if ((await page.locator("#nav-menu-panel.float-panel-closed").count()) && (await page.locator("#nav-menu-switch").isVisible())) {
		await page.click("#nav-menu-switch");
		await page.waitForTimeout(400);
	}
	let target = page.locator(sel(":visible")).first();
	if (!(await target.count())) target = page.locator(`#swup-container a[href="${href}"]:visible, main a[href="${href}"]:visible`).first();
	if (!(await target.count())) return false; // not on this page
	await target.waitFor({ state: "visible", timeout: 3000 });
	await page.waitForTimeout(250);
	await target.click({ timeout: 5000 });
	return true;
}

// Owner report: Experiments and Research from other pages, Back/Forward chains, a standalone report, reloads, hash jumps.
const RESEARCH = STANDALONE.filter((p) => p.startsWith("/research/"));
const [FIRST_REPORT, LAST_REPORT] = [RESEARCH[0], RESEARCH[RESEARCH.length - 1]]; // both on /research/, reached from its list
const SCRIPT = [
	["goto", "/"], ["click", "/research/"], ["scroll", 900], ["click", FIRST_REPORT], ["scroll", 1200],
	["back"], ["forward"], ["back"], ["click", "/archive/"], ["click", "/about/"], ["click", "/research/"],
	["click", FIRST_REPORT], ["scroll", 1500], ["click", "/experiments/"], ["back"], ["back"], ["back"],
	["reload"], ["scroll", 800], ["hash"], ["click", "/research/"], ["click", LAST_REPORT], ["back"], ["reload"],
];
// Visit every standalone page from its list page, then Back, so none is only reached by a random goto.
const TOUR = STANDALONE.flatMap((page) => [["click", LIST_OF(page)], ["click", page], ["back"]]);

function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
function randomSeq(seed, n) {
	const r = rng(seed);
	const pick = (xs) => xs[Math.floor(r() * xs.length)];
	const first = pick(SITE);
	// Two different URLs first: a same-URL goto makes no history entry, and Back must not reach about:blank.
	const out = [["goto", first], ["goto", pick(SITE.filter((u) => u !== first))]];
	while (out.length < n) {
		const x = r();
		if (x < 0.25) out.push(["scroll", Math.floor(r() * 2500)]);
		else if (x < 0.4) out.push(["click", pick(NAV)]);
		else if (x < 0.5) out.push(["click", pick(STANDALONE)]);
		else if (x < 0.65) out.push(["back"]);
		else if (x < 0.72) out.push(["forward"]);
		else if (x < 0.8) out.push(["reload"]);
		else if (x < 0.9) out.push(["hash"]);
		else out.push(["goto", pick([...SITE, ...STANDALONE])]);
	}
	return out;
}

const failures = [];
let checks = 0;

// One sequence. burst=true fires the actions back to back and checks only the final state.
async function runSequence(label, plan, vp, burst, strict) {
	const ctx = await browser.newContext({ viewport: vp });
	await ctx.addInitScript(INIT);
	const page = await ctx.newPage();
	page.setDefaultTimeout(10000);
	let errs = [];
	page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
	page.on("console", (m) => {
		if (m.type() === "error" && !IGNORE.test(m.text())) errs.push(`console.error: ${m.text()}`);
	});
	page.on("requestfailed", (r) => {
		if (!IGNORE.test(r.url()) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) errs.push(`requestfailed: ${r.url()}`);
	});
	page.on("response", (r) => {
		if (r.status() >= 400 && !IGNORE.test(r.url())) errs.push(`http ${r.status()}: ${r.url()}`);
	});
	let depth = 0; // approximate entries above the blank start-of-tab entry
	let lastBack = false;
	const done = [];
	for (let i = 0; i < plan.length; i++) {
		const [act, arg] = plan[i];
		if (!burst) errs = [];
		let desc = `${act}${arg !== undefined ? " " + arg : ""}`;
		if (act !== "back" && act !== "forward") lastBack = false;
		try {
			if (act === "goto") {
				await page.goto(base + arg, { waitUntil: "load" });
				depth++;
			} else if (act === "click") {
				if (await clickLink(page, arg)) depth++;
				else if (strict) errs.push(`link to ${arg} not found on the page (scripted step)`);
				else desc += " (not on this page, skipped)";
			} else if (act === "back") {
				if (depth <= 1) desc += " (start of history, skipped)";
				else {
					await page.goBack({ waitUntil: "load" }).catch(() => {});
					depth--;
					lastBack = true;
				}
			} else if (act === "forward") {
				if (!lastBack) desc += " (no back before, skipped)";
				else {
					await page.goForward({ waitUntil: "load" }).catch(() => {});
					depth++;
					lastBack = false;
				}
			} else if (act === "reload") await page.reload({ waitUntil: "load" });
			else if (act === "scroll") await page.evaluate((y) => window.scrollTo(0, y), arg);
			else if (act === "hash") {
				const id = await page.evaluate(() => [...document.querySelectorAll("main [id], section[id], h2[id], h3[id]")].map((e) => e.id).find(Boolean) ?? null);
				if (id) await page.evaluate((h) => {
					location.hash = h;
				}, id);
			}
		} catch (e) {
			errs.push(`action failed: ${e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 1500)}`);
		}
		await page.waitForLoadState("load").catch(() => {});
		const last = i === plan.length - 1;
		if (burst && !last) {
			await page.waitForTimeout(40 + Math.floor(Math.random() * 200));
			continue;
		}
		await page.waitForTimeout(900);
		const seq = await page.evaluate(FINGERPRINT).catch(async () => {
			await page.waitForLoadState("load");
			return page.evaluate(FINGERPRINT);
		});
		if (!page.url().startsWith(base)) {
			failures.push(`${label} step ${i} (${desc}): page left the site, url=${page.url()}`);
			break;
		}
		const url = new URL(page.url());
		const fresh = await browser.newContext({ viewport: vp });
		await fresh.addInitScript(INIT);
		const fp = await fresh.newPage();
		await fp.goto(base + url.pathname + url.search + url.hash, { waitUntil: "load" });
		await fp.waitForTimeout(900);
		// Wait until the fresh page is tall enough to reach the same scroll, or the scroll is clamped and the navbar state differs.
		await fp.waitForFunction((y) => document.documentElement.scrollHeight >= y + innerHeight, seq.scrollY, { timeout: 5000 }).catch(() => {});
		await fp.evaluate((y) => window.scrollTo(0, y), seq.scrollY);
		await fp.waitForTimeout(500);
		const freshFp = await fp.evaluate(FINGERPRINT);
		await fresh.close();
		checks++;

		const problems = [];
		const standalone = !SITE.includes(url.pathname) && !url.pathname.startsWith("/archive/") && !url.pathname.startsWith("/posts/");
		if (standalone) {
			if (seq.navHosts !== 1) problems.push(`injected navbar hosts=${seq.navHosts} (want 1)`);
			if (seq.licHosts !== 1) problems.push(`license footers=${seq.licHosts} (want 1)`);
		} else {
			if (seq.navHosts !== 0) problems.push(`injected navbar on a site page (${seq.navHosts})`);
			if (seq.navWrapper !== 1) problems.push(`site navbar count=${seq.navWrapper} (want 1)`);
		}
		problems.push(...diff(seq, freshFp, standalone ? REPORT_GEOMETRY : []).map((d) => `layout ${d}`));
		problems.push(...errs);
		done.push(`${i} ${desc} -> ${url.pathname}${url.hash}`);
		if (process.env.VERBOSE) console.log(`    ${label} ${i} ${desc} -> ${url.pathname}${url.hash} scrollY=${seq.scrollY} navHidden=${seq.navHidden} navOpacity=${seq.navOpacity} fresh.navHidden=${freshFp.navHidden} fresh.navOpacity=${freshFp.navOpacity}`);
		if (problems.length) {
			failures.push(`${label} step ${i} (${desc}) -> ${url.pathname}${url.hash}:\n      ${problems.join("\n      ")}`);
			break; // later steps build on a broken state
		}
	}
	await ctx.close();
	return done.length;
}

const plans = [];
for (const vp of VIEWPORTS) {
	plans.push({ label: `scripted @${vp.width}`, plan: SCRIPT, vp, burst: false, strict: true });
	plans.push({ label: `tour @${vp.width}`, plan: [["goto", "/"], ...TOUR], vp, burst: false, strict: true });
	for (const seed of [1, 2]) plans.push({ label: `seed ${seed} @${vp.width}`, plan: randomSeq(seed * 7919 + vp.width, STEPS), vp, burst: false, strict: false });
	plans.push({ label: `burst seed 3 @${vp.width}`, plan: randomSeq(3 * 7919 + vp.width, STEPS), vp, burst: true, strict: false });
}
for (const p of plans) {
	if (process.env.ONLY && !p.label.includes(process.env.ONLY)) continue;
	const n = await runSequence(p.label, p.plan, p.vp, p.burst, p.strict);
	console.log(`${p.label}: ${n}/${p.plan.length} steps`);
}
await browser.close();
server.close();

if (failures.length) {
	console.error(`navigation check FAILED (${failures.length}):\n - ${failures.join("\n - ")}`);
	process.exit(1);
}
console.log(`navigation check passed: ${checks} checks across ${plans.length} sequences`);
