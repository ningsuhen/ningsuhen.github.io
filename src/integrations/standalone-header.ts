import { readFileSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AstroIntegration } from "astro";
import { draftHrefs, isDraftPage } from "../../scripts/lib/draft-pages.mjs";
import { MARKER, buildScript } from "../chrome/navbar";
import { LICENSE_MARKER, buildLicenseScript } from "../chrome/license";
import { commentsFor } from "../chrome/comments";
import { addBreadcrumb } from "../chrome/breadcrumb";
import { buildSocialMeta } from "../chrome/social";
import { withThemeScript } from "../chrome/theme";
import { esc } from "../chrome/util";
import { A11Y_MARKER, buildA11yScript } from "../chrome/a11y";

/**
 * Adds the site's navbar (same links as navBarConfig, plus the light/dark toggle) to every
 * standalone HTML file shipped from public/ (reports, demos, exported artifacts), so those
 * pages don't need to know about the site. The toggle shares localStorage "theme" with the
 * site and sets <html data-theme> on the page, which standalone pages can style against.
 * Opt out per page with: <meta name="site-navbar" content="off">
 */
export default function standaloneHeader(): AstroIntegration {
	let publicDir = "";
	let base = "/";
	let site = "";

	return {
		name: "standalone-header",
		hooks: {
			"astro:config:done": ({ config }) => {
				publicDir = fileURLToPath(config.publicDir);
				base = config.base;
				site = config.site ?? "";
			},
			// Dev: Astro's dev server doesn't map public/<dir>/ to <dir>/index.html and skips the build hook, so
			// standalone pages were 404 locally and had no navbar. Serve them transformed, with Vite's client
			// injected so editing a public/*.html file live-reloads the open page.
			"astro:server:setup": ({ server }) => {
				const script = buildScript(base);
				server.watcher.add(publicDir);
				server.watcher.on("change", (file) => {
					if (file.startsWith(publicDir) && file.endsWith(".html")) server.ws.send({ type: "full-reload" });
				});
				server.middlewares.use(async (req, res, next) => {
					const pathname = decodeURIComponent((req.url ?? "/").split("?")[0]);
					const rel = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
					const file = path.join(publicDir, path.normalize(rel));
					if (!rel.endsWith(".html") || !file.startsWith(publicDir)) return next();
					try {
						const html = await readFile(file, "utf8");
						const client = '<script type="module" src="/@vite/client"></script>';
						res.setHeader("Content-Type", "text/html; charset=utf-8");
						res.end(transform(html, script, client, buildLicenseScript(base), pathname, base, site));
					} catch {
						next();
					}
				});
			},
			"astro:build:done": async ({ dir }) => {
				const outDir = fileURLToPath(dir);
				const script = buildScript(base);
				const licenseScript = buildLicenseScript(base);
				// Draft pages (src/data Draft entries) are not shipped. Astro already copied public/ into dist/, so their
				// folders (page and data) are removed here, before pagefind indexes the output.
				const drafts = draftHrefs();
				for (const href of drafts) {
					if (!/^\/(research|experiments|ideas)\/[^/]+\/$/.test(href)) throw new Error(`Draft href is not a standalone page folder: ${href}`);
					await rm(path.join(outDir, href), { recursive: true, force: true });
				}
				for (const rel of await htmlFiles(publicDir)) {
					if (isDraftPage(rel, drafts)) continue;
					const target = path.join(outDir, rel);
					const html = await readFile(target, "utf8");
					const urlPath = `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
					await writeFile(target, transform(html, script, "", licenseScript, urlPath, base, site));
				}
			},
		},
	};
}

/** Navbar, breadcrumb and meta fixes for one standalone HTML document (shared by build and dev). `extra` is appended before </body>. */
function transform(html: string, script: string, extra: string, footer: string, urlPath: string, base: string, site: string): string {
	const comments = commentsFor(html, urlPath);
	const a11y = html.includes(A11Y_MARKER) ? "" : buildA11yScript();
	const parts = [html.includes(MARKER) || OPT_OUT.test(html) ? "" : script, comments, html.includes(LICENSE_MARKER) ? "" : footer, a11y, extra].join("");
	const body = parts ? (() => { const at = html.lastIndexOf("</body>"); return at === -1 ? html + parts : html.slice(0, at) + parts + html.slice(at); })() : html;
	const withCrumbs = addBreadcrumb(body, urlPath, base, site);
	return withThemeScript(ensureHead(versionedBundle(withCrumbs), new URL(base.replace(/\/$/, "") + urlPath, site).href, site));
}

const OPT_OUT = /<meta[^>]+name=["']site-navbar["'][^>]+content=["']off["']/i;

// Cache-bust the design-system bundle: append ?v=<hash> to its <link> and <script> so a new bundle is
// fetched, not the cached copy. The hashes come from the committed manifest.json (per-file content
// hashes). Pages that still inline the CSS (no <link>) are untouched — the bundle-linked check nudges
// them to link. rd.js is only versioned when the page actually references it.
function versionedBundle(html: string): string {
	let files: Record<string, string> = {};
	try {
		files = (JSON.parse(readFileSync(path.resolve("public/design-system/manifest.json"), "utf8")) as { files?: Record<string, string> }).files ?? {};
	} catch {
		return html; // no manifest yet (pre-build): leave the links as-is
	}
	if (!files["rd.css"] && !files["rd.js"]) return html;
	const css = (f: string) => files[f] ?? "";
	const js = files["rd.js"] ?? "";
	// CSS <link>s: research.css (frozen alias) and rd.css (forward bundle), each with its own hash.
	let out = html.replace(/(<link\b[^>]*\bhref=["'])(\/design-system\/(?:research|rd)\.css)(["'])/gi, (m, pre, href, quote) => {
		const name = href.includes("rd.css") ? "rd.css" : "research.css";
		return `${pre}${href}?v=${css(name)}${quote}`;
	});
	// The rd.js runtime <script> (module), if the page references it.
	if (js) out = out.replace(/(<script\b[^>]*\bsrc=["'])(\/design-system\/rd\.js)(["'])/gi, (m, pre, src, quote) => `${pre}${src}?v=${js}${quote}`);
	return out;
}

// Exported pages often lose these tags. Without a doctype the page renders in quirks mode (BackCompat);
// without a charset, "·" renders as "Â·"; without a viewport, phones show a zoomed-out desktop page; without
// lang, screen readers guess the language. Prepend whichever is missing (valid at the very start of the file).
function ensureHead(html: string, canonical: string, site: string): string {
	const head = html.slice(0, 4096);
	const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0];
	// charset and viewport must stay the first two head elements, so they go in front; icon, canonical and the
	// social cards go before </head>, after whatever the page already declares (a page's own charset is never pushed back).
	const early: string[] = [];
	const late: string[] = [];
	if (!/<meta[^>]+charset=/i.test(head)) early.push('<meta charset="utf-8">');
	if (!/<meta[^>]+name=["']viewport["']/i.test(html)) early.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
	if (!/<link[^>]+rel=["']icon["']/i.test(html)) late.push(FAVICONS);
	if (!/<link[^>]+rel=["']canonical["']/i.test(html)) late.push(`<link rel="canonical" href="${esc(canonical)}">`);
	// Machine-readable AI/TDM opt-out (W3C TDMRep), same as the shared head layout.
	if (!/<meta[^>]+name=["']tdm-reservation["']/i.test(html)) late.push(`<meta name="tdm-reservation" content="1"><meta name="tdm-policy" content="${esc(new URL("/license/", canonical).href)}">`);
	late.push(buildSocialMeta(html, canonical, site));
	let rest = withHtmlLang(doctype ? html.slice(doctype.length) : html);
	const headEnd = rest.search(/<\/head>/i);
	if (headEnd !== -1) rest = rest.slice(0, headEnd) + late.join("") + rest.slice(headEnd);
	else {
		// No </head> (some exports have no head element): land after the page's own viewport or charset meta.
		const meta = rest.match(/<meta[^>]+name=["']viewport["'][^>]*>/i) ?? rest.match(/<meta[^>]+charset=[^>]*>/i);
		if (meta?.index !== undefined) rest = rest.slice(0, meta.index + meta[0].length) + late.join("") + rest.slice(meta.index + meta[0].length);
		else early.push(...late);
	}
	return (doctype ?? "<!doctype html>") + early.join("") + rest;
}

// Some exports have no <html> start tag at all, and CSS/JS comments can mention <html lang>. Match real tags only.
function withHtmlLang(html: string): string {
	const real = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/gi, "").match(/<html(?=[\s>])[^>]*>/i)?.[0];
	if (!real) return '<html lang="en">' + html;
	if (/\blang=/i.test(real)) return html;
	return html.replace(real, real.replace(/^<html/i, '<html lang="en"'));
}

const FAVICONS =
	'<link rel="icon" href="/favicon/favicon-light-32.png" sizes="32x32" type="image/png" media="(prefers-color-scheme: light)">' +
	'<link rel="icon" href="/favicon/favicon-dark-32.png" sizes="32x32" type="image/png" media="(prefers-color-scheme: dark)">';

async function htmlFiles(root: string, dir = ""): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
		const rel = path.join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await htmlFiles(root, rel)));
		else if (entry.name.endsWith(".html")) found.push(rel);
	}
	return found;
}
