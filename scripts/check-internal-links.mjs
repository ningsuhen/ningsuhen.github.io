// Fails the build when a built page links to something the site doesn't ship: a missing file, a
// directory link without its trailing slash, or a #anchor that the target page doesn't define.
// Redirect pages (Astro `redirects`) are ordinary dist files, so their meta-refresh target is checked too.
//   node scripts/check-internal-links.mjs [distDir]   (default: dist, run after `pnpm build`)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(process.argv[2] ?? "dist");
const BASE = process.env.SITE_BASE ?? "/";
const SITE_ORIGIN = "https://ningsuhen.github.io";
const ATTR = /\s(href|src|srcset|poster)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const META_REFRESH = /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i;
const ID = /\s(?:id|name)\s*=\s*["']([^"']+)["']/gi;

function htmlFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) return htmlFiles(full);
		return e.name.endsWith(".html") ? [full] : [];
	});
}

const pages = new Map(); // URL path (e.g. "/archive/") -> file
for (const file of htmlFiles(DIST)) {
	const rel = path.relative(DIST, file).split(path.sep).join("/");
	const urlPath = rel.endsWith("index.html") ? `/${rel.slice(0, -"index.html".length)}` : `/${rel}`;
	pages.set(urlPath, file);
}

const idCache = new Map();
function idsOf(file) {
	let ids = idCache.get(file);
	if (!ids) {
		ids = new Set([...readFileSync(file, "utf8").matchAll(ID)].map((m) => m[1]));
		idCache.set(file, ids);
	}
	return ids;
}

function targetsOf(html) {
	const out = [];
	for (const m of html.matchAll(ATTR)) {
		const raw = m[3] ?? m[4] ?? "";
		if (m[1].toLowerCase() === "srcset") {
			out.push(...raw.split(",").map((c) => c.trim().split(/\s+/)[0]).filter(Boolean));
		} else {
			out.push(raw);
		}
	}
	const refresh = META_REFRESH.exec(html);
	if (refresh) out.push(refresh[1].trim());
	return out;
}

function check(sourceUrl, raw) {
	const url = new URL(raw.trim().replace(/&amp;/g, "&"), `${SITE_ORIGIN}${sourceUrl}`);
	if (url.origin !== SITE_ORIGIN) return null; // external; not checked here
	const pathname = decodeURIComponent(url.pathname);
	if (!pathname.startsWith(BASE)) return `outside base ${BASE}`;
	const rel = pathname.slice(BASE.length - 1); // keep leading slash
	let file;
	if (rel.endsWith("/")) {
		file = path.join(DIST, rel, "index.html");
	} else if (existsSync(path.join(DIST, rel)) && statSync(path.join(DIST, rel)).isFile()) {
		file = path.join(DIST, rel);
	} else if (existsSync(path.join(DIST, rel, "index.html"))) {
		return "directory link without trailing slash";
	}
	if (!file || !existsSync(file)) return "target not found";
	if (url.hash.length > 1 && file.endsWith(".html")) {
		const id = decodeURIComponent(url.hash.slice(1));
		if (!idsOf(file).has(id)) return `anchor #${id} not defined in target`;
	}
	return null;
}

const failures = [];
let checked = 0;
for (const [urlPath, file] of pages) {
	const html = readFileSync(file, "utf8");
	for (const raw of new Set(targetsOf(html))) {
		if (/^(mailto:|tel:|data:|javascript:)/i.test(raw) || raw === "") continue;
		checked++;
		const problem = check(urlPath, raw);
		if (problem) failures.push(`${urlPath} -> ${raw}: ${problem}`);
	}
}

if (failures.length) {
	console.error(`internal link check FAILED (${failures.length} of ${checked}):\n - ${failures.join("\n - ")}`);
	process.exit(1);
}
console.log(`internal link check passed: ${checked} link(s) in ${pages.size} page(s)`);
