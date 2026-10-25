import { commentConfig } from "../config";

export const COMMENTS_MARKER = "data-site-comments";
export const COMMENTS_OPT_OUT = /<meta[^>]+name=["']rd-comments["'][^>]+content=["']off["']/i;
// Reports, playground demos and ideas get comments (one folder deep, e.g. /research/<slug>/). The design-system pages don't.
export const COMMENTS_PAGE = /^\/(research|playground|ideas)\/[^/]+\/$/;

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

// Comments for reports, playground demos and ideas: the same giscus repo and category as the posts (src/config.ts).
// Nothing reaches giscus.app until the reader presses "Load comments"; then the client script is added, like the posts' one.
export function commentsFor(html: string, urlPath: string): string {
	if (!COMMENTS_PAGE.test(urlPath) || html.includes(COMMENTS_MARKER) || COMMENTS_OPT_OUT.test(html)) return "";
	return buildComments();
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
