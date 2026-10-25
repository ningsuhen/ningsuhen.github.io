// rd-tabs: tabbed pages. A tab is a real ?tab= link, so the browser owns its history (one entry per tab
// click, no script). A section jump inside the current tab (an "On this page" / rail link) is one pushState
// entry that keeps the saved scroll; a section in another tab is a real navigation to ?tab=<tab>#<section>.
// Back, Forward, reload and bfcache restore re-sync the tab, section and scroll; they never add an entry.
// replaceState only saves the scroll into the current entry and maps a legacy hash-only URL to ?tab= on load.
// Every scroll also goes to sessionStorage under the entry's key, because a write made in pagehide never
// reaches the entry a reload restores from. <html data-history-ready> marks the first restore as done.
// Widgets never touch history.
//
// Opt-in: a page puts data-rd="tabs" on its <nav class="rd-expnav" role="tablist">. rd.js (index.js) mounts
// this on every such nav. The bar's [role="tab"] links carry href="?tab=<id>" and aria-controls="<id>"; the
// panels are <div class="rd-tabpanel" id="<id>">. Pages that keep their own inline tab script omit data-rd, so
// nothing doubles up. The page still works with no JS: the first panel is shown and the links are real anchors.
//
// Adapter affordance: mountTabs sets window.ideaGo(sectionId) — a same-page navigation to the tab and section
// that hold the section. Pages with an "Ask" widget call it from citations. (Fragment pages use
// rd.on('tabshow') and init({ root, data, rd }) instead of the global.)

// Pure: which tab is active, given the ordered tab ids, the ?tab= value and a decoded hash id. A ?tab= that
// names a tab wins; otherwise a hash that names a tab (a legacy #<tab-id>) maps to it. A hash that names a
// section (not a tab) is resolved by the caller against the panels. Returns the index, or -1.
export function resolveTab(ids, tabParam, hashId) {
	if (tabParam && ids.indexOf(tabParam) >= 0) return ids.indexOf(tabParam);
	if (hashId && ids.indexOf(hashId) >= 0) return ids.indexOf(hashId);
	return -1;
}

// Mount the tab + history behaviour on one tab bar. opts: { emit } (the rd event bus; 'tabshow' fires when a
// panel becomes visible, so a chart in a hidden tab can render). Returns { go, dispose }.
export function mountTabs(bar, opts = {}) {
	const tabs = Array.from(bar.querySelectorAll('[role="tab"]'));
	if (!tabs.length) return { go() {}, dispose() {} };
	const ids = tabs.map((t) => t.getAttribute("aria-controls"));
	const panels = ids.map((id) => document.getElementById(id));
	// JS is available: the page's progressive-enhancement CSS (.js …) now applies. The tab IIFE used to set this;
	// rd.js owns the tabs now, so it sets the flag.
	document.documentElement.classList.add("js");
	const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
	const navH = () => bar.getBoundingClientRect().bottom;
	let saveTimer = 0;
	let seq = Date.now();
	const yByKey = {};
	if ("scrollRestoration" in history) history.scrollRestoration = "manual";

	const tabOf = (id) => ids.indexOf(id);
	function panelOf(el) {
		for (let i = 0; i < panels.length; i++) if (panels[i] && panels[i].contains(el)) return i;
		return -1;
	}
	// What a hash names: a tab (a legacy #tab-id, el null), an element (its tab is the panel that holds it), or nothing.
	function locate(id) {
		if (!id) return null;
		const t = tabOf(id);
		if (t >= 0) return { tab: t, el: null };
		const el = document.getElementById(id);
		return el ? { tab: panelOf(el), el } : null;
	}
	const currentTab = () => {
		const i = panels.findIndex((p) => p && !p.hidden);
		return i < 0 ? 0 : i;
	};
	function viewFromUrl() {
		const hashId = decodeURIComponent(location.hash.slice(1));
		const loc = locate(hashId);
		const t = resolveTab(ids, new URLSearchParams(location.search).get("tab"), hashId);
		const tab = t >= 0 ? t : loc && loc.tab >= 0 ? loc.tab : 0;
		return { tab, el: loc && loc.el ? loc.el : null };
	}
	const urlFor = (tab, id) => location.pathname + "?tab=" + panels[tab].id + (id ? "#" + id : "");
	function barEdges() {
		bar.classList.toggle("is-fade-start", bar.scrollLeft > 2);
		bar.classList.toggle("is-fade-end", bar.scrollLeft < bar.scrollWidth - bar.clientWidth - 2);
	}
	function revealTab(t) {
		const pad = 40, l = t.offsetLeft, r = l + t.offsetWidth;
		if (l < bar.scrollLeft + pad) bar.scrollLeft = l - pad;
		else if (r > bar.scrollLeft + bar.clientWidth - pad) bar.scrollLeft = r - bar.clientWidth + pad;
	}
	function show(i) {
		tabs.forEach((t, j) => {
			const on = j === i;
			t.setAttribute("aria-selected", on ? "true" : "false");
			t.setAttribute("tabindex", on ? "0" : "-1");
			t.classList.toggle("is-active", on);
			panels[j].hidden = !on;
		});
		revealTab(tabs[i]);
		barEdges();
		if (opts.emit) opts.emit("tabshow", { id: panels[i].id, index: i });
	}
	function focusTarget(el) {
		const t = /^H[1-6]$/.test(el.tagName) ? el : el.querySelector("h1,h2,h3,h4,h5,h6") || el;
		t.setAttribute("tabindex", "-1");
		t.focus({ preventScroll: true });
	}
	function keyOf() {
		const k = history.state && history.state.k;
		return k ? String(k) : "url:" + location.pathname + location.search + location.hash;
	}
	function remember(k, y) {
		yByKey[k] = y;
		try { sessionStorage.setItem("rd-y:" + k, String(y)); } catch {}
	}
	function saveScroll() {
		clearTimeout(saveTimer);
		const y = Math.round(window.scrollY);
		remember(keyOf(), y);
		history.replaceState(Object.assign({}, history.state, { y }), "");
	}
	function recalled(k) {
		if (!history.state) return undefined;
		let v = null;
		try { v = sessionStorage.getItem("rd-y:" + k); } catch {}
		return v === null ? undefined : Number(v);
	}
	function showLoc(loc, o) {
		if (loc.tab >= 0) show(loc.tab);
		if (loc.el && o.focus) focusTarget(loc.el);
		const behavior = o.smooth && !reduce.matches ? "smooth" : "instant";
		if (typeof o.y === "number") return window.scrollTo({ top: o.y, behavior });
		if (loc.el) return loc.el.scrollIntoView({ block: "start", behavior });
		if (o.tabStart) {
			const top = panels[loc.tab].getBoundingClientRect().top;
			if (top < navH()) window.scrollTo({ top: window.scrollY + top - navH() - 8, behavior });
		}
	}
	// Back, Forward, popstate, hashchange, bfcache restore: re-sync from the URL and the entry. Writes no entry.
	function resync() {
		const v = viewFromUrl();
		const st = history.state || {};
		const key = keyOf();
		const saved = yByKey[key] !== undefined ? yByKey[key] : recalled(key);
		const y = typeof saved === "number" ? saved : typeof st.y === "number" ? st.y : null;
		showLoc({ tab: v.tab, el: v.el }, { y, focus: !!v.el, smooth: false, tabStart: true });
		saveScroll();
	}
	// In-page links: a section in the current tab is one pushState entry; a section in another tab is a real navigation.
	function onClick(e) {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
		if (!a || a.target || a.getAttribute("href") === "#") return;
		const id = decodeURIComponent(a.getAttribute("href").slice(1));
		const loc = locate(id);
		if (!loc) return;
		e.preventDefault();
		const secId = loc.el ? id : "";
		if (loc.tab !== currentTab()) { location.assign(urlFor(loc.tab, secId)); return; }
		const base = location.pathname + location.search + location.hash;
		const next = location.pathname + location.search + (secId ? "#" + secId : "");
		if (next !== base) {
			saveScroll();
			seq += 1;
			const y0 = Math.round(window.scrollY);
			remember(String(seq), y0);
			history.pushState({ k: seq, y: y0 }, "", next);
		}
		showLoc({ tab: loc.tab, el: loc.el }, { smooth: true, focus: !!loc.el, tabStart: false });
	}
	// A tab is a real link. Following the tab that is already shown adds no entry.
	function onTabClick(e) {
		const t = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
		if (t && t.getAttribute("aria-selected") === "true" && e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) e.preventDefault();
	}
	// Keyboard on the tab list: arrows, Home and End move focus; Space follows the focused tab.
	function onKey(e) {
		const i = tabs.indexOf(document.activeElement);
		if (i < 0) return;
		let n = null;
		if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
		else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
		else if (e.key === "Home") n = 0;
		else if (e.key === "End") n = tabs.length - 1;
		else if (e.key === " ") { e.preventDefault(); tabs[i].click(); return; }
		if (n === null) return;
		e.preventDefault();
		tabs[n].focus();
	}
	function onScroll() {
		remember(keyOf(), Math.round(window.scrollY));
		clearTimeout(saveTimer);
		saveTimer = setTimeout(saveScroll, 150);
	}
	function onPageShow(e) { if (e.persisted) resync(); }

	document.addEventListener("click", onClick);
	bar.addEventListener("click", onTabClick);
	bar.addEventListener("keydown", onKey);
	bar.addEventListener("scroll", barEdges, { passive: true });
	window.addEventListener("resize", barEdges);
	window.addEventListener("popstate", resync);
	window.addEventListener("hashchange", resync);
	window.addEventListener("pageshow", onPageShow);
	window.addEventListener("pagehide", saveScroll);
	window.addEventListener("scroll", onScroll, { passive: true });

	// First paint. A legacy URL (hash only, or a tab id in the hash) is mapped to ?tab= with replaceState: no entry.
	const v0 = viewFromUrl();
	const restoreY = recalled(keyOf()) !== undefined ? recalled(keyOf()) : typeof (history.state || {}).y === "number" ? history.state.y : null;
	let touched = false;
	["wheel", "touchstart", "keydown", "mousedown"].forEach((ev) => window.addEventListener(ev, () => { touched = true; }, { passive: true, once: true }));
	if (!new URLSearchParams(location.search).has("tab") || tabOf(decodeURIComponent(location.hash.slice(1))) >= 0) {
		history.replaceState(history.state, "", urlFor(v0.tab, v0.el ? v0.el.id : ""));
	}
	resync();
	function restoreFirst() {
		if (touched) return;
		if (v0.el) focusTarget(v0.el);
		if (restoreY !== null) window.scrollTo({ top: restoreY, behavior: "instant" });
		else if (v0.el) v0.el.scrollIntoView({ block: "start", behavior: "instant" });
	}
	const onLoad = () => {
		restoreFirst();
		const mark = () => document.documentElement.setAttribute("data-history-ready", "");
		const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
		fonts.then(
			() => {
				if (!touched && restoreY !== null && Math.abs(window.scrollY - restoreY) > 2) window.scrollTo({ top: restoreY, behavior: "instant" });
				mark();
			},
			mark,
		);
	};
	window.addEventListener("load", onLoad, { once: true });

	// Adapter affordance: a same-page navigation to the tab and section that hold a section (Ask-tab citations).
	const go = (sectionId) => {
		const el = document.getElementById(sectionId);
		const p = el ? panelOf(el) : -1;
		if (p < 0) return;
		saveScroll();
		seq += 1;
		const y0 = Math.round(window.scrollY);
		remember(String(seq), y0);
		history.pushState({ k: seq, y: y0 }, "", urlFor(p, sectionId));
		showLoc({ tab: p, el }, { smooth: true, focus: true, tabStart: false });
	};
	window.ideaGo = go;

	return {
		go,
		dispose() {
			document.removeEventListener("click", onClick);
			bar.removeEventListener("click", onTabClick);
			bar.removeEventListener("keydown", onKey);
			bar.removeEventListener("scroll", barEdges);
			window.removeEventListener("resize", barEdges);
			window.removeEventListener("popstate", resync);
			window.removeEventListener("hashchange", resync);
			window.removeEventListener("pageshow", onPageShow);
			window.removeEventListener("pagehide", saveScroll);
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("load", onLoad);
			clearTimeout(saveTimer);
			if (window.ideaGo === go) delete window.ideaGo;
		},
	};
}
