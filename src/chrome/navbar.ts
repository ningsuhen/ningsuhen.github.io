import { readFileSync } from "node:fs";
import path from "node:path";
import { navBarConfig, siteConfig } from "../config";
import { LinkPreset } from "../types/config";
import { esc } from "./util";

// Same Roboto Bold the main site ships, inlined so link widths (and so positions) match exactly.
const ROBOTO_700 = readFileSync(path.resolve("node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff2")).toString("base64");
const ROBOTO_400 = readFileSync(path.resolve("node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff2")).toString("base64");
const face = (w: number, b64: string) => `@font-face{font-family:"RobotoNav";font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
const FONT_FACE = face(700, ROBOTO_700) + face(400, ROBOTO_400);

export const MARKER = "data-site-navbar";

type NavItem = { name: string; url: string; external: boolean };

// Mirrors src/constants/link-presets.ts (that file pulls in i18n through path aliases,
// which the Astro config loader can't resolve).
const PRESETS: Record<LinkPreset, { name: string; url: string }> = {
	[LinkPreset.Home]: { name: "Home", url: "/" },
	[LinkPreset.Archive]: { name: "Archive", url: "/archive/" },
	[LinkPreset.About]: { name: "About", url: "/about/" },
};

// Sizes are em of the header's own font size, which is the main site's root size: 16px from 768px, 14px below
// (html text-[14px] md:text-[16px]). A Tailwind rem on the main navbar is the same number of em here, so every
// measure matches at every width. Breakpoints: links and the search field from 1024px (lg), like the main bar.
// Colours: --ink is text (brand, hover, results; = main --btn-content), --prime only fills and icons (= main --primary).
const CSS = `
:host{all:initial;display:block;position:sticky;top:0;z-index:1000;--hue:250;--u:16px;--card:#fff;--float:#fff;--link:rgba(0,0,0,.75);--prime:oklch(.70 .14 var(--hue));--ink:oklch(.5 .12 var(--hue));--hover:oklch(.95 .025 var(--hue));--active:oklch(.98 .01 var(--hue));--field:rgba(0,0,0,.04);--field-hover:rgba(0,0,0,.06);--ph:rgba(0,0,0,.56);--ico:rgba(0,0,0,.3);--muted:#6b6b72}
@media(max-width:767.98px){:host{--u:14px}}
:host([data-theme=dark]){--card:oklch(.23 .015 var(--hue));--float:oklch(.19 .015 var(--hue));--link:rgba(255,255,255,.75);--prime:oklch(.75 .14 var(--hue));--ink:oklch(.75 .1 var(--hue));--hover:oklch(.30 .035 var(--hue));--active:oklch(.27 .025 var(--hue));--field:rgba(255,255,255,.05);--field-hover:rgba(255,255,255,.10);--ph:rgba(255,255,255,.5);--ico:rgba(255,255,255,.3);--muted:rgba(255,255,255,.55)}
header{box-sizing:border-box;position:relative;display:flex;align-items:center;justify-content:space-between;height:4.5em;width:min(100%,75em);margin:0 auto;padding:0 1em;background:var(--card);color:var(--link);border-radius:0 0 1em 1em;font:700 var(--u)/1 RobotoNav,Roboto,system-ui,-apple-system,"Segoe UI",sans-serif}
a,button{color:inherit;text-decoration:none;font:inherit;cursor:pointer;background:none;border:0;position:relative;isolation:isolate;transition:background-color .2s ease-out,color .15s ease-out,transform .15s ease-out}
.brand,nav a,.end button,.menu-panel a{display:inline-flex;align-items:center;justify-content:center;border-radius:.5em;white-space:nowrap}
.brand::before,nav a::before,.end button::before,.menu-panel a::before{content:"";position:absolute;inset:0;border-radius:inherit;z-index:-1;background:transparent;transform:scale(.85);transition:transform .2s ease-out,background-color .2s ease-out}
.brand:hover::before,nav a:hover::before,.end button:hover::before,.menu-panel a:hover::before{background:var(--hover);transform:scale(1)}
.brand:active::before,nav a:active::before,.end button:active::before,.menu-panel a:active::before{background:var(--active)}
a:hover,button:hover{color:var(--ink)}
/* The brand shrinks and wraps when the links need the room, as the main navbar's does (measured parity at 1024px). */
.brand{height:3.25em;padding:0 1.25em;color:var(--ink);font-weight:700;white-space:normal;text-align:center}
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
.res b{display:block;color:var(--ink);font-size:.9375em}
.res .kind{display:inline-block;margin-bottom:.25em;font-size:.625em;font-weight:700;letter-spacing:.02em;padding:.125em .5em;border-radius:999px;background:var(--field-hover);color:var(--muted)}
.res mark{background:transparent;color:var(--ink);font-weight:700}
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
export const HEAD_CSS = FONT_FACE + "html{overflow-y:scroll;scrollbar-width:none}html::-webkit-scrollbar{display:none}";

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

// Script (not markup) so it works for HTML fragments without <body>; shadow DOM isolates it from page CSS.
export function buildScript(base: string): string {
	const items = navItems(base);
	const hue = siteConfig.themeColor.hue;
	const title = siteConfig.title;
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
		`function setHue(h){host.style.setProperty("--hue",h);document.documentElement.style.setProperty("--hue",h);rg.value=h;ou.textContent=h}setHue(get("hue","${hue}"));` +
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
		`function kind(u){var p=u||"";if(p.indexOf("/research/")===0)return"Report";if(p.indexOf("/playground/")===0)return"Live demo";if(p.indexOf("/ideas/")===0)return"Idea";return""}` +
		`function run(q){clearTimeout(tm);tm=setTimeout(async function(){if(!q.trim()){sp.classList.add("closed");syncAria();return}open(sp);res.innerHTML="<p>Searching…</p>";` +
		`try{pf=pf||await import(${JSON.stringify(pfUrl)});var r=await pf.search(q),d=await Promise.all(r.results.slice(0,6).map(function(x){return x.data()}));` +
		`res.innerHTML=d.length?"":"<p>No results</p>";d.forEach(function(x){var a=document.createElement("a");a.href=x.url;var k=kind(x.url);a.innerHTML=(k?'<span class="kind">'+E(k)+'</span>':"")+"<b>"+E((x.meta&&x.meta.title)||x.url)+"</b>"+x.excerpt;res.appendChild(a)})}` +
		`catch(e){res.innerHTML="<p>Search is only available on the built site.</p>"}},150)}` +
		`qs.forEach(function(i){i.addEventListener("input",function(){qs.forEach(function(o){if(o!==i)o.value=i.value});run(i.value)});i.addEventListener("focus",function(){if(i.value)run(i.value)})});` +
		// Mount on <html>, before <body>: the page's own body margin/padding/max-width can then never offset the bar.
		`document.documentElement.insertBefore(host,document.body)})()</script>`
	);
}
