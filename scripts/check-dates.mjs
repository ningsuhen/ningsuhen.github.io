// Date check over the built site (run after `pnpm build`): `pnpm check:dates`.
// Front-matter dates (`published: 2026-10-24`) must read the same in every timezone. Browser: the archive day labels
// and year groups, the post-page date and JSON-LD datePublished, under emulated America/New_York and Pacific/Kiritimati.
// Feed: the RSS pubDate (noon UTC of the published day), read the way a reader in each zone shows it. Noon UTC keeps
// the calendar day for UTC-12 to UTC+11 only; zones past that (e.g. Pacific/Kiritimati, UTC+14) see the next day.
// Browser: CHROME_PATH, or the playwright-core chromium cache (CI runs `playwright-core install chromium`).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const DIST = path.resolve("dist");
const BROWSER_ZONES = ["America/New_York", "Pacific/Kiritimati"];
const FEED_ZONES = ["America/New_York", "Pacific/Pago_Pago", "Europe/Berlin", "Asia/Kolkata", "Australia/Sydney", "UTC"];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".xml": "application/xml" };

// Front matter straight from the sources, so the expected dates never come from the build under test.
const posts = readdirSync(path.resolve("src/content/posts"), { withFileTypes: true })
	.filter((e) => e.isDirectory() && existsSync(path.resolve("src/content/posts", e.name, "index.md")))
	.map((e) => {
		const text = readFileSync(path.resolve("src/content/posts", e.name, "index.md"), "utf8");
		const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
		const field = (key) => fm.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"))?.[1].replace(/^["']|["']$/g, "");
		return { slug: e.name, draft: field("draft") === "true", published: field("published"), updated: field("updated") };
	})
	.filter((p) => !p.draft);

const errors = [];
const expect = (ok, msg) => { if (!ok) errors.push(msg); };
if (posts.length === 0 || posts.some((p) => !DATE_ONLY.test(p.published ?? ""))) {
	console.error("check-dates: no posts with a YYYY-MM-DD published date found in src/content/posts");
	process.exit(1);
}

// RSS: the reader's calendar day for each item, in each zone.
const rss = readFileSync(path.join(DIST, "rss.xml"), "utf8");
const items = rss.split("<item>").slice(1);
const dayIn = (date, timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
for (const p of posts) {
	const item = items.find((i) => i.includes(`/posts/${p.slug}/</link>`));
	expect(item, `rss: no item for ${p.slug}`);
	if (!item) continue;
	const pubDate = new Date(/<pubDate>([^<]+)<\/pubDate>/.exec(item)?.[1] ?? "");
	for (const zone of FEED_ZONES) {
		expect(dayIn(pubDate, zone) === p.published, `rss ${p.slug}: ${dayIn(pubDate, zone)} in ${zone}, front matter ${p.published}`);
	}
}

// Browser: archive and post pages, emulated timezone.
const cache = path.join(homedir(), "Library/Caches/ms-playwright");
function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	if (!existsSync(cache)) return undefined;
	for (const d of readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell")).sort().reverse()) {
		for (const sub of readdirSync(path.join(cache, d))) {
			const exe = path.join(cache, d, sub, "chrome-headless-shell");
			if (existsSync(exe)) return exe;
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
	res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: findChrome() });

for (const zone of BROWSER_ZONES) {
	const ctx = await browser.newContext({ timezoneId: zone });
	const page = await ctx.newPage();
	await page.goto(`${base}/archive/`, { waitUntil: "load" });
	await page.waitForSelector('a[href*="/posts/"]');
	const rows = await page.evaluate(() =>
		[...document.querySelectorAll('a[href*="/posts/"]')].map((a) => ({
			href: a.getAttribute("href") ?? "",
			day: a.querySelector(":scope > div > div")?.textContent?.trim() ?? "",
			year: Number(a.parentElement?.querySelector(".text-2xl")?.textContent?.trim()),
		})),
	);
	for (const p of posts) {
		const row = rows.find((r) => r.href.endsWith(`/posts/${p.slug}/`));
		expect(row, `${zone} archive: no row for ${p.slug}`);
		if (!row) continue;
		expect(row.day === p.published.slice(5), `${zone} archive ${p.slug}: day "${row.day}", front matter ${p.published}`);
		expect(row.year === Number(p.published.slice(0, 4)), `${zone} archive ${p.slug}: year group ${row.year}, front matter ${p.published}`);
	}
	for (const p of posts) {
		await page.goto(`${base}/posts/${p.slug}/`, { waitUntil: "load" });
		const shown = await page.evaluate(() => {
			const texts = [...document.querySelectorAll("body *")]
				.filter((el) => el.children.length === 0)
				.map((el) => el.textContent?.trim() ?? "")
				.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t));
			const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
				.map((s) => { try { return JSON.parse(s.textContent ?? "null"); } catch { return null; } })
				.flatMap((j) => (Array.isArray(j) ? j : [j]))
				.map((j) => j?.datePublished)
				.filter(Boolean);
			return { texts, ld };
		});
		expect(shown.texts.includes(p.published), `${zone} post ${p.slug}: published ${p.published} not shown (shown: ${shown.texts.join(", ") || "none"})`);
		for (const t of shown.texts) {
			expect(t === p.published || t === p.updated, `${zone} post ${p.slug}: shows ${t}, front matter published ${p.published}${p.updated ? `, updated ${p.updated}` : ""}`);
		}
		for (const d of shown.ld) expect(String(d).slice(0, 10) === p.published, `${zone} post ${p.slug}: JSON-LD datePublished ${d}, front matter ${p.published}`);
	}
	await ctx.close();
}
await browser.close();
server.close();

if (errors.length) {
	console.error(`check-dates: ${errors.length} failure(s)`);
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}
console.log(`check-dates: ${posts.length} posts agree with front matter in ${BROWSER_ZONES.join(", ")} (browser) and ${FEED_ZONES.join(", ")} (feed)`);
