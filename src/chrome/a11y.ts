export const A11Y_MARKER = "data-site-a11y";

// Keyboard access for scrollable content (WCAG 2.1.1). A wide table, figure or code block scrolls with the
// mouse but not the keyboard unless it is focusable. This makes every genuinely scrollable region in the
// page's own document focusable (tabindex=0). It is injected into every standalone page (reports,
// experiments, ideas, design-system) — including compiled exports that don't load rd.js — so the fix lives
// in one shared place instead of each page. Only regions that actually overflow get a tab stop; a
// MutationObserver, plus re-runs on load, resize and font load, keep it true if content reflows later
// (e.g. a chart renders after load). The observer watches childList only, not attributes: the expnav
// scroll-spy toggles classes on every page scroll, and reacting to that would force reflows on heavy
// pages and race the layout checks. New content adds nodes, which is the only reflow case that matters.
export function buildA11yScript(): string {
	return (
		`<script ${A11Y_MARKER}>(function(){` +
		`var SEL=".rd-table-wrap,.rd-figure,.rd-prose pre,.rd-prose .katex-display,pre,table";` +
		`function scrollable(el){return el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1}` +
		`function run(){document.querySelectorAll(SEL).forEach(function(el){` +
		`if(!scrollable(el))return;` +
		`if(el.getAttribute("tabindex")===null)el.setAttribute("tabindex","0")})}` +
		`run();` +
		`if(window.MutationObserver){var mo=new MutationObserver(function(){run()});` +
		`mo.observe(document.body,{childList:true,subtree:true});}` +
		`addEventListener("resize",run);` +
		`addEventListener("load",run);` +
		`if(document.fonts&&document.fonts.ready)document.fonts.ready.then(run).catch(function(){});` +
		`})()</script>`
	);
}
