import { readFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AstroIntegration } from "astro";
import { navBarConfig, siteConfig } from "../config";
import { LinkPreset } from "../types/config";

// Same Roboto Bold the main site ships, inlined so link widths (and so positions) match exactly.
const ROBOTO_700 = readFileSync(path.resolve("node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff2")).toString("base64");
const ROBOTO_400 = readFileSync(path.resolve("node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff2")).toString("base64");
const face = (w: number, b64: string) => `@font-face{font-family:"RobotoNav";font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
const FONT_FACE = face(700, ROBOTO_700) + face(400, ROBOTO_400);

const MARKER = "data-site-navbar";
const LICENSE_MARKER = "data-site-license";
const OPT_OUT = /<meta[^>]+name=["']site-navbar["'][^>]+content=["']off["']/i;

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

	return {
		name: "standalone-header",
		hooks: {
			"astro:config:done": ({ config }) => {
				publicDir = fileURLToPath(config.publicDir);
				base = config.base;
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
						res.end(transform(html, script, client, buildLicenseScript(base)));
					} catch {
						next();
					}
				});
			},
			"astro:build:done": async ({ dir }) => {
				const outDir = fileURLToPath(dir);
				const script = buildScript(navItems(base), siteConfig.title, siteConfig.themeColor.hue);
				const licenseScript = buildLicenseScript(base);
				for (const rel of await htmlFiles(publicDir)) {
					const target = path.join(outDir, rel);
					const html = await readFile(target, "utf8");
					await writeFile(target, transform(html, script, "", licenseScript));
				}
			},
		},
	};
}

/** Navbar + meta fixes for one standalone HTML document (shared by build and dev). `extra` is appended before </body>. */
function transform(html: string, script: string, extra = "", footer = ""): string {
	const parts = [html.includes(MARKER) || OPT_OUT.test(html) ? "" : script, html.includes(LICENSE_MARKER) ? "" : footer, extra].join("");
	if (!parts) return html;
	const at = html.lastIndexOf("</body>");
	return ensureMeta(at === -1 ? html + parts : html.slice(0, at) + parts + html.slice(at));
}

// Exported pages often lose these tags: without a charset, "·" renders as "Â·"; without a viewport,
// phones show a zoomed-out desktop page. Prepend whichever is missing (valid at the very start of the file).
function ensureMeta(html: string): string {
	const head = html.slice(0, 4096);
	const missing: string[] = [];
	if (!/<meta[^>]+charset=/i.test(head)) missing.push('<meta charset="utf-8">');
	if (!/<meta[^>]+name=["']viewport["']/i.test(html)) missing.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
	return missing.length ? missing.join("") + html : html;
}

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

const CSS = `
:host{all:initial;display:block;--hue:250;--bg:#fff;--fg:#2b2b2e;--muted:#6b6b72;--line:rgba(0,0,0,.08);--accent:oklch(.55 .15 var(--hue));--prime:oklch(.70 .14 var(--hue));--hover:oklch(.95 .03 var(--hue))}
:host([data-theme=dark]){--bg:oklch(.2 .015 var(--hue));--fg:rgba(255,255,255,.9);--muted:rgba(255,255,255,.55);--line:rgba(255,255,255,.12);--accent:oklch(.75 .14 var(--hue));--prime:oklch(.75 .14 var(--hue));--hover:oklch(.3 .04 var(--hue))}
header{box-sizing:border-box;display:flex;align-items:center;gap:12px;height:72px;width:min(100%,1168px);margin:0 auto;padding:0 16px;background:#fff;color:var(--fg);border-radius:0 0 16px 16px;font:700 16px/1 RobotoNav,Roboto,system-ui,-apple-system,"Segoe UI",sans-serif}
:host([data-theme=dark]) header{background:oklch(.23 .015 var(--hue))}
a,button{color:inherit;text-decoration:none;font:inherit;cursor:pointer}
.brand{display:inline-flex;align-items:center;gap:8px;height:52px;padding:0 20px;border-radius:8px;color:var(--prime);white-space:nowrap}
.brand svg{width:28px;height:28px;fill:currentColor;stroke:none}
nav{display:flex;align-items:center;gap:0;min-width:0;flex:0 1 auto;justify-content:flex-start;margin-left:34px;overflow-x:auto;white-space:nowrap;scrollbar-width:none}
nav::-webkit-scrollbar{display:none}
.brand{flex:none}
.end{display:flex;flex:none;margin-left:auto;align-items:center}
.search{display:none;align-items:center;gap:8px;width:160px;height:44px;margin-right:8px;padding:0 12px;box-sizing:border-box;border-radius:8px;background:oklch(.95 .01 var(--hue));color:var(--muted);font-weight:400;font-size:14px}
:host([data-theme=dark]) .search{background:oklch(.3 .035 var(--hue))}
.search svg{width:20px;height:20px;flex:none}
.q{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--fg);font:400 14px/1 inherit;font-family:inherit}
.q::placeholder{color:var(--muted)}
.sbtn{display:inline-flex}
@media(min-width:1024px){.sbtn{display:none}.q2{display:none}}
.sp{position:absolute;top:76px;right:16px;width:min(30rem,calc(100% - 32px));max-height:70vh;overflow:auto;padding:12px;border-radius:16px;background:var(--bg);box-shadow:0 8px 32px rgba(0,0,0,.18);z-index:1}
.sp[hidden]{display:none}
.q2{box-sizing:border-box;width:100%;height:44px;padding:0 12px;margin-bottom:8px;border-radius:8px;background:oklch(.95 .01 var(--hue))}
:host([data-theme=dark]) .q2{background:oklch(.3 .035 var(--hue))}
.res a{display:block;padding:10px 12px;border-radius:8px;font-weight:400;font-size:14px;line-height:1.4}
.res a:hover{background:var(--hover)}
.res b{display:block;color:var(--prime);font-size:15px}
.res mark{background:transparent;color:var(--prime);font-weight:700}
.res p{margin:0;padding:8px 12px;color:var(--muted);font-size:14px}
@media(min-width:1024px){.search{display:flex}}
.ext{width:14px;height:14px;margin-left:4px;opacity:.25}
header{position:relative}
.panel{position:absolute;top:76px;right:16px;width:260px;padding:16px;border-radius:16px;background:var(--bg);box-shadow:0 8px 32px rgba(0,0,0,.18);font-size:14px;z-index:1}
.panel[hidden]{display:none}
.panel label{display:flex;justify-content:space-between;margin-bottom:12px}
.panel input{width:100%;accent-color:var(--prime)}
nav a,button{display:inline-flex;align-items:center;gap:4px;height:44px;padding:0 20px;border:0;border-radius:8px;background:transparent}
nav a:hover,button:hover,.brand:hover{background:var(--hover);color:var(--accent)}
button{width:44px;flex:none;justify-content:center;padding:0}
svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ni{display:none}
:host(:not([data-theme=dark])) .moon,:host([data-theme=dark]) .sun{display:none}
@media(max-width:560px){nav{margin-left:0}header{gap:6px;padding:0 8px;height:63px}nav a,.brand{padding:0 10px}}
`;

// Lucide (ISC) icon bodies, copied from @iconify-json/lucide. Inline so standalone pages make no icon requests;
// stroke/fill come from the `svg` rule above.
const LUCIDE = {
	house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
	archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8m-10 4h4"/>',
	user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
	"flask-conical": '<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2M6.453 15h11.094M8.5 2h7"/>',
	microscope: '<path d="M6 18h8M3 22h18m-7 0a7 7 0 1 0 0-14h-1m-4 6h2m-2-2a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Zm3-6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/>',
	github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5c.08-1.25-.27-2.48-1-3.5c.28-1.15.28-2.35 0-3.5c0 0-1 0-3 1.5c-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5c-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
	moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
} as const;

// Icon per navbar link name (same names as navBarConfig / presets).
const NAV_ICONS: Record<string, keyof typeof LUCIDE> = {
	Home: "house",
	Archive: "archive",
	About: "user",
	Experiments: "flask-conical",
	Research: "microscope",
	GitHub: "github",
};

const svgIcon = (name: keyof typeof LUCIDE, cls: string) =>
	`<svg class="${cls}" viewBox="0 0 24 24">${LUCIDE[name]}</svg>`;

const HOME = '<svg viewBox="0 0 24 24"><path d="M6 19h3v-6h6v6h3v-9l-6-4.5L6 10zm-2 2V9l8-6l8 6v12h-7v-6h-2v6zm8-8.75"/></svg>';

const EXT = '<svg class="ext" viewBox="0 0 24 24"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
const PALETTE = '<svg viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>';

const ICONS = svgIcon("sun", "sun") + svgIcon("moon", "moon");

// Script (not markup) so it works for HTML fragments without <body>; shadow DOM isolates it from page CSS.
function buildScript(items: NavItem[], title: string, hue: number): string {
	const links = items
		.map((i) => {
			const icon = NAV_ICONS[i.name];
			const lead = icon ? svgIcon(icon, "ni") : "";
			return `<a href="${esc(i.url)}"${i.external ? ' target="_blank" rel="noopener"' : ""}>${lead}${esc(i.name)}${i.external ? EXT : ""}</a>`;
		})
		.join("");
	const markup =
		`<style>${CSS}</style><header><a class="brand" href="${esc(items[0]?.url ?? "/")}">${HOME}${esc(title)}</a>` +
		`<nav>${links}</nav><span class="end"><label class="search">${SEARCH}<input class="q" type="search" placeholder="Search" aria-label="Search" autocomplete="off"></label><button type="button" class="sbtn" aria-label="Search">${SEARCH}</button>` +
		`<button type="button" class="pal" aria-label="Display settings">${PALETTE}</button><button type="button" class="theme" aria-label="Toggle light/dark theme">${ICONS}</button></span>` +
		`<div class="sp" hidden><input class="q q2" type="search" placeholder="Search" aria-label="Search" autocomplete="off"><div class="res"></div></div><div class="panel" hidden><label>Theme color <output></output></label><input type="range" min="0" max="360" aria-label="Theme color"></div></header>`;
	const pfUrl = (items[0]?.url ?? "/") + "pagefind/pagefind.js";
	const html = JSON.stringify(markup).replace(/<\/(script)/gi, "<\\/$1");

	return (
		`<script ${MARKER}>(function(){` +
		`var f=document.createElement("style");f.textContent=${JSON.stringify(FONT_FACE)};document.documentElement.appendChild(f);` +
		`var host=document.createElement("div");host.setAttribute("${MARKER}","");` +
		`var root=host.attachShadow({mode:"open"});root.innerHTML=${html};` +
		`function get(k,d){try{return localStorage.getItem(k)||d}catch(e){return d}}` +
		`function apply(t){document.documentElement.setAttribute("data-theme",t);host.setAttribute("data-theme",t)}` +
		`host.style.setProperty("--hue",get("hue","${hue}"));apply(get("theme","light"));` +
		`root.querySelector(".theme").addEventListener("click",function(){` +
		`var t=host.getAttribute("data-theme")==="dark"?"light":"dark";` +
		`try{localStorage.setItem("theme",t)}catch(e){}apply(t)});` +
		`var pn=root.querySelector(".panel"),rg=pn.querySelector("input"),ou=pn.querySelector("output");` +
		`function setHue(h){host.style.setProperty("--hue",h);rg.value=h;ou.textContent=h}setHue(get("hue","${hue}"));` +
		`root.querySelector(".pal").addEventListener("click",function(){pn.hidden=!pn.hidden});` +
		`rg.addEventListener("input",function(){setHue(rg.value);try{localStorage.setItem("hue",rg.value)}catch(e){}});` +
		`var sp=root.querySelector(".sp"),res=sp.querySelector(".res"),qs=root.querySelectorAll(".q"),pf=null,tm=0;` +
		`function E(t){return String(t).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}` +
		`function run(q){clearTimeout(tm);tm=setTimeout(async function(){if(!q.trim()){sp.hidden=true;return}sp.hidden=false;res.innerHTML="<p>Searching…</p>";` +
		`try{pf=pf||await import(${JSON.stringify(pfUrl)});var r=await pf.search(q),d=await Promise.all(r.results.slice(0,6).map(function(x){return x.data()}));` +
		`res.innerHTML=d.length?d.map(function(x){return'<a href="'+E(x.url)+'"><b>'+E((x.meta&&x.meta.title)||x.url)+'</b>'+x.excerpt+'</a>'}).join(""):"<p>No results</p>"}` +
		`catch(e){res.innerHTML="<p>Search is only available on the built site.</p>"}},150)}` +
		`qs.forEach(function(i){i.addEventListener("input",function(){qs.forEach(function(o){if(o!==i)o.value=i.value});run(i.value)});i.addEventListener("focus",function(){if(i.value)run(i.value)})});` +
		`root.querySelector(".sbtn").addEventListener("click",function(){pn.hidden=true;sp.hidden=!sp.hidden;if(!sp.hidden){var q2=sp.querySelector(".q2");q2.focus()}});` +
		`root.querySelector(".pal").addEventListener("click",function(){sp.hidden=true});` +
		`addEventListener("keydown",function(e){if(e.key==="Escape"){sp.hidden=true;pn.hidden=true}});` +
		`document.addEventListener("click",function(e){if(e.composedPath().indexOf(host)<0){sp.hidden=true;pn.hidden=true}});` +
		`addEventListener("storage",function(e){if(e.key==="theme")apply(e.newValue||"light")});` +
		// Mount on <html>, before <body>: the page's own body margin/padding/max-width can then never offset the bar.
		`document.documentElement.insertBefore(host,document.body)})()</script>`
	);
}

// Copyright footer for every standalone page: research here may not be reused without permission.
// Mounted on <html> after <body> (like the navbar), so page styling can't offset or hide it.
function buildLicenseScript(base: string): string {
	const prefix = base.replace(/\/$/, "");
	const css =
		":host{all:initial;display:block}" +
		"footer{box-sizing:border-box;padding:16px max(16px,calc((100% - 1200px)/2));background:#15212b;color:rgba(255,255,255,.8);" +
		"font:400 13px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}" +
		"strong{color:#fff}a{color:#9ec5ff}";
	const markup =
		`<style>${css}</style><footer><strong>\u00a9 ${new Date().getFullYear()} ${esc(siteConfig.title)}. All rights reserved.</strong> ` +
		`Research and experiments on this site may not be reused, copied, republished or used to train models without my written permission. ` +
		`Short quotes with attribution and a link are fine. <a href="${esc(prefix)}/license/">License</a></footer>`;
	const html = JSON.stringify(markup).replace(/<\/(script)/gi, "<\\/$1");
	return (
		`<script ${LICENSE_MARKER}>(function(){var h=document.createElement("div");h.setAttribute("${LICENSE_MARKER}","");` +
		`h.attachShadow({mode:"open"}).innerHTML=${html};document.documentElement.appendChild(h)})()</script>`
	);
}
