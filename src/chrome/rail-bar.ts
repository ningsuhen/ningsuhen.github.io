export const RAIL_BAR_MARKER = "data-site-rail-bar";

// The "On this page" rail below 1536px: one sticky line, "On this page" and the section being read, with the list
// opening over the content (CSS: layout.css, "Narrow, with JS"). Without it the open list stuck under the tab bar
// and took a quarter of a desktop screen and 40% of a phone's. It is injected into every standalone page that has a
// rail, including compiled exports that keep their own inline rail scripts and never load rd.js, so the fix lives in
// one shared place. It only opens and closes the disclosure (open from 1536px up, where the CSS hides the summary)
// and marks one current entry (.is-current, plus .rd-toc__current in the summary); the pages' own scroll-spies keep
// their .visible range and indicator for the wide rail. Current = the last section whose top has crossed a line 24px
// under the rail; at the page bottom the last section wins (the expnav scroll-spy's rule). The list closes on a link
// click, Escape (focus back on the summary), a pointer down outside it, and when its tab is hidden.
export function buildRailBarScript(): string {
	return (
		`<script ${RAIL_BAR_MARKER}>(function(){` +
		`var narrow=matchMedia("(max-width: 1535px)"),bars=[],ticking=false;` +
		`document.querySelectorAll(".rd-toc").forEach(function(nav){` +
		`var d=nav.querySelector("details"),s=d&&d.querySelector("summary");if(!s)return;` +
		`for(var n=s.firstChild;n;n=n.nextSibling)if(n.nodeType===3&&n.nodeValue.trim()){var l=document.createElement("span");l.className="rd-toc__label";s.insertBefore(l,n);l.appendChild(n);break}` +
		`var cur=document.createElement("span");cur.className="rd-toc__current";cur.setAttribute("aria-hidden","true");s.appendChild(cur);` +
		`var links=[].slice.call(nav.querySelectorAll('a[href^="#"]'));` +
		`var secs=links.map(function(a){return document.getElementById(decodeURIComponent(a.hash.slice(1)))});` +
		`bars.push({nav:nav,d:d,s:s,cur:cur,links:links,secs:secs,shown:-1});` +
		`nav.classList.add("is-bar");` +
		`nav.addEventListener("click",function(e){if(narrow.matches&&e.target.closest&&e.target.closest("a"))d.open=false})});` +
		`if(!bars.length)return;` +
		`function layout(){bars.forEach(function(b){b.d.open=!narrow.matches;b.shown=-1})}` +
		`function show(b,i){b.shown=i;b.links.forEach(function(a,k){a.classList.toggle("is-current",k===i)});b.cur.textContent="";var a=b.links[i];if(!a)return;` +
		`var badge=a.querySelector(".rd-toc__badge"),t=document.createElement("span");if(badge)b.cur.appendChild(badge.cloneNode(true));` +
		`t.className="rd-toc__text";t.textContent=(a.querySelector(".rd-toc__text")||a).textContent;b.cur.appendChild(t)}` +
		`function update(){ticking=false;if(!narrow.matches)return;` +
		`var end=innerHeight+scrollY>=document.documentElement.scrollHeight-2;` +
		`bars.forEach(function(b){if(!b.nav.offsetParent){b.d.open=false;return}` +
		`var line=b.nav.getBoundingClientRect().bottom+24,i=0;` +
		`if(end)i=b.secs.length-1;else b.secs.forEach(function(sec,k){if(sec&&sec.getBoundingClientRect().top<=line)i=k});` +
		`if(i!==b.shown)show(b,i)})}` +
		`function schedule(){if(!ticking){ticking=true;requestAnimationFrame(update)}}` +
		`addEventListener("scroll",schedule,{passive:true});addEventListener("resize",schedule);` +
		`narrow.addEventListener("change",function(){layout();schedule()});` +
		`document.addEventListener("pointerdown",function(e){if(narrow.matches)bars.forEach(function(b){if(b.d.open&&!b.nav.contains(e.target))b.d.open=false})});` +
		`document.addEventListener("keydown",function(e){if(e.key==="Escape"&&narrow.matches)bars.forEach(function(b){if(b.d.open){b.d.open=false;b.s.focus()}})});` +
		`var mo=window.MutationObserver&&new MutationObserver(schedule);` +
		`if(mo)bars.forEach(function(b){var p=b.nav.closest(".rd-tabpanel,[role=tabpanel]");if(p)mo.observe(p,{attributes:true,attributeFilter:["hidden"]})});` +
		`layout();update();` +
		`})()</script>`
	);
}
