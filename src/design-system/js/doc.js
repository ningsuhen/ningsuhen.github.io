// rd-doc: the Doc design's runtime. Large content is split three ways so a reader rarely scrolls far:
//   left sidebar  = the document's pages (the fragment's tabs, <section data-rd-tab>)
//   the bar's nav = the shown page's sections (each top-level section opened by an <h2 id>), one shown at a time
//   right sidebar = "On this page": the headings inside the shown section (h3 and below), with a scroll-spy
//
// The page list is the tab list (data-rd="tabs"), so pages, history, scroll restore and 'tabshow' stay in tabs.js: a page
// is a real ?tab= link. A section is the page's URL plus its heading's id (?tab=<page>#<h2 id>), the address every
// existing link, search result and Back/Forward entry already uses. This module adds the rest: the sidebars (docked from
// 92rem, drawers below), the bar (page title, section nav), the rail, the pager, back to top and the search.
//
// Opt-in: data-rd="doc" on the .rd-doc frame. rd.js mounts it before the tabs, so it hears the first 'tabshow' and its
// click and popstate listeners run before the tabs' ones. Without JS none of this runs: one plain document, in order.

const DOCK = "(min-width: 92rem)"; // the same width as doc.css: both sidebars dock together
// A section: a top-level <section> opened by an <h2>. Its address is the first id among the h2, its header and the
// section itself (fragments put it on the h2; pages made from the design-system template put it on the header or section).
function sectionOf(el) {
	if (!el.matches("section, .rd-tabsec")) return null;
	const head = el.querySelector(":scope > .rd-section__head, :scope > header");
	const h2 = (head || el).querySelector(head ? "h2" : ":scope > h2");
	if (!h2) return null;
	const target = [h2, head, el].find((x) => x && x.id);
	return target ? { target, label: h2.textContent.trim() } : null;
}

function store(key, value) {
	try {
		if (value === undefined) return localStorage.getItem(key);
		localStorage.setItem(key, value);
	} catch {}
	return null;
}

export function mountDoc(frame, { on } = {}) {
	const d = document;
	const $ = (s, r = frame) => r.querySelector(s);
	const $$ = (s, r = frame) => Array.from(r.querySelectorAll(s));
	d.documentElement.classList.add("js");
	const reduce = matchMedia("(prefers-reduced-motion: reduce)");

	// ---- Sidebars ----
	const dock = matchMedia(DOCK);
	const pref = { nav: store("rd-doc-nav") !== "closed", toc: store("rd-doc-toc") !== "closed" };
	const toggles = { nav: $("[data-rd-doc-toggle=nav]"), toc: $("[data-rd-doc-toggle=toc]") };
	const panes = { nav: $(".rd-doc__side"), toc: $(".rd-doc__rail") };
	const scrim = $(".rd-doc__scrim");
	let drawer = null;
	function layout() {
		if (drawer && dock.matches) drawer = null;
		for (const k of ["nav", "toc"]) {
			const open = dock.matches ? pref[k] : drawer === k;
			frame.dataset[k] = open ? (dock.matches ? "open" : "drawer") : "closed";
			toggles[k]?.setAttribute("aria-expanded", String(open));
		}
		if (scrim) scrim.hidden = !drawer;
	}
	function toggle(k) {
		if (dock.matches) {
			pref[k] = !pref[k];
			store("rd-doc-" + k, pref[k] ? "open" : "closed");
		} else drawer = drawer === k ? null : k;
		layout();
		if (drawer) $("a,button", panes[k])?.focus({ preventScroll: true });
	}
	function closeDrawer() {
		if (!drawer) return;
		const k = drawer;
		drawer = null;
		layout();
		toggles[k]?.focus({ preventScroll: true });
	}
	for (const k of ["nav", "toc"]) toggles[k]?.addEventListener("click", () => toggle(k));
	dock.addEventListener("change", layout);
	scrim?.addEventListener("click", closeDrawer);
	for (const k of ["nav", "toc"]) panes[k]?.addEventListener("click", (e) => { if (drawer === k && e.target.closest?.("a")) closeDrawer(); });
	layout();

	// ---- Bar ----
	const bar = $(".rd-doc__bar");
	const title = $(".rd-doc__head h2");
	const subtitle = $(".rd-doc__head p");
	const subnav = $(".rd-doc__subnav");
	if (bar) new ResizeObserver(() => d.documentElement.style.setProperty("--rd-doc-bar-h", bar.offsetHeight + "px")).observe(bar);

	// ---- Pages and their sections ----
	const links = $$('.rd-doc__nav [role="tab"]');
	const pageLabel = (a) => (a.querySelector("span") || a).textContent.trim();
	const panelOf = (a) => d.getElementById(a.getAttribute("aria-controls"));
	const baseTitle = d.title;
	// A page's sections: each top-level section opened by an <h2> (see sectionOf). What comes before the first (a row of chips) belongs
	// to the first; what follows a section belongs to it. A page with no such section is one section of itself.
	const cache = new Map();
	function subsOf(panel) {
		if (cache.has(panel)) return cache.get(panel);
		const box = panel.querySelector(":scope > .rd-tab__body") || panel;
		const subs = [];
		let lead = [];
		for (const el of box.children) {
			const h = sectionOf(el);
			if (h) {
				subs.push({ id: h.target.id, label: h.label, head: h.target, members: [...lead, el] });
				lead = [];
			} else if (subs.length) subs[subs.length - 1].members.push(el);
			else lead.push(el);
		}
		cache.set(panel, subs);
		return subs;
	}
	const subOf = (subs, el) => subs.find((s) => s.members.some((m) => m === el || m.contains(el))) || null;

	// ---- On this page: the shown section's headings below its own h2 (server-rendered per page, filtered here) ----
	const rail = panes.toc;
	const lists = rail ? $$("ol[data-for]", rail) : [];
	const empty = rail ? $(".rd-doc__rail-empty", rail) : null;
	let unwatch = null;
	function watch(items) {
		unwatch?.();
		unwatch = null;
		if (!items.length) return;
		let raf = 0;
		let held = null;
		const mark = () => {
			raf = 0;
			const line = (bar ? bar.getBoundingClientRect().bottom : 0) + 28;
			let cur = items[0];
			for (const it of items) if (it[1].getBoundingClientRect().top <= line) cur = it;
			if (scrollY > 0 && innerHeight + scrollY >= d.documentElement.scrollHeight - 2) cur = items[items.length - 1];
			if (held) cur = items.find((it) => it[0] === held) || cur;
			for (const it of items) it[0].toggleAttribute("aria-current", it === cur);
		};
		const onScroll = () => { if (!raf) raf = requestAnimationFrame(mark); };
		// A heading picked from the list stays marked until the reader scrolls by hand: near the end of a section it
		// cannot reach the top, and a smooth scroll passes other headings on the way.
		const release = () => { held = null; };
		const pick = (e) => { const a = e.target.closest?.("a"); if (a) held = a; };
		const manual = ["wheel", "touchstart", "keydown", "mousedown"];
		addEventListener("scroll", onScroll, { passive: true });
		addEventListener("resize", onScroll);
		for (const ev of manual) addEventListener(ev, release, { passive: true });
		rail.addEventListener("click", pick);
		mark();
		unwatch = () => {
			removeEventListener("scroll", onScroll);
			removeEventListener("resize", onScroll);
			for (const ev of manual) removeEventListener(ev, release);
			rail.removeEventListener("click", pick);
		};
	}

	// ---- Pager: every section of every page, in order ----
	const pager = $(".rd-doc__pager");
	function stops() {
		const out = [];
		links.forEach((a, pi) => {
			const panel = panelOf(a);
			const subs = panel ? subsOf(panel) : [];
			const many = subs.length > 1;
			if (!subs.length) out.push({ pi, si: 0, label: pageLabel(a), href: a.getAttribute("href") });
			subs.forEach((s, si) => out.push({ pi, si, label: many ? `${pageLabel(a)}: ${s.label}` : pageLabel(a), href: a.getAttribute("href") + (si ? "#" + encodeURIComponent(s.id) : ""), id: s.id }));
		});
		return out;
	}
	function pagerLink(stop, dir, samePage) {
		const el = d.createElement("a");
		el.href = samePage && stop.id ? "#" + encodeURIComponent(stop.id) : stop.href;
		el.className = "rd-doc__pager-" + dir;
		const head = d.createElement("span");
		head.className = "rd-doc__pager-dir";
		const icon = `<svg class="rd-icon" aria-hidden="true"><use href="#i-arrow-${dir === "next" ? "right" : "left"}"/></svg>`;
		head.innerHTML = dir === "next" ? "Next" + icon : icon + "Previous";
		const t = d.createElement("span");
		t.className = "rd-doc__pager-title";
		t.textContent = stop.label;
		el.append(head, t);
		return el;
	}
	frame.addEventListener("click", (e) => {
		if (!e.target.closest?.("[data-rd-doc-totop]")) return;
		scrollTo({ top: 0, behavior: reduce.matches ? "auto" : "smooth" });
	});

	// ---- Showing a page and one of its sections ----
	let cur = null; // { a, index, panel, subs, sub }
	function showSub(sub) {
		const { a, index, panel, subs } = cur;
		cur.sub = sub;
		for (const s of subs) for (const m of s.members) m.toggleAttribute("data-doc-off", s !== sub);
		// The section's own heading is its tab in the bar (or, alone on its page, the page's title), so it stays for screen
		// readers only.
		panel.toggleAttribute("data-doc-subbed", subs.length > 0);
		if (subnav) {
			for (const l of subnav.children) l.toggleAttribute("aria-current", l.dataset.sub === sub?.id);
			subnav.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
		}
		frame.toggleAttribute("data-first", index === 0 && (!sub || sub === subs[0])); // the document's cover: first page only
		d.title = (subs.length > 1 && sub ? sub.label + " · " : "") + pageLabel(a) + " · " + baseTitle;
		// Rail: the page's list, its entries inside the shown section other than the section's own heading.
		let items = [];
		for (const ol of lists) {
			const mine = ol.dataset.for === panel.id;
			ol.hidden = !mine;
			if (!mine) continue;
			for (const li of ol.children) {
				const link = li.querySelector("a");
				const target = link && d.getElementById(decodeURIComponent(link.hash.slice(1)));
				const show = !!target && (!sub || (target !== sub.head && sub.members.some((m) => m === target || m.contains(target))));
				li.hidden = !show;
				if (show) items.push([link, target]);
			}
		}
		if (empty) empty.hidden = items.length > 0;
		rail?.classList.toggle("is-empty", !items.length);
		frame.toggleAttribute("data-rail-empty", !items.length);
		if (pager) {
			const all = stops();
			const at = all.findIndex((s) => s.pi === index && (!sub || s.id === sub.id));
			const prev = all[at - 1];
			const next = all[at + 1];
			pager.replaceChildren(prev ? pagerLink(prev, "prev", prev.pi === index) : d.createElement("span"), ...(next ? [pagerLink(next, "next", next.pi === index)] : []));
			pager.hidden = !prev && !next;
		}
		if (!reduce.matches) {
			panel.classList.remove("is-in");
			void panel.offsetWidth;
			panel.classList.add("is-in");
		}
		watch(items);
	}
	function subFromUrl() {
		const id = decodeURIComponent(location.hash.slice(1));
		const el = id ? d.getElementById(id) : null;
		// A hash that is no element id is a widget's state (a walker's #m=5&s=2): the section holding [data-rd-hash] stays shown.
		if (id && !el) {
			const owner = cur.panel.querySelector("[data-rd-hash]");
			return (owner && subOf(cur.subs, owner)) || cur.sub || cur.subs[0] || null;
		}
		return (el && cur.panel.contains(el) && subOf(cur.subs, el)) || cur.subs[0] || null;
	}
	function onShow({ id, index }) {
		const a = links[index];
		const panel = d.getElementById(id);
		if (!a || !panel) return;
		// tabs.js re-shows the current page on every in-page jump, after it has set the URL: show the section the URL
		// names (an ideaGo(sectionId) citation jump comes this way, with no click), then tabs.js scrolls to it.
		if (cur?.panel === panel) return onUrl();
		const subs = subsOf(panel);
		cur = { a, index, panel, subs, sub: null };
		if (title) title.textContent = pageLabel(a);
		if (subtitle) subtitle.textContent = panel.dataset.rdSub || "";
		if (subnav) {
			subnav.replaceChildren(...(subs.length > 1 ? subs : []).map((s) => {
				const l = d.createElement("a");
				l.href = "#" + encodeURIComponent(s.id);
				l.dataset.sub = s.id;
				l.textContent = s.label;
				return l;
			}));
			subnav.hidden = subs.length < 2;
		}
		showSub(subFromUrl());
	}
	const offShow = on ? on("tabshow", onShow) : null;

	// A link to something on the shown page first shows the section that holds it; tabs.js then scrolls to it. A link to a
	// section itself (the bar's nav, the pager, a search result) opens that section at its top, as a page opens: one
	// history entry, the same { k, y } state tabs.js keeps, so Back and Forward restore the scroll as for its own entries.
	// Capture phase: this runs before the tabs' document listener, which skips a click whose default is prevented.
	function onClick(e) {
		if (!cur || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const a = e.target.closest?.('a[href^="#"]');
		if (!a || a.target) return;
		const id = decodeURIComponent(a.getAttribute("href").slice(1));
		const el = id ? d.getElementById(id) : null;
		if (!el || !cur.panel.contains(el)) return; // on another page: tabs.js navigates there
		const sub = subOf(cur.subs, el);
		if (!sub) return;
		if (sub !== cur.sub) showSub(sub);
		if (el !== sub.head) return;
		e.preventDefault();
		const next = location.pathname + location.search + "#" + encodeURIComponent(id);
		if (next !== location.pathname + location.search + location.hash) history.pushState({ k: Date.now(), y: 0 }, "", next);
		scrollTo({ top: 0, behavior: "instant" });
		sub.head.setAttribute("tabindex", "-1");
		sub.head.focus({ preventScroll: true });
	}
	d.addEventListener("click", onClick, true);
	// Back, Forward and a typed #hash: show the section the URL names before tabs.js restores the scroll.
	const onUrl = () => { if (cur) { const s = subFromUrl(); if (s !== cur.sub) showSub(s); } };
	addEventListener("popstate", onUrl);
	addEventListener("hashchange", onUrl);

	// ---- Search: every section of every page, built on first use ----
	const search = d.querySelector(".rd-doc__search");
	const input = search?.querySelector("input");
	const results = search?.querySelector(".rd-doc__search-results");
	const hint = search?.querySelector(".rd-doc__search-hint");
	let index = null;
	let active = -1;
	const text = (els) => els.map((n) => (n.nodeType === 1 && n.matches("svg, script, style, .rd-section__head") ? "" : n.textContent)).join(" ");
	function buildIndex() {
		index = [];
		links.forEach((a) => {
			const panel = panelOf(a);
			if (!panel) return;
			const page = pageLabel(a);
			const subs = subsOf(panel);
			if (!subs.length) index.push({ href: a.getAttribute("href"), path: page, title: page, text: text([panel]) });
			subs.forEach((s, si) => {
				// On the shown page a section is a #link (shown in place); on another page it is that page's URL.
				const same = cur && cur.panel === panel;
				const href = same ? "#" + encodeURIComponent(s.id) : a.getAttribute("href") + (si ? "#" + encodeURIComponent(s.id) : "");
				index.push({ href, path: page, title: s.label, text: text(s.members) });
				for (const h of s.members.flatMap((m) => Array.from(m.querySelectorAll("h3[id], h4[id]")))) {
					const at = same ? "#" + encodeURIComponent(h.id) : a.getAttribute("href") + "#" + encodeURIComponent(h.id);
					index.push({ href: at, path: page + " / " + s.label, title: h.textContent.trim(), text: "" });
				}
			});
		});
		for (const it of index) {
			it.text = it.text.replace(/\s+/g, " ").trim();
			it.lower = it.text.toLowerCase();
			it.head = (it.title + " " + it.path).toLowerCase();
		}
	}
	function snippet(it, terms) {
		const span = d.createElement("span");
		span.className = "rd-doc__search-snip";
		let at = -1;
		for (const t of terms) { const i = it.lower.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
		const from = Math.max(0, at - 48);
		const txt = (from > 0 ? "…" : "") + it.text.slice(from, from + 150);
		const re = new RegExp("(" + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "ig");
		for (const part of txt.split(re)) {
			if (!part) continue;
			if (terms.includes(part.toLowerCase())) { const m = d.createElement("mark"); m.textContent = part; span.append(m); } else span.append(part);
		}
		return span;
	}
	function setActive(i) {
		const rows = Array.from(results.querySelectorAll("a"));
		active = rows.length ? (i + rows.length) % rows.length : -1;
		rows.forEach((a, k) => { a.setAttribute("aria-selected", String(k === active)); if (k === active) a.scrollIntoView({ block: "nearest" }); });
	}
	function runSearch() {
		const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
		if (!terms.length) { results.replaceChildren(); hint.hidden = false; hint.textContent = "Type to search every page. Enter opens the first result."; active = -1; return; }
		const hits = [];
		for (const it of index) {
			let score = 0;
			for (const t of terms) {
				const inHead = it.head.includes(t);
				if (!inHead && !it.lower.includes(t)) { score = -1; break; }
				score += inHead ? 10 : 1;
			}
			if (score > 0) hits.push([score, it]);
		}
		hits.sort((x, y) => y[0] - x[0]);
		results.replaceChildren(...hits.slice(0, 12).map(([, it]) => {
			const li = d.createElement("li");
			const a = d.createElement("a");
			a.href = it.href;
			const path = d.createElement("span"); path.className = "rd-doc__search-path"; path.textContent = it.path;
			const t = d.createElement("span"); t.className = "rd-doc__search-title"; t.textContent = it.title;
			a.append(path, t);
			if (it.text) a.append(snippet(it, terms));
			li.append(a);
			return li;
		}));
		hint.hidden = hits.length > 0;
		hint.textContent = "Nothing matches.";
		setActive(0);
	}
	function openSearch() {
		if (!search || search.open) return;
		index = null; // links depend on the shown page
		buildIndex();
		input.value = "";
		search.showModal();
		runSearch();
		input.focus();
	}
	if (search) {
		frame.querySelector("[data-rd-doc-search]")?.addEventListener("click", openSearch);
		input.addEventListener("input", runSearch);
		input.addEventListener("keydown", (e) => {
			if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
			else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
			else if (e.key === "Enter") { e.preventDefault(); results.querySelectorAll("a")[active]?.click(); }
		});
		results.addEventListener("click", (e) => { if (e.target.closest?.("a")) search.close(); });
		search.addEventListener("click", (e) => { if (e.target === search) search.close(); });
	}
	function onKey(e) {
		const typing = e.target.closest?.("input,textarea,select,[contenteditable]");
		if (search && ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)))) { e.preventDefault(); openSearch(); }
		else if (e.key === "Escape" && drawer) closeDrawer();
	}
	addEventListener("keydown", onKey);

	return {
		dispose() {
			offShow?.();
			unwatch?.();
			d.removeEventListener("click", onClick, true);
			removeEventListener("popstate", onUrl);
			removeEventListener("hashchange", onUrl);
			removeEventListener("keydown", onKey);
			dock.removeEventListener("change", layout);
		},
	};
}
