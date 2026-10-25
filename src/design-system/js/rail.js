// rd-toc: the "On this page" rail, one per tab panel. A port of the main post page's TOC.
// Scroll-spy: every section is observed (threshold 0). Each section that intersects the viewport
// is highlighted (.visible), and the dashed indicator spans the highlighted run. The rail scrolls
// to keep the highlighted entries in view. Wide only (1536px+): the rail is open and the indicator
// shows; narrow: the disclosure, with the highlighted entries filled.
//
// Opt-in: a page puts data-rd="rail" on its <nav class="rd-toc">. rd.js (index.js) mounts this on
// every such nav. Pages that keep their own inline rail omit it, so nothing doubles up. The page
// still works with no JS: every rail link shows.

// Pure core: given the per-link active flags, the contiguous run of active entries that is adjacent
// to the tail (after skipping trailing inactive links). This is the run the indicator spans and the
// links that get .visible. Returns { min, max } (inclusive) or null when nothing is active.
export function activeRun(active) {
	let i = active.length - 1;
	let min = active.length - 1, max = -1;
	while (i >= 0 && !active[i]) i--;
	while (i >= 0 && active[i]) { min = Math.min(min, i); max = Math.max(max, i); i--; }
	return min > max ? null : { min, max };
}

// Mount the rail on one .rd-toc. Returns a dispose() that removes the listeners and observer.
export function mountRail(nav) {
	const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
	const indicator = nav.querySelector(".rd-toc__indicator");
	const sections = [];
	const index = new Map();
	const active = [];
	let anchorNavTarget = null;
	links.forEach((a, i) => {
		const sec = document.getElementById(decodeURIComponent(a.hash.slice(1)));
		sections.push(sec);
		active.push(false);
		if (sec) index.set(sec, i);
	});
	if (!links.length) return () => {};

	const wide = window.matchMedia("(min-width: 1536px)");

	function onIntersect(entries) {
		entries.forEach((e) => {
			const i = index.get(e.target);
			if (i !== undefined) active[i] = e.isIntersecting;
			if (e.isIntersecting && anchorNavTarget === e.target) anchorNavTarget = null;
		});
		if (!active.includes(true)) fallback();
		update();
	}
	function fallback() {
		const vh = window.innerHeight;
		for (let i = 0; i < sections.length; i++) {
			const s = sections[i];
			if (!s) continue;
			const r = s.getBoundingClientRect();
			if ((r.top > 0 && r.top < vh) || (r.bottom > 0 && r.bottom < vh) || (r.top < 0 && r.bottom > vh)) active[i] = true;
			else if (r.top > vh) break;
		}
	}
	function toggle() {
		links.forEach((l, k) => (active[k] ? l.setAttribute("aria-current", "location") : l.removeAttribute("aria-current")));
		const run = activeRun(active);
		links.forEach((l, k) => l.classList.toggle("visible", run !== null && k >= run.min && k <= run.max));
		if (!indicator) return;
		if (!run) { indicator.style.cssText = "opacity: 0"; return; }
		const parentTop = nav.getBoundingClientRect().top, scroll = nav.scrollTop;
		const top = links[run.min].getBoundingClientRect().top - parentTop + scroll;
		const bottom = links[run.max].getBoundingClientRect().bottom - parentTop + scroll;
		indicator.style.cssText = `top: ${top}px; height: ${bottom - top}px`;
	}
	function scroll() {
		if (anchorNavTarget || !wide.matches) return;
		const vis = nav.querySelectorAll("a.visible");
		if (!vis.length) return;
		const first = vis[0], last = vis[vis.length - 1], h = nav.clientHeight;
		const top = last.getBoundingClientRect().bottom - first.getBoundingClientRect().top < 0.9 * h ? first.offsetTop - 32 : last.offsetTop - h * 0.8;
		nav.scrollTo({ top, left: 0, behavior: "smooth" });
	}
	function update() {
		requestAnimationFrame(() => { toggle(); scroll(); });
	}
	function onClick(e) {
		const a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
		if (a) anchorNavTarget = document.getElementById(decodeURIComponent(a.hash.slice(1)));
	}

	const observer = new IntersectionObserver(onIntersect, { threshold: 0 });
	sections.forEach((s) => s && observer.observe(s));
	nav.addEventListener("click", onClick, true);
	nav.classList.add("is-live");
	fallback();
	update();

	function openForWide() { if (wide.matches) nav.querySelectorAll("details").forEach((d) => (d.open = true)); }
	function refresh() { openForWide(); update(); }
	wide.addEventListener("change", refresh);
	window.addEventListener("resize", refresh, { passive: true });
	// A tab change flips [hidden] on the panel that owns this rail: re-run it when the panel appears.
	const mo = new MutationObserver((muts) => muts.forEach((m) => { if (m.target.contains(nav)) update(); }));
	const panel = nav.closest(".rd-tabpanel");
	if (panel) mo.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
	openForWide();

	return () => {
		observer.disconnect();
		nav.removeEventListener("click", onClick, true);
		wide.removeEventListener("change", refresh);
		window.removeEventListener("resize", refresh);
		mo.disconnect();
		nav.classList.remove("is-live");
	};
}
