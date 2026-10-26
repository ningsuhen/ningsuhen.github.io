// check:seo — the search-engine gate (run after `pnpm build`). The site was never submitted to Search
// Console, so `site:` was empty; this keeps the basics that make it indexable from silently regressing:
//   1. no page declares noindex;
//   2. every page in the sitemap has a canonical link;
//   3. every sitemap URL resolves to a built page (no dead links in the sitemap);
//   4. robots.txt does not block `*` or Googlebot.
//
// Dependency-free (node built-ins only) so it copies into other repos' CI. Scans dist/.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(process.env.SEO_DIST ?? "dist");
const SITE = "https://ningsuhen.github.io";
const failures = [];

// ---- Sitemap: collect the page URLs (following sub-sitemaps, never treating them as pages) -----------------------------
function sitemapUrls() {
	const urls = [];
	const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
	const indexFile = path.join(DIST, "sitemap-index.xml");
	const files = [];
	if (existsSync(indexFile)) {
		// A sitemap index points at sub-sitemaps; follow them. A plain sitemap (no index) is its own file.
		for (const u of locs(readFileSync(indexFile, "utf8"))) files.push(path.join(DIST, new URL(u, SITE).pathname));
	} else files.push(path.join(DIST, "sitemap-0.xml"));
	for (const f of files) if (existsSync(f)) urls.push(...locs(readFileSync(f, "utf8")));
	return urls;
}
const urls = sitemapUrls();
if (!urls.length) failures.push("no sitemap URLs found in dist/ (did the build run?)");

// Map a URL to its built file: "/" -> index.html, "/x/" -> x/index.html, "/x" -> x (or x.html).
const fileFor = (p) => (p === "/" ? "index.html" : p.replace(/^\//, "").replace(/\/$/, "") + (p.endsWith("/") ? "/index.html" : ""));
const noindexRe = /<meta[^>]+name=["']robots["'][^>]+noindex/i;

// ---- 2 + 3. every sitemap page resolves, has a canonical, and is not noindexed -----------------------------------------
let pages = 0;
for (const u of urls) {
	let p;
	try {
		p = new URL(u, SITE).pathname;
	} catch {
		failures.push(`sitemap: unparseable URL ${u}`);
		continue;
	}
	const rel = fileFor(p);
	const file = path.join(DIST, rel);
	if (!existsSync(file)) {
		failures.push(`sitemap: ${u} has no built page (dist/${rel})`);
		continue;
	}
	pages++;
	const content = readFileSync(file, "utf8");
	if (!/<link[^>]+rel=["']canonical["']/i.test(content)) failures.push(`${u}: no canonical link`);
	// A page we list in the sitemap must not also tell search engines not to index it. (Pages kept outside the
	// sitemap — e.g. legacy posts preserved for URL continuity — may be noindex by design.)
	if (noindexRe.test(content)) failures.push(`${u}: in the sitemap but declares noindex`);
}

// ---- 4. robots.txt: must not block `*` or Googlebot ---------------------------------------------------------------------
const robots = existsSync(path.join(DIST, "robots.txt")) ? readFileSync(path.join(DIST, "robots.txt"), "utf8") : "";
if (!robots) failures.push("robots.txt is missing from dist/");
else {
	// A User-agent block is the run of "Disallow:" lines that follow it (until the next User-agent).
	const blocks = {};
	let agent = null;
	for (const line of robots.split("\n")) {
		const ua = line.match(/^User-agent:\s*(\S+)/i);
		if (ua) {
			agent = ua[1];
			blocks[agent] = [];
			continue;
		}
		const dis = line.match(/^Disallow:\s*(\S*)/i);
		if (dis && agent) blocks[agent].push(dis[1]);
	}
	const fullyBlocked = (agent) => (blocks[agent] ?? []).some((d) => d === "/" || d === "");
	if (fullyBlocked("*")) failures.push("robots.txt blocks all of the site for User-agent: *");
	if (fullyBlocked("Googlebot")) failures.push("robots.txt blocks Googlebot");
}

// ---- Result --------------------------------------------------------------------------------------------------------------
if (failures.length) {
	console.error(`\ncheck:seo FAILED (${failures.length}):\n - ${failures.join("\n - ")}`);
	process.exit(1);
}
console.log(`check:seo passed: ${pages} page(s) indexed, ${urls.length} sitemap URL(s) canonical + resolvable, robots.txt allows * and Googlebot.`);
