// The chrome pipeline: take a standalone HTML document and add the navbar, comments, license footer,
// breadcrumb, theme script and head fixes. Shared by the old injection path (src/integrations/standalone-header.ts,
// which transforms public/**/*.html at build/dev) and the Astro shell (src/layouts/StandaloneShell.astro).
// Keeping it in one place is what keeps the two paths from drifting.
import { readFileSync } from "node:fs";
import path from "node:path";
import { MARKER } from "./navbar";
import { LICENSE_MARKER } from "./license";
import { commentsFor } from "./comments";
import { addBreadcrumb } from "./breadcrumb";
import { buildSocialMeta, pageDescription } from "./social";
import { withThemeScript } from "./theme";
import { esc } from "./util";
import { siteConfig } from "../config";
import { A11Y_MARKER, buildA11yScript } from "./a11y";

const OPT_OUT = /<meta[^>]+name=["']site-navbar["'][^>]+content=["']off["']/i;

/** Navbar, breadcrumb and meta fixes for one standalone HTML document. `extra` is appended before </body>. */
export function applyChrome(html: string, script: string, extra: string, footer: string, urlPath: string, base: string, site: string): string {
	const comments = commentsFor(html, urlPath);
	const a11y = html.includes(A11Y_MARKER) ? "" : buildA11yScript();
	const parts = [html.includes(MARKER) || OPT_OUT.test(html) ? "" : script, comments, html.includes(LICENSE_MARKER) ? "" : footer, a11y, extra].join("");
	const body = parts ? (() => { const at = html.lastIndexOf("</body>"); return at === -1 ? html + parts : html.slice(0, at) + parts + html.slice(at); })() : html;
	const withCrumbs = addBreadcrumb(body, urlPath, base, site);
	return withThemeScript(ensureHead(versionedBundle(withSearchBody(withCrumbs)), new URL(base.replace(/\/$/, "") + urlPath, site).href, site));
}

// Index the page's content in the site search: Pagefind indexes elements marked data-pagefind-body.
// The old standalone pages (public/**/*.html) were never marked, so a search for a report/playground
// returned the companion post (no kind chip) instead of the page itself. Add the marker to the <main>.
// The Astro shell already sets it (data-pagefind-body="" or "false"), so this only touches the old pages.
function withSearchBody(html: string): string {
	if (html.includes("data-pagefind-body")) return html;
	const main = html.match(/<main(?=[\s>])[^>]*>/i);
	if (!main) return html;
	return html.replace(main[0], main[0].replace(/^<main/i, "<main data-pagefind-body"));
}

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
	let out = html.replace(/(<link\b[^>]*\bhref=["'])(\/design-system\/(?:research|rd)\.css)(["'])/gi, (_match, pre, href, quote) => {
		const name = href.includes("rd.css") ? "rd.css" : "research.css";
		return `${pre}${href}?v=${css(name)}${quote}`;
	});
	// The rd.js runtime <script> (module), if the page references it.
	if (js) out = out.replace(/(<script\b[^>]*\bsrc=["'])(\/design-system\/rd\.js)(["'])/gi, (_match, pre, src, quote) => `${pre}${src}?v=${js}${quote}`);
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
	// A plain <meta name="description">: some exports only declare og:description, which a search engine may not
	// use as the snippet. Add the same text the social cards use, when the page has no description of its own.
	if (!/<meta[^>]+name=["']description["']/i.test(html)) {
		const d = pageDescription(html, canonical, site);
		if (d) late.push(`<meta name="description" content="${esc(d)}">`);
	}
	// Google Search Console site-verification, same as the shared head layout; emitted only when the token is set.
	if (siteConfig.googleSiteVerification && !/<meta[^>]+name=["']google-site-verification["']/i.test(html))
		late.push(`<meta name="google-site-verification" content="${esc(siteConfig.googleSiteVerification)}">`);
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
