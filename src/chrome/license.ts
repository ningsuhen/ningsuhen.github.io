import { siteConfig } from "../config";
import { esc } from "./util";

export const LICENSE_MARKER = "data-site-license";

// Copyright footer for every standalone page: research, playground demos and ideas here may not be reused without permission.
// Mounted on <html> after <body> (like the navbar), so page styling can't offset or hide it.
export function buildLicenseScript(base: string): string {
	const hue = siteConfig.themeColor.hue;
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
		`<p class="copy">© ${new Date().getFullYear()} ${esc(siteConfig.title)}. All rights reserved.</p>` +
		`<p>Research, playground demos and ideas on this site may not be reused, copied, republished or used to train AI models without my written permission.</p>` +
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
