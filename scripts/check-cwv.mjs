// Core Web Vitals budget check (run after `pnpm build`): `pnpm check:cwv`.
// Measures LCP, CLS and TBT on a fixed set of pages, on mobile and desktop, under a CPU throttle, and
// fails if any metric exceeds its budget in scripts/cwv-budget.json.
//
// Determinism: a fixed CPU throttle (CDP Emulation.setCPUThrottlingRate), a fixed settle window after load,
// and the median of N runs per page — so a single slow frame or a late image does not flake the check. No
// external requests: every request that is not to the local server is aborted, so the numbers depend only on
// the built site. Metrics are read from the buffered Performance API (largest-contentful-paint, layout-shift,
// longtask), which needs no observers and no interaction.
//
// `--measure` prints the values without enforcing the budget (for setting or reviewing baselines).
// Browser: CHROME_PATH, or the playwright-core chromium. CWV_DIST overrides the build dir.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const DIST = path.resolve(process.env.CWV_DIST ?? "dist");
const BUDGET = JSON.parse(readFileSync(path.resolve("scripts/cwv-budget.json"), "utf8"));
const MEASURE = process.argv.includes("--measure");
const RUNS = BUDGET.runs;
const THROTTLE = BUDGET.cpuThrottle;
const SETTLE_MS = BUDGET.settleMs;
const VIEWS = {
	mobile: { width: 375, height: 800 },
	desktop: { width: 1440, height: 900 },
};

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

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".xml": "application/xml", ".ico": "image/x-icon", ".wasm": "application/wasm" };
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
const browser = await chromium.launch({ executablePath: findChrome() });

// The CWV entries are not all in the default Performance buffer: LCP is only delivered to a
// PerformanceObserver registered with `buffered: true`, and longtask needs its buffer enabled. So an init
// script (present before first paint) observes all three and parks the running totals on window.
const CWV_INIT = () => {
	window.__cwv = { lcp: 0, cls: 0, tbt: 0 };
	try {
		performance.setLongTaskTimingBufferSize(500);
	} catch {}
	const watch = (type, fn) => {
		try {
			new PerformanceObserver((list) => fn(list.getEntries())).observe({ type, buffered: true });
		} catch {}
	};
	watch("largest-contentful-paint", (es) => {
		if (es.length) window.__cwv.lcp = es[es.length - 1].startTime;
	});
	watch("layout-shift", (es) => {
		for (const e of es) if (!e.hadRecentInput) window.__cwv.cls += e.value;
	});
	watch("longtask", (es) => {
		for (const e of es) window.__cwv.tbt += Math.max(0, e.duration - 50);
	});
};

// One run of a page: load under throttle, settle, then read the observed CWV totals. The CPU throttle is
// per-target, so it is set on the page's own CDP session before load.
async function measure(page, url) {
	await page.addInitScript(CWV_INIT);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
	await page.goto(base + url, { waitUntil: "load" });
	await page.waitForTimeout(SETTLE_MS);
	return page.evaluate(() => {
		const c = window.__cwv ?? { lcp: 0, cls: 0, tbt: 0 };
		return { lcp: Math.round(c.lcp), cls: Math.round(c.cls * 10000) / 10000, tbt: Math.round(c.tbt) };
	});
}

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const failures = [];
let checks = 0;
const rows = [];
for (const [view, vp] of Object.entries(VIEWS)) {
	const ctx = await browser.newContext({ viewport: vp });
	// No external requests: abort anything that is not the local server, so the metrics depend only on dist/.
	await ctx.route("**/*", (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
	for (const [name, url] of Object.entries(BUDGET.pages)) {
		const samples = [];
		for (let i = 0; i < RUNS; i++) {
			const page = await ctx.newPage();
			samples.push(await measure(page, url));
			await page.close();
		}
		const m = { lcp: median(samples.map((s) => s.lcp)), cls: median(samples.map((s) => s.cls)), tbt: median(samples.map((s) => s.tbt)) };
		const b = BUDGET.budgets[view];
		const problems = [];
		if (m.lcp > b.lcp) problems.push(`LCP ${m.lcp}ms > ${b.lcp}ms`);
		if (m.cls > b.cls) problems.push(`CLS ${m.cls} > ${b.cls}`);
		if (m.tbt > b.tbt) problems.push(`TBT ${m.tbt}ms > ${b.tbt}ms`);
		checks++;
		rows.push({ view, name, ...m, ok: problems.length === 0 });
		if (problems.length) failures.push(`${view} ${name} (${url}): ${problems.join(", ")}`);
	}
	await ctx.close();
}

await browser.close();
server.close();

console.log(`CWV budget (${RUNS} runs, ${THROTTLE}x CPU, ${SETTLE_MS}ms settle, median):`);
for (const r of rows) {
	const mark = r.ok ? "ok " : "FAIL";
	console.log(`  [${mark}] ${r.view.padEnd(7)} ${r.name.padEnd(11)} LCP ${String(r.lcp).padStart(5)}ms  CLS ${String(r.cls).padStart(7)}  TBT ${String(r.tbt).padStart(4)}ms`);
}

// Surface the result in the CI job summary so the numbers are visible without expanding the step log.
// (The check is Playwright/CDP only — there is no Lighthouse run to compare against.)
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
	const head = `### CWV budget (${RUNS} runs, ${THROTTLE}x CPU, ${SETTLE_MS}ms settle, median)\n\n`;
	const table = `| page | view | LCP (ms) | CLS | TBT (ms) | budget |\n| --- | --- | --- | --- | --- | --- |\n` +
		rows.map((r) => `| ${r.name} | ${r.view} | ${r.lcp} | ${r.cls} | ${r.tbt} | ${r.ok ? "ok" : "FAIL"} |`).join("\n") + "\n";
	appendFileSync(summary, head + table);
}

if (MEASURE) {
	console.log("\n(measure mode: budget not enforced)");
	process.exit(0);
}
if (failures.length) {
	console.error(`\ncheck:cwv FAILED (${failures.length} budget breach(es)):\n - ${failures.join("\n - ")}`);
	console.error("Raise the budget in scripts/cwv-budget.json only with a reason; a real regression should be fixed, not budgeted away.");
	process.exit(1);
}
console.log(`\ncheck:cwv passed: ${checks} page/view combos within budget`);
