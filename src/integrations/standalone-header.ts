import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AstroIntegration } from "astro";
import { navBarConfig, siteConfig } from "../config";
import { LinkPreset } from "../types/config";

const MARKER = "data-site-navbar";
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
			"astro:build:done": async ({ dir }) => {
				const outDir = fileURLToPath(dir);
				const script = buildScript(navItems(base), siteConfig.title, siteConfig.themeColor.hue);
				for (const rel of await htmlFiles(publicDir)) {
					const target = path.join(outDir, rel);
					const html = await readFile(target, "utf8");
					if (html.includes(MARKER) || OPT_OUT.test(html)) continue;
					const at = html.lastIndexOf("</body>");
					const withBar = at === -1 ? html + script : html.slice(0, at) + script + html.slice(at);
					await writeFile(target, ensureMeta(withBar));
				}
			},
		},
	};
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
:host{all:initial;display:block;--hue:250;--bg:#fff;--fg:#2b2b2e;--muted:#6b6b72;--line:rgba(0,0,0,.08);--accent:oklch(.55 .15 var(--hue));--hover:oklch(.95 .03 var(--hue))}
:host([data-theme=dark]){--bg:oklch(.2 .015 var(--hue));--fg:rgba(255,255,255,.9);--muted:rgba(255,255,255,.55);--line:rgba(255,255,255,.12);--accent:oklch(.75 .14 var(--hue));--hover:oklch(.3 .04 var(--hue))}
header{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:12px;height:56px;padding:0 max(16px,calc((100% - 1200px)/2));background:var(--bg);color:var(--fg);border-bottom:1px solid var(--line);font:500 15px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a,button{color:inherit;text-decoration:none;font:inherit;cursor:pointer}
.brand{font-weight:700;font-size:18px;color:var(--accent);white-space:nowrap}
nav{display:flex;align-items:center;gap:2px;min-width:0}
nav a,button{display:inline-flex;align-items:center;gap:4px;height:40px;padding:0 12px;border:0;border-radius:10px;background:transparent}
nav a:hover,button:hover{background:var(--hover);color:var(--accent)}
button{width:40px;justify-content:center;padding:0}
svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
:host(:not([data-theme=dark])) .moon,:host([data-theme=dark]) .sun{display:none}
@media(max-width:560px){nav a{padding:0 8px}.brand{font-size:16px}}
`;

const ICONS =
	'<svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' +
	'<svg class="moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

// Script (not markup) so it works for HTML fragments without <body>; shadow DOM isolates it from page CSS.
function buildScript(items: NavItem[], title: string, hue: number): string {
	const links = items
		.map((i) => `<a href="${esc(i.url)}"${i.external ? ' target="_blank" rel="noopener"' : ""}>${esc(i.name)}</a>`)
		.join("");
	const markup =
		`<style>${CSS}</style><header><a class="brand" href="${esc(items[0]?.url ?? "/")}">${esc(title)}</a>` +
		`<nav>${links}<button type="button" aria-label="Toggle light/dark theme">${ICONS}</button></nav></header>`;
	const html = JSON.stringify(markup).replace(/<\/(script)/gi, "<\\/$1");

	return (
		`<script ${MARKER}>(function(){` +
		`var host=document.createElement("div");host.setAttribute("${MARKER}","");` +
		`var root=host.attachShadow({mode:"open"});root.innerHTML=${html};` +
		`function get(k,d){try{return localStorage.getItem(k)||d}catch(e){return d}}` +
		`function apply(t){document.documentElement.setAttribute("data-theme",t);host.setAttribute("data-theme",t)}` +
		`host.style.setProperty("--hue",get("hue","${hue}"));apply(get("theme","light"));` +
		`root.querySelector("button").addEventListener("click",function(){` +
		`var t=host.getAttribute("data-theme")==="dark"?"light":"dark";` +
		`try{localStorage.setItem("theme",t)}catch(e){}apply(t)});` +
		`addEventListener("storage",function(e){if(e.key==="theme")apply(e.newValue||"light")});` +
		`document.body.insertBefore(host,document.body.firstChild)})()</script>`
	);
}
