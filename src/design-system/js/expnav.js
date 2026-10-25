// rd-expnav: the sticky section bar under the navbar card. Marks the section in view
// (aria-current + .is-active), keeps that link visible on the bar (the bar scrolls sideways,
// not the page) and shows an edge fade while links are hidden on that side. No dependencies.
//
// Opt-in: a page puts data-rd on its <nav class="rd-expnav">. rd.js (index.js) mounts this on
// every such nav. Pages that keep their own inline spy simply omit data-rd, so nothing doubles up.
// The page still works with no JS: the links are plain anchors and the browser owns the hash.

// Pure core: which section is current, given each section's top (px, viewport-relative), the
// bar's bottom edge, and the page scroll state. A section counts once its top is under the bar
// (bar bottom + 24px); at the very bottom of the page the last section wins.
export function currentSectionIndex(sectionTops, navBottom, innerHeight, scrollY, scrollHeight) {
	const line = navBottom + 24;
	let current = 0;
	if (innerHeight + scrollY >= scrollHeight - 2) current = sectionTops.length - 1;
	else for (let i = 0; i < sectionTops.length; i++) if (sectionTops[i] <= line) current = i;
	return current;
}

// Mount the scroll-spy on one .rd-expnav. Returns a dispose() that removes the listeners.
export function mountExpnav(nav) {
	const pairs = [];
	nav.querySelectorAll('a[href^="#"]').forEach((a) => {
		const s = document.getElementById(decodeURIComponent(a.hash.slice(1)));
		if (s) pairs.push([a, s]);
	});
	if (!pairs.length) return () => {};

	let ticking = false;
	let shown = null;

	function edges() {
		nav.classList.toggle("is-fade-start", nav.scrollLeft > 2);
		nav.classList.toggle("is-fade-end", nav.scrollLeft < nav.scrollWidth - nav.clientWidth - 2);
	}
	function reveal(a) {
		const pad = 40, l = a.offsetLeft, r = l + a.offsetWidth;
		if (l < nav.scrollLeft + pad) nav.scrollLeft = l - pad;
		else if (r > nav.scrollLeft + nav.clientWidth - pad) nav.scrollLeft = r - nav.clientWidth + pad;
	}
	function update() {
		ticking = false;
		const tops = pairs.map((p) => p[1].getBoundingClientRect().top);
		const idx = currentSectionIndex(tops, nav.getBoundingClientRect().bottom, window.innerHeight, window.scrollY, document.documentElement.scrollHeight);
		const current = pairs[idx];
		pairs.forEach((p) => {
			const on = p === current;
			p[0].classList.toggle("is-active", on);
			if (on) p[0].setAttribute("aria-current", "location");
			else p[0].removeAttribute("aria-current");
		});
		if (current[0] !== shown) { shown = current[0]; reveal(shown); }
		edges();
	}
	function schedule() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }

	window.addEventListener("scroll", schedule, { passive: true });
	window.addEventListener("resize", schedule);
	nav.addEventListener("scroll", edges, { passive: true });
	update();

	return () => {
		window.removeEventListener("scroll", schedule);
		window.removeEventListener("resize", schedule);
		nav.removeEventListener("scroll", edges);
	};
}
