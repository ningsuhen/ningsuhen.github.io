// check-external-links — validate the site's external links, the 404 page and rss.xml.
//
//   node scripts/check-external-links.mjs [distDir] [--json <out>] [--no-network]
//
// - 404 page: dist/404.html exists and has a <title> and an <html> root.
// - rss.xml:  dist/rss.xml exists, is well-formed (root element, balanced tags), and its items carry
//   a <link>, <title> and <pubDate>.
// - external links: every off-site href in the built pages resolves. A HEAD request is tried first and a
//   GET on 405 (some servers reject HEAD). 404/5xx are "broken"; 403/429 are "blocked" (bot throttling,
//   not necessarily dead); a network error is "unreachable".
//
// Exit 0 if clean, 1 if anything is broken. --no-network skips the link check (404 + rss only) so the
// deterministic part can run in the PR gate; the network part runs on the weekly schedule, where flakes
// are acceptable.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const NO_NETWORK = args.includes("--no-network");
// The first positional argument is the dist dir (default: dist). Skip flags and the --json value.
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--json");
const DIST = path.resolve(positional[0] ?? "dist");
const SITE_ORIGIN = "https://ningsuhen.github.io";
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 8;

const ATTR = /\s(href|src|srcset|poster)\s*=\s*("([^"]*)"|'([^']*)')/gi;
// Markup that only looks like links: comments, scripts, styles and code samples (their href="…" is text).
const INERT = /<!--[\s\S]*?-->|<(script|style|pre|code)\b[\s\S]*?<\/\1>|<link\b[^>]*rel=["']canonical["'][^>]*>/gi;

function htmlFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) return htmlFiles(full);
		return e.name.endsWith(".html") ? [full] : [];
	});
}

// ---- 404 page --------------------------------------------------------------------------------------
function check404() {
	const file = path.join(DIST, "404.html");
	if (!existsSync(file)) return { ok: false, problems: ["dist/404.html is missing"] };
	const html = readFileSync(file, "utf8");
	const problems = [];
	if (!/<title[^>]*>[^<]+<\/title>/i.test(html)) problems.push("404 page has no <title>");
	if (!/<html\b/i.test(html)) problems.push("404 page has no <html> root");
	return { ok: problems.length === 0, problems };
}

// ---- rss.xml ---------------------------------------------------------------------------------------
// A small well-formedness pass (no external parser): strip comments/CDATA, then walk the tags with a
// stack. Good enough to catch a truncated or malformed feed, which is what this check exists for.
function checkXml(text) {
	const problems = [];
	if (!/^<\?xml/.test(text)) problems.push("missing <?xml declaration");
	const clean = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
	const tagRe = /<\/?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
	const stack = [];
	let root = null;
	let items = 0;
	for (const m of clean.matchAll(tagRe)) {
		const [full, name] = m;
		if (full.endsWith("/>")) continue; // self-closing
		if (full.startsWith("</")) {
			const top = stack.pop();
			if (top !== name) {
				problems.push(`mismatched </${name}> (expected </${top ?? "nothing"}>)`);
				break;
			}
		} else {
			if (!root) root = name;
			if (name === "item" || name === "entry") items++;
			stack.push(name);
		}
	}
	if (stack.length) problems.push(`unclosed <${stack[stack.length - 1]}>`);
	if (!root) problems.push("no root element");
	else if (root !== "rss" && root !== "feed") problems.push(`root is <${root}>, expected <rss> or <feed>`);
	return { problems, root, items };
}

function checkRss() {
	const file = path.join(DIST, "rss.xml");
	if (!existsSync(file)) return { ok: false, problems: ["dist/rss.xml is missing"] };
	const text = readFileSync(file, "utf8");
	const { problems, items } = checkXml(text);
	if (items === 0) problems.push("feed has no <item>/<entry>");
	// Each item must carry a link, a title and a pubDate.
	const itemBlocks = [...text.matchAll(/<item\b[\s\S]*?<\/item>/g)].map((m) => m[0]);
	for (const [i, block] of itemBlocks.entries()) {
		for (const tag of ["link", "title", "pubDate"])
			if (!new RegExp(`<${tag}\\b`).test(block)) problems.push(`item ${i + 1} has no <${tag}>`);
	}
	return { ok: problems.length === 0, problems, items };
}

// ---- external links --------------------------------------------------------------------------------
function externalTargets(html) {
	html = html.replace(INERT, "");
	const out = new Set();
	for (const m of html.matchAll(ATTR)) {
		const raw = (m[3] ?? m[4] ?? "").trim().replace(/&amp;/g, "&");
		if (!raw || /^(mailto:|tel:|data:|javascript:|#)/i.test(raw)) continue;
		let url;
		try {
			url = new URL(raw, SITE_ORIGIN);
		} catch {
			continue;
		}
		if (url.origin === SITE_ORIGIN) continue; // internal; check-internal-links covers it
		out.add(url.origin + url.pathname); // dedupe: the same host+path is one link to check
	}
	return [...out];
}

async function probe(url) {
	const opts = { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) };
	try {
		let res = await fetch(url, { ...opts, method: "HEAD" });
		if (res.status === 405) res = await fetch(url, { ...opts, method: "GET" }); // HEAD rejected
		res.body?.cancel(); // don't download
		if (res.status >= 500 || res.status === 404) return { url, status: res.status, kind: "broken" };
		if (res.status === 403 || res.status === 429) return { url, status: res.status, kind: "blocked" };
		return { url, status: res.status, kind: "ok" };
	} catch (e) {
		return { url, status: null, kind: "unreachable", error: e.name };
	}
}

async function checkLinks(urls) {
	const results = [];
	let i = 0;
	const workers = Array.from({ length: CONCURRENCY }, async () => {
		while (i < urls.length) {
			const u = urls[i++];
			results.push(await probe(u));
		}
	});
	await Promise.all(workers);
	return results;
}

// ---- run -------------------------------------------------------------------------------------------
const notFound = [];
if (!existsSync(DIST)) notFound.push(`no such dist dir: ${DIST}`);

const r404 = notFound.length ? { ok: false, problems: notFound } : check404();
const rRss = notFound.length ? { ok: false, problems: notFound } : checkRss();

let links = null;
if (!NO_NETWORK && !notFound.length) {
	// url -> the pages that link to it (so the weekly issue can say where each broken link lives).
	const sources = new Map();
	const pages = htmlFiles(DIST).map((file) => {
		const rel = path.relative(DIST, file).split(path.sep).join("/");
		const urlPath = rel.endsWith("index.html") ? `/${rel.slice(0, -"index.html".length)}` : `/${rel}`;
		return { file, urlPath };
	});
	for (const { file, urlPath } of pages)
		for (const u of externalTargets(readFileSync(file, "utf8"))) {
			if (!sources.has(u)) sources.set(u, new Set());
			sources.get(u).add(urlPath);
		}
	const urls = [...sources.keys()];
	console.log(`checking ${urls.length} external link(s) across ${pages.length} page(s)…`);
	const results = await checkLinks(urls);
	for (const r of results) r.pages = [...(sources.get(r.url) ?? [])].sort();
	links = {
		total: urls.length,
		broken: results.filter((r) => r.kind === "broken"),
		blocked: results.filter((r) => r.kind === "blocked"),
		unreachable: results.filter((r) => r.kind === "unreachable"),
	};
}

const report = {
	checkedAt: new Date().toISOString(),
	f404: r404,
	fRss: rRss,
	links,
};

const brokenCount =
	(r404.problems.length ? 1 : 0) +
	(rRss.problems.length ? 1 : 0) +
	(links ? links.broken.length + links.unreachable.length : 0);

console.log(`\n404 page: ${r404.ok ? "ok" : "FAILED"}`);
for (const p of r404.problems) console.log(`  - ${p}`);
console.log(`rss.xml:  ${rRss.ok ? "ok" : "FAILED"}${rRss.items ? ` (${rRss.items} items)` : ""}`);
for (const p of rRss.problems) console.log(`  - ${p}`);
if (links) {
	console.log(
		`links:    ${links.total} checked — ${links.broken.length} broken, ${links.blocked.length} blocked, ${links.unreachable.length} unreachable`,
	);
	for (const r of [...links.broken, ...links.unreachable])
		console.log(`  - ${r.kind}: ${r.url} (${r.status ?? r.error}) on ${r.pages.join(", ")}`);
}

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));

if (brokenCount) {
	console.log(`\nexternal link check FAILED (${brokenCount} problem(s))`);
	process.exit(1);
}
console.log("\nexternal link check passed");
