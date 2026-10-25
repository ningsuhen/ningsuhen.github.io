import { readFileSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AstroIntegration } from "astro";
import { commentConfig, navBarConfig, siteConfig } from "../config";
import { LinkPreset } from "../types/config";
import { themeRuntimeScript } from "../utils/theme-runtime";
import { draftHrefs, isDraftPage } from "../../scripts/lib/draft-pages.mjs";

// Same Roboto Bold the main site ships, inlined so link widths (and so positions) match exactly.
const ROBOTO_700 = readFileSync(path.resolve("node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff2")).toString("base64");
const ROBOTO_400 = readFileSync(path.resolve("node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff2")).toString("base64");
const face = (w: number, b64: string) => `@font-face{font-family:"RobotoNav";font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
const FONT_FACE = face(700, ROBOTO_700) + face(400, ROBOTO_400);

const MARKER = "data-site-navbar";
const THEME_MARKER = "data-site-theme";
// Theme model in <head>, before first paint (see src/utils/theme-runtime.ts). Light unless the reader chose otherwise.
const HEAD_THEME = `<script ${THEME_MARKER}>${themeRuntimeScript(true)}</script>`;
const LICENSE_MARKER = "data-site-license";
const OPT_OUT = /<meta[^>]+name=["']site-navbar["'][^>]+content=["']off["']/i;
const COMMENTS_MARKER = "data-site-comments";
const COMMENTS_OPT_OUT = /<meta[^>]+name=["']rd-comments["'][^>]+content=["']off["']/i;
// Reports, live experiments and ideas get comments (one folder deep, e.g. /research/<slug>/). The design-system pages don't.
const COMMENTS_PAGE = /^\/(research|experiments|ideas)\/[^/]+\/$/;

type NavItem = { name: string; url: string; external: boolean };

// Mirrors src/constants/link-presets.ts (that file pulls in i18n through path aliases,
// which the Astro config loader can't resolve).
const PRESETS: Record<LinkPreset, { name: string; url: string }> = {
	[LinkPreset.Home]: { name: "Home", url: "/" },
	[LinkPreset.Archive]: { name: "Archive", url: "/archive/" },
	[LinkPreset.About]: { name: "About", url: "/about/" },
};

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
				const script = buildScript(navItems(base), siteConfig.title, siteConfig.themeColor.hue);
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
						res.end(transform(html, script, client, buildLicenseScript(base, siteConfig.themeColor.hue), pathname, base, site));
					} catch {
						next();
					}
				});
			},
			"astro:build:done": async ({ dir }) => {
				const outDir = fileURLToPath(dir);
				const script = buildScript(navItems(base), siteConfig.title, siteConfig.themeColor.hue);
				const licenseScript = buildLicenseScript(base, siteConfig.themeColor.hue);
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

/** Navbar + meta fixes for one standalone HTML document (shared by build and dev). `extra` is appended before </body>. */
function transform(html: string, script: string, extra: string, footer: string, urlPath: string, base: string, site: string): string {
	const comments = commentsFor(html, urlPath);
	const parts = [html.includes(MARKER) || OPT_OUT.test(html) ? "" : script, comments, html.includes(LICENSE_MARKER) ? "" : footer, extra].join("");
	const body = parts ? (() => { const at = html.lastIndexOf("</body>"); return at === -1 ? html + parts : html.slice(0, at) + parts + html.slice(at); })() : html;
	return withThemeScript(ensureHead(versionedBundle(body), new URL(base.replace(/\/$/, "") + urlPath, site).href, site));
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
	let out = html.replace(/(<link\b[^>]*\bhref=["'])(\/design-system\/(?:research|rd)\.css)(["'])/gi, (m, pre, href, quote) => {
		const name = href.includes("rd.css") ? "rd.css" : "research.css";
		return `${pre}${href}?v=${css(name)}${quote}`;
	});
	// The rd.js runtime <script> (module), if the page references it.
	if (js) out = out.replace(/(<script\b[^>]*\bsrc=["'])(\/design-system\/rd\.js)(["'])/gi, (m, pre, src, quote) => `${pre}${src}?v=${js}${quote}`);
	return out;
}

// The theme script goes at the end of <head>, or right after <html> when the export has no </head>.
function withThemeScript(html: string): string {
	if (html.includes(THEME_MARKER)) return html;
	const headEnd = html.search(/<\/head>/i);
	if (headEnd !== -1) return html.slice(0, headEnd) + HEAD_THEME + html.slice(headEnd);
	// No </head>: land after the page's charset/viewport metas, so they stay the first head elements.
	const metas = [...html.slice(0, 4096).matchAll(/<meta[^>]+(?:charset=|name=["']viewport["'])[^>]*>/gi)];
	if (metas.length) {
		const last = metas[metas.length - 1];
		const at = (last.index ?? 0) + last[0].length;
		return html.slice(0, at) + HEAD_THEME + html.slice(at);
	}
	return html.replace(/<html(?=[\s>])[^>]*>/i, (tag) => tag + HEAD_THEME);
}

// The /research/ and /experiments/ cards carry a one-line summary; use it as the social description when the
// exported page has no <meta name="description"> of its own.
function entrySummaries(): Map<string, string> {
	const out = new Map<string, string>();
	for (const file of ["research.json", "experiments.json"]) {
		try {
			const data = JSON.parse(readFileSync(path.resolve(`src/data/${file}`), "utf8")) as { items?: { href?: string; summary?: string }[] };
			for (const item of data.items ?? []) if (item.href && item.summary) out.set(item.href, item.summary);
		} catch {
			/* no data file: fall back to the page/site description */
		}
	}
	return out;
}

// Open Graph / Twitter cards for a standalone page: the visible title (minus the created/updated stamp) and the
// page's own description when it has one, so a share is not a blank card. Head-only: it lands in the "late" group
// (after the charset/viewport metas), so the design-system head-order rule — charset then viewport first — holds.
function buildSocialMeta(html: string, canonical: string, site: string): string {
	if (/<meta[^>]+property=["']og:title["']/i.test(html)) return ""; // the page already declares OG
	let title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? siteConfig.title).trim();
	title = title.replace(/\s*[·•]\s*created \d{4}-\d{2}-\d{2}\s*[·•]\s*updated \d{4}-\d{2}-\d{2}\s*$/i, "").trim();
	const descTag = html.match(/<meta[^>]+name=["']description["'][^>]*>/i)?.[0] ?? "";
	const ownDescription = descTag.match(/content=["']([^"']*)["']/i)?.[1]?.trim() ?? "";
	const urlPath = new URL(canonical, site).pathname;
	const description = ownDescription || entrySummaries().get(urlPath) || siteConfig.subtitle || "";
	const image = new URL("/images/default-thumbnail.webp", site).href;
	const og = (k: string, v: string) => `<meta property="${k}" content="${esc(v)}">`;
	const tw = (k: string, v: string) => `<meta name="twitter:${k}" content="${esc(v)}">`;
	return [
		og("og:type", "website"),
		og("og:site_name", siteConfig.title),
		og("og:title", title),
		og("og:description", description),
		og("og:url", canonical),
		og("og:image", image),
		tw("card", "summary_large_image"),
		tw("title", title),
		tw("description", description),
		tw("image", image),
	].join("");
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

function navItems(base: string): NavItem[] {
	const prefix = base.replace(/\/$/, "");
	return navBarConfig.links.map((link) => {
		if (typeof link === "number") {
			const preset = PRESETS[link];
			return { name: preset.name, url: prefix + preset.url, external: false };
		}
		return { name: link.name, url: link.external ? link.url : prefix + link.url, external: !!link.external };
	});
}

async function htmlFiles(root: string, dir = ""): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
		const rel = path.join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await htmlFiles(root, rel)));
		else if (entry.name.endsWith(".html")) found.push(rel);
	}
	return found;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// Sizes are em of the header's own font size, which is the main site's root size: 16px from 768px, 14px below
// (html text-[14px] md:text-[16px]). A Tailwind rem on the main navbar is the same number of em here, so every
// measure matches at every width. Breakpoints: links and the search field from 1024px (lg), like the main bar.
const CSS = `
:host{all:initial;display:block;position:sticky;top:0;z-index:1000;--hue:250;--u:16px;--card:#fff;--float:#fff;--link:rgba(0,0,0,.75);--prime:oklch(.70 .14 var(--hue));--hover:oklch(.95 .025 var(--hue));--active:oklch(.98 .01 var(--hue));--field:rgba(0,0,0,.04);--field-hover:rgba(0,0,0,.06);--ph:rgba(0,0,0,.5);--ico:rgba(0,0,0,.3);--muted:#6b6b72}
@media(max-width:767.98px){:host{--u:14px}}
:host([data-theme=dark]){--card:oklch(.23 .015 var(--hue));--float:oklch(.19 .015 var(--hue));--link:rgba(255,255,255,.75);--prime:oklch(.75 .14 var(--hue));--hover:oklch(.30 .035 var(--hue));--active:oklch(.27 .025 var(--hue));--field:rgba(255,255,255,.05);--field-hover:rgba(255,255,255,.10);--ph:rgba(255,255,255,.5);--ico:rgba(255,255,255,.3);--muted:rgba(255,255,255,.55)}
header{box-sizing:border-box;position:relative;display:flex;align-items:center;justify-content:space-between;height:4.5em;width:min(100%,75em);margin:0 auto;padding:0 1em;background:var(--card);color:var(--link);border-radius:0 0 1em 1em;font:700 var(--u)/1 RobotoNav,Roboto,system-ui,-apple-system,"Segoe UI",sans-serif}
a,button{color:inherit;text-decoration:none;font:inherit;cursor:pointer;background:none;border:0;position:relative;isolation:isolate;transition:background-color .2s ease-out,color .15s ease-out,transform .15s ease-out}
.brand,nav a,.end button,.menu-panel a{display:inline-flex;align-items:center;justify-content:center;border-radius:.5em;white-space:nowrap}
.brand::before,nav a::before,.end button::before,.menu-panel a::before{content:"";position:absolute;inset:0;border-radius:inherit;z-index:-1;background:transparent;transform:scale(.85);transition:transform .2s ease-out,background-color .2s ease-out}
.brand:hover::before,nav a:hover::before,.end button:hover::before,.menu-panel a:hover::before{background:var(--hover);transform:scale(1)}
.brand:active::before,nav a:active::before,.end button:active::before,.menu-panel a:active::before{background:var(--active)}
a:hover,button:hover{color:var(--prime)}
/* The brand shrinks and wraps when the links need the room, as the main navbar's does (measured parity at 1024px). */
.brand{height:3.25em;padding:0 1.25em;color:var(--prime);font-weight:700;white-space:normal;text-align:center}
.brand svg{width:1.75em;height:1.75em;margin:0 .5em .25em 0}
.brand:active,nav a:active,.end button:active{transform:scale(.95)}
nav{display:none;align-items:center}
nav a{height:2.75em;padding:0 1.25em;font-weight:700}
.end{display:flex;align-items:center;flex:none}
button{width:2.75em;height:2.75em;flex:none;padding:0;font-weight:400}
.end button:active{transform:scale(.9)}
@media(min-width:1024px){nav{display:flex}.end .sbtn,.end .menu{display:none}}
@media(min-width:768px){header{width:calc(min(100%,75em) - 2em)}}
svg{width:1.25em;height:1.25em;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ext{width:.875em;height:.875em;margin-left:.25em;opacity:.25}
.search{position:relative;display:none;align-items:center;box-sizing:border-box;width:10em;height:2.75em;margin-right:.5em;border-radius:.5em;background:var(--field);transition:width .15s ease-out,background-color .15s}
.search:hover,.search:focus-within{background:var(--field-hover)}
.search:focus-within{width:15em}
.search svg{position:absolute;left:.75em;top:50%;transform:translateY(-50%);color:var(--ico);pointer-events:none}
.q{box-sizing:border-box;width:100%;height:100%;padding:0 .75em 0 2.5em;border:0;outline:0;background:transparent;color:var(--ph);font-family:inherit;font-size:.875em;font-weight:400}
.q::placeholder,.q2::placeholder{color:var(--ico)}
@media(min-width:1024px){.search{display:flex}}
.sp,.panel,.menu-panel{position:absolute;z-index:1;box-sizing:border-box;top:5.25em;right:1em;border-radius:1em;background:var(--float);transition:opacity .15s ease,transform .15s ease,visibility .15s}
.closed{opacity:0;transform:translateY(-.25em);visibility:hidden;pointer-events:none}
.sp{top:5em;left:1em;right:1em;max-height:70vh;overflow:auto;padding:.5em}
@media(min-width:768px){.sp{left:auto;width:30em}}
.q2{display:block;box-sizing:border-box;width:100%;height:2.75em;padding:0 .75em;border:0;outline:0;border-radius:.5em;background:var(--field);color:var(--link);font-family:inherit;font-size:.875em}
.res:not(:empty){margin-top:.5em}
@media(min-width:1024px){.q2{display:none}}
.res a{display:block;padding:.625em .75em;border-radius:.5em;font-weight:400;font-size:.875em;line-height:1.4}
.res a:hover{background:var(--hover)}
.res b{display:block;color:var(--prime);font-size:.9375em}
.res mark{background:transparent;color:var(--prime);font-weight:700}
.res p{margin:0;padding:.5em .75em;color:var(--muted);font-size:.875em}
.panel{width:20em;padding:1em}
.panel label{display:flex;justify-content:space-between;margin-bottom:.75em;font-size:.875em}
.panel input{width:100%;accent-color:var(--prime)}
.menu-panel{display:flex;flex-direction:column;padding:.5em}
.menu-panel a{justify-content:space-between;gap:2em;padding:.5em .25em .5em .75em;font-weight:700;line-height:1.5}
.menu-panel .chev{width:1.25em;height:1.25em;color:var(--prime)}
:host(:not([data-theme=dark])) .moon,:host([data-theme=dark]) .sun{display:none}
`;

// Page-level rules the header needs: the main site hides its page scrollbar (OverlayScrollbars), so standalone pages
// hide theirs too; a visible 15px bar would take layout width and shift the centred navbar. overflow-y:scroll makes
// <html> the scroll container so scrollbar-width:none applies to it — with the default overflow:visible the *viewport*
// is the scroll container and its classic bar still reserves a gutter, shifting the centred card 7.5px off main's.
const HEAD_CSS = FONT_FACE + "html{overflow-y:scroll;scrollbar-width:none}html::-webkit-scrollbar{display:none}";

// Lucide (ISC) icon bodies, copied from @iconify-json/lucide. Inline so standalone pages make no icon requests;
// stroke/fill come from the `svg` rule above.
const LUCIDE = {
	house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
	moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
	"chevron-right": '<path d="m9 18 6-6-6-6"/>',
	menu: '<path d="M4 12h16M4 6h16M4 18h16"/>',
} as const;

const svgIcon = (name: keyof typeof LUCIDE, cls: string) =>
	`<svg class="${cls}" viewBox="0 0 24 24">${LUCIDE[name]}</svg>`;

const EXT = '<svg class="ext" viewBox="0 0 24 24"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
const PALETTE = '<svg viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>';

const ICONS = svgIcon("sun", "sun") + svgIcon("moon", "moon");

// Script (not markup) so it works for HTML fragments without <body>; shadow DOM isolates it from page CSS.
function buildScript(items: NavItem[], title: string, hue: number): string {
	const home = esc(items[0]?.url ?? "/");
	const target = (i: NavItem) => (i.external ? ' target="_blank" rel="noopener"' : "");
	const links = items.map((i) => `<a href="${esc(i.url)}"${target(i)}>${esc(i.name)}${i.external ? EXT : ""}</a>`).join("");
	const rows = items
		.map((i) => `<a href="${esc(i.url)}"${target(i)}><span>${esc(i.name)}</span>${i.external ? EXT : svgIcon("chevron-right", "chev")}</a>`)
		.join("");
	const markup =
		`<style>${CSS}</style><header><a class="brand" href="${home}">${svgIcon("house", "")}${esc(title)}</a>` +
		`<nav>${links}</nav><span class="end"><label class="search">${SEARCH}<input class="q" type="search" placeholder="Search" aria-label="Search" autocomplete="off"></label>` +
		`<button type="button" class="sbtn" aria-label="Search Panel" aria-expanded="false">${SEARCH}</button>` +
		`<button type="button" class="pal" aria-label="Display Settings" aria-expanded="false">${PALETTE}</button>` +
		`<button type="button" class="theme" aria-label="Light/Dark Mode">${ICONS}</button>` +
		`<button type="button" class="menu" aria-label="Menu" aria-expanded="false" aria-controls="nav-menu-panel">${svgIcon("menu", "")}</button></span>` +
		`<div class="sp closed"><input class="q q2" type="search" placeholder="Search" aria-label="Search" autocomplete="off"><div class="res"></div></div>` +
		`<div class="panel closed"><label>Theme color <output></output></label><input type="range" min="0" max="360" aria-label="Theme color"></div>` +
		`<div class="menu-panel closed" id="nav-menu-panel">${rows}</div></header>`;
	const pfUrl = (items[0]?.url ?? "/") + "pagefind/pagefind.js";
	const html = JSON.stringify(markup).replace(/<\/(script)/gi, "<\\/$1");

	return (
		`<script ${MARKER}>(function(){` +
		`var f=document.createElement("style");f.textContent=${JSON.stringify(HEAD_CSS)};document.documentElement.appendChild(f);` +
		`var host=document.createElement("div");host.setAttribute("${MARKER}","");` +
		`var root=host.attachShadow({mode:"open"});root.innerHTML=${html};` +
		`function get(k,d){try{return localStorage.getItem(k)||d}catch(e){return d}}` +
		`host.style.setProperty("--hue",get("hue","${hue}"));` +
		// The page's data-theme (set by the head script, or by siteTheme.set) is the one source; the bar mirrors it.
		`function sync(){host.setAttribute("data-theme",document.documentElement.getAttribute("data-theme")==="dark"?"dark":"light")}` +
		`sync();new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});` +
		`root.querySelector(".theme").addEventListener("click",function(){` +
		`window.siteTheme.set(host.getAttribute("data-theme")==="dark"?"light":"dark")});` +
		`var pn=root.querySelector(".panel"),rg=pn.querySelector("input"),ou=pn.querySelector("output");` +
		`function setHue(h){host.style.setProperty("--hue",h);rg.value=h;ou.textContent=h}setHue(get("hue","${hue}"));` +
		`rg.addEventListener("input",function(){setHue(rg.value);try{localStorage.setItem("hue",rg.value)}catch(e){}});` +
		`var sb=root.querySelector(".sbtn"),pl=root.querySelector(".pal"),mn=root.querySelector(".menu"),mp=root.querySelector(".menu-panel"),sp=root.querySelector(".sp"),res=sp.querySelector(".res"),qs=root.querySelectorAll(".q"),pf=null,tm=0,panels=[sp,pn,mp];` +
		`function isOpen(p){return !p.classList.contains("closed")}` +
		`function syncAria(){sb.setAttribute("aria-expanded",String(isOpen(sp)));pl.setAttribute("aria-expanded",String(isOpen(pn)));mn.setAttribute("aria-expanded",String(isOpen(mp)))}` +
		`function open(p){panels.forEach(function(o){if(o!==p)o.classList.add("closed")});p.classList.remove("closed");syncAria()}` +
		`function shut(){panels.forEach(function(o){o.classList.add("closed")});syncAria()}` +
		`sb.addEventListener("click",function(){if(isOpen(sp))shut();else{open(sp);root.querySelector(".q2").focus()}});` +
		`pl.addEventListener("click",function(){if(isOpen(pn))shut();else open(pn)});` +
		`mn.addEventListener("click",function(){if(isOpen(mp))shut();else{open(mp);mp.querySelector("a").focus()}});` +
		`mp.addEventListener("click",function(e){if(e.target.closest&&e.target.closest("a"))shut()});` +
		`addEventListener("keydown",function(e){if(e.key==="Escape"&&panels.some(isOpen)){var back=isOpen(mp)?mn:isOpen(pn)?pl:sb;var inside=!!root.activeElement;shut();if(inside)back.focus()}});` +
		`document.addEventListener("click",function(e){if(e.composedPath().indexOf(host)<0)shut()});` +
		`function E(t){return String(t).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}` +
		`function run(q){clearTimeout(tm);tm=setTimeout(async function(){if(!q.trim()){sp.classList.add("closed");syncAria();return}open(sp);res.innerHTML="<p>Searching…</p>";` +
		`try{pf=pf||await import(${JSON.stringify(pfUrl)});var r=await pf.search(q),d=await Promise.all(r.results.slice(0,6).map(function(x){return x.data()}));` +
		`res.innerHTML=d.length?"":"<p>No results</p>";d.forEach(function(x){var a=document.createElement("a");a.href=x.url;a.innerHTML="<b>"+E((x.meta&&x.meta.title)||x.url)+"</b>"+x.excerpt;res.appendChild(a)})}` +
		`catch(e){res.innerHTML="<p>Search is only available on the built site.</p>"}},150)}` +
		`qs.forEach(function(i){i.addEventListener("input",function(){qs.forEach(function(o){if(o!==i)o.value=i.value});run(i.value)});i.addEventListener("focus",function(){if(i.value)run(i.value)})});` +
		// Mount on <html>, before <body>: the page's own body margin/padding/max-width can then never offset the bar.
		`document.documentElement.insertBefore(host,document.body)})()</script>`
	);
}

// Copyright footer for every standalone page: research, experiments and ideas here may not be reused without permission.
// Mounted on <html> after <body> (like the navbar), so page styling can't offset or hide it.
function buildLicenseScript(base: string, hue: number): string {
	const prefix = base.replace(/\/$/, "");
	const css =
		`:host{all:initial;display:block;--hue:${hue};--bg:#fff;--strong:#1d2228;--body:#3d444d;--muted:#5b626b;--accent:oklch(.5 .12 var(--hue));--hover:oklch(.95 .03 var(--hue));--line:rgba(0,0,0,.1)}` +
		":host([data-theme=dark]){--bg:oklch(.23 .015 var(--hue));--strong:rgba(255,255,255,.92);--body:#c9ced6;--muted:#a7aeb8;--accent:oklch(.75 .1 var(--hue));--hover:oklch(.3 .04 var(--hue));--line:rgba(255,255,255,.1)}" +
		// Small print, full width of the navbar card (73rem = 1168px, same rule as the navbar's header).
		"footer{box-sizing:border-box;width:min(var(--rd-footer-width,73rem),calc(100% - 2rem));margin:2rem auto 2.5rem;padding:.75rem 1rem;border:1px solid var(--line);border-radius:1rem;background:var(--bg);" +
		"font:400 0.75rem/1.5 Roboto,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--muted);overflow-wrap:anywhere}" +
		"p{margin:0;max-width:90ch}p+p{margin-top:.25rem}" +
		".copy{font-weight:600;color:var(--strong)}" +
		"a{font-weight:500;color:var(--strong);text-decoration:underline;text-underline-offset:2px;border-radius:.125rem}" +
		".power a{font-weight:400;color:inherit}" +
		"a:hover{color:var(--accent)}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
		"svg{width:.875rem;height:.875rem;flex:none;vertical-align:-.125em;margin-right:.25rem}";
	const icon =
		'<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
		'<path d="M12 3v18m7-13l3 8a5 5 0 0 1-6 0zV7"/><path d="M3 7h1a17 17 0 0 0 8-2a17 17 0 0 0 8 2h1M5 8l3 8a5 5 0 0 1-6 0zV7m2 14h10"/></svg>';
	const markup =
		`<style>${css}</style><footer>` +
		`<p class="copy">\u00a9 ${new Date().getFullYear()} ${esc(siteConfig.title)}. All rights reserved.</p>` +
		`<p>Research, experiments and ideas on this site may not be reused, copied, republished or used to train AI models without my written permission.</p>` +
		`<p>Short quotes with attribution and a link are fine.</p>` +
		`<p class="links"><a href="${esc(prefix)}/license/">${icon}License</a> &middot; <a href="${esc(prefix)}/rss.xml">RSS</a> &middot; <a href="${esc(prefix)}/sitemap-index.xml">Sitemap</a></p>` +
		`<p class="power">Powered by <a href="https://astro.build" target="_blank" rel="noopener">Astro</a> &amp; <a href="https://github.com/saicaca/fuwari" target="_blank" rel="noopener">Fuwari</a></p></footer>`;
	const html = JSON.stringify(markup).replace(/<\/(script)/gi, "<\\/$1");
	return (
		`<script ${LICENSE_MARKER}>(function(){var d=document.documentElement,h=document.createElement("div");h.setAttribute("${LICENSE_MARKER}","");` +
		`h.attachShadow({mode:"open"}).innerHTML=${html};` +
		`function get(k,v){try{return localStorage.getItem(k)||v}catch(e){return v}}` +
		`function sync(){h.setAttribute("data-theme",d.getAttribute("data-theme")==="dark"?"dark":"light");h.style.setProperty("--hue",get("hue","${hue}"))}` +
		`sync();new MutationObserver(sync).observe(d,{attributes:true,attributeFilter:["data-theme"]});addEventListener("storage",sync);` +
		`d.appendChild(h)})()</script>`
	);
}

const COMMENTS_CSS = [
	".rd-comments{box-sizing:border-box;width:100%;max-width:var(--rd-content-width,54.5rem);margin:0 auto;padding:var(--rd-gap-section,2rem) var(--rd-space-4,1rem);font:var(--rd-fs-base,.875rem)/var(--rd-lh,1.5) var(--rd-font,Roboto,system-ui,sans-serif);color:var(--rd-text)}",
	// Tabbed pages are wide and their content starts at the tab bar's left edge: the 872px column starts there too, instead
	// of sitting centred where it lines up with nothing on the page. Below the navbar width the margin is 0, as before.
	"html:has(.rd-tabbed) .rd-comments{margin-left:max(0px,calc((100% - var(--rd-navbar-width,73rem)) / 2));margin-right:auto}",
	".rd-comments__head{display:flex;align-items:center;gap:var(--rd-space-3,.75rem);margin-bottom:var(--rd-gap-block,.75rem)}",
	".rd-comments .rd-icon{display:inline-block;flex:none;width:1.25em;height:1.25em;font-size:var(--rd-fs-h2,1.2rem);fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;color:var(--rd-accent)}",
	".rd-comments h2{margin:0;font-size:var(--rd-fs-h2,1.2rem);line-height:1.3;color:var(--rd-text-strong)}",
	".rd-comments h2::before{content:none}", // the page's own section-heading accent bar (h2::before) is not for this heading
	".rd-comments__slot{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:var(--rd-space-3,.75rem);min-height:7.5rem;padding:var(--rd-space-5,1.25rem);border-radius:var(--rd-radius,1rem);background:var(--rd-card-bg);box-shadow:inset 0 0 0 1px var(--rd-line)}",
	".rd-comments__slot:focus{outline:none}",
	".rd-comments__slot:focus-visible,.rd-comments__load:focus-visible{outline:2px solid var(--rd-accent);outline-offset:2px}",
	".rd-comments__note{margin:0;color:var(--rd-text-muted);font-size:var(--rd-fs-sm,.8125rem)}",
	".rd-comments__load{display:inline-flex;align-items:center;min-height:2.5rem;padding:0 var(--rd-space-4,1rem);border:0;border-radius:var(--rd-radius-sm,.5rem);background:var(--rd-btn-bg);color:var(--rd-accent-ink,var(--rd-accent));font:500 var(--rd-fs-base,.875rem) var(--rd-font,Roboto,system-ui,sans-serif);cursor:pointer}",
	".rd-comments__load:hover{background:var(--rd-btn-bg-hover)}",
	// No animation here, so nothing needs a reduced-motion rule.
].join("");

// Comments for reports, live experiments and ideas: the same giscus repo and category as the posts (src/config.ts).
// Nothing reaches giscus.app until the reader presses "Load comments"; then the client script is added, like the posts' one.
function commentsFor(html: string, urlPath: string): string {
	if (!COMMENTS_PAGE.test(urlPath) || html.includes(COMMENTS_MARKER) || COMMENTS_OPT_OUT.test(html)) return "";
	return COMMENTS;
}

function buildComments(): string {
	const { enable, repo, repoId, category, categoryId } = commentConfig;
	if (!enable || !repo || !repoId || !categoryId) return "";
	const cfg = JSON.stringify({ repo, repoId, category, categoryId }).replace(/</g, "\\u003c");
	// Lucide message-square (ISC). Its own symbol, so the sprite check finds it in the page itself.
	const icon =
		'<svg style="display:none" aria-hidden="true"><symbol id="i-message-square" viewBox="0 0 24 24">' +
		'<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/></symbol></svg>';
	const script =
		`(function(){var C=${cfg};var slot=document.getElementById("rd-comments-slot");var btn=slot&&slot.querySelector(".rd-comments__load");if(!btn)return;` +
		`function theme(){return document.documentElement.getAttribute("data-theme")==="dark"?"dark":"light"}` +
		`function sync(){var f=slot.querySelector("iframe.giscus-frame");if(f&&f.contentWindow)f.contentWindow.postMessage({giscus:{setConfig:{theme:theme()}}},"https://giscus.app")}` +
		`new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});` +
		`btn.addEventListener("click",function(){var s=document.createElement("script");s.src="https://giscus.app/client.js";s.async=true;s.crossOrigin="anonymous";` +
		`s.setAttribute("data-repo",C.repo);s.setAttribute("data-repo-id",C.repoId);s.setAttribute("data-category",C.category);s.setAttribute("data-category-id",C.categoryId);` +
		`s.setAttribute("data-mapping","pathname");s.setAttribute("data-strict","0");s.setAttribute("data-reactions-enabled","1");s.setAttribute("data-emit-metadata","0");` +
		`s.setAttribute("data-input-position","top");s.setAttribute("data-theme",theme());s.setAttribute("data-lang","en");` +
		`btn.remove();slot.appendChild(s);slot.focus()})})();`;
	// Own copy of the styles, scoped to .rd-comments, with rd-* tokens only: self-contained exports inline research.css
	// verbatim (css-canonical), so a rule added there would not reach them. Dimensions fall back to the token values.
	return (
		`<style>${COMMENTS_CSS}</style>${icon}<section class="rd-comments" ${COMMENTS_MARKER} data-pagefind-ignore aria-labelledby="rd-comments-title">` +
		`<div class="rd-comments__head"><svg class="rd-icon" aria-hidden="true"><use href="#i-message-square"/></svg><h2 id="rd-comments-title">Comments</h2></div>` +
		`<div class="rd-comments__slot" id="rd-comments-slot" tabindex="-1">` +
		`<p class="rd-comments__note">Comments are GitHub Discussions, shown through giscus. Nothing is loaded from GitHub until you press the button.</p>` +
		`<button type="button" class="rd-btn rd-comments__load">Load comments</button></div>` +
		`<script>${script}</script></section>`
	);
}

const COMMENTS = buildComments();
