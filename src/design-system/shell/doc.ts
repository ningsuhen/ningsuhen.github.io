// The Doc design's markup: the frame around a fragment body (components/doc.css, js/doc.js). The Card design is the
// shell's other branch (StandaloneShell.astro); both take the same body, tabs and rails from the fragment loader.
//
// Kept free of Astro and of the site's chrome so another host (the document generator) can render the same frame:
// the caller passes the body and the derived tabs and rails, and wraps the result in its own document and chrome.
//
// The final layout is the HTML, not a JS repair: the frame ships the grid, the docked sidebars, the shown page's
// bar head, section nav, rail and pager, with every other page and section hidden. A ?tab= / # deep link is picked
// before first paint by a tiny synchronous head snippet (picker, returned with the body) that only sets
// html[data-rd-tab] / html[data-rd-sub]; the generated <style data-rd-doc> reads those attributes. doc.js keeps the
// behaviour (routing, drawers, search, scroll-spy, section switching) and clears both attributes once the DOM
// state matches, so the DOM alone drives the layout from then on.
//
// Three levels for large content: the left sidebar lists the pages (the fragment's tabs), the bar's nav lists the
// shown page's sections (its <h2 id> sections), the right sidebar lists the headings inside the shown section.
// The page list is the tab list: role="tab" links to ?tab=<id> in a vertical tablist, mounted by rd.js tabs.js
// (routing, history, scroll restore, 'tabshow'). data-rd-offset names the sticky bar, the line content stays under.
import { esc } from "../../chrome/util";

export type DocTab = { id: string; label: string; icon: string | null; group: string | null; sub: string | null };
export type DocRail = { id: string; text: string; level: 2 | 3 }[];
export type DocInput = {
	slug: string;
	title: string;
	summary: string;
	created: string;
	updated: string;
	/** The eyebrow over the title in the intro (the fragment's eyebrow, else the kind's label). */
	eyebrow: string;
	/** The section the document belongs to, linked from the sidebar brand (e.g. Research -> /research/). */
	section: { label: string; href: string } | null;
	tabs: DocTab[];
	rails: Record<string, DocRail>;
	body: string;
	/** In the site-wide search index (Pagefind). The in-document search is always there. */
	indexed: boolean;
};

const icon = (name: string) => `<svg class="rd-icon" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`;

/** Lucide icons the frame uses, including those doc.js creates (pager arrows), for the page's sprite. */
export const DOC_ICONS = ["panel-left", "panel-right", "search", "arrow-up", "arrow-left", "arrow-right"];

// ---- Parsing the fragment body ---------------------------------------------

// A page panel: <section ... data-rd-tab="id" ...> (the loader has added role="tabpanel").
const PANEL_RE = /<section\b[^>]*\bdata-rd-tab="([^"]+)"[^>]*>/g;
// An attribute value as written in the markup is HTML; decode the five entities the loader decodes, so the ids
// used in CSS selectors and the picker map are the DOM values.
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (v: string): string =>
	v.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (m, dec, hex, name) =>
		dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name.toLowerCase()] ?? m),
	);
// An id in a CSS attribute selector: escape the quote (ids with quotes are pathological, but the selector must not break).
const cssId = (v: string) => decode(v).replace(/"/g, '\\"');

type Sec = { id: string; text: string; at: number; end: number }; // at/end: the section tag's span, absolute
type Page = { id: string; at: number; end: number; chunk: string; secs: Sec[] };

// A page's sections: each top-level <section> (or .rd-tabsec) opened by its head (a <header> or .rd-section__head
// holding the <h2>) or by the <h2> itself; its id is the h2's, else the head's, else its own. doc.js's sectionOf
// keeps the same rule at runtime.
function sectionsOf(chunk: string): { id: string; text: string; at: number; end: number }[] {
	const out: { id: string; text: string; at: number; end: number }[] = [];
	for (const m of chunk.matchAll(/<(section|div)\b([^>]*)>/g)) {
		if (/\bdata-rd-tab=/.test(m[2]) || (m[1] === "div" && !/\brd-tabsec\b/.test(m[2]))) continue;
		const rest = chunk.slice(m.index! + m[0].length);
		const head = rest.match(/^\s*<(header|div)\b([^>]*)>/);
		if (head && head[1] === "div" && !/\brd-section__head\b/.test(head[2])) continue;
		const h2 = (head ? rest.slice(head[0].length) : rest).match(head ? /^(?:(?!<\/?section\b)[\s\S])*?<h2\b([^>]*)>([\s\S]*?)<\/h2>/ : /^\s*<h2\b([^>]*)>([\s\S]*?)<\/h2>/);
		if (!h2) continue;
		const id = h2[1].match(/\bid="([^"]+)"/)?.[1] ?? head?.[2]?.match(/\bid="([^"]+)"/)?.[1] ?? m[2].match(/\bid="([^"]+)"/)?.[1];
		if (id) out.push({ id, text: h2[2].replace(/<[^>]+>/g, "").trim(), at: m.index!, end: m.index! + m[0].length });
	}
	return out;
}

function pagesOf(body: string): Page[] {
	const starts = [...body.matchAll(PANEL_RE)].map((m) => ({ id: m[1], at: m.index!, end: m.index! + m[0].length }));
	return starts.map((s, i) => {
		const nextAt = starts[i + 1]?.at ?? body.length;
		const chunk = body.slice(s.end, nextAt);
		const secs = sectionsOf(chunk).map((x) => ({ ...x, at: s.end + x.at, end: s.end + x.end }));
		return { id: s.id, at: s.at, end: s.end, chunk, secs };
	});
}

// Which of a page's sections holds a position in its chunk (the rail items and the picker map resolve to sections
// this way): before the first section, the lead belongs to the first; otherwise the section that opened last.
function slotAt(p: Page, pos: number): string {
	if (!p.secs.length) return "";
	const rel = pos - p.end; // chunk-relative
	let slot = p.secs[0].id;
	for (const s of p.secs) if (rel >= s.at - p.end) slot = s.id;
	return slot;
}

// The section that holds a heading id: the heading's tag position in the chunk, resolved as above.
function slotOfId(p: Page, rawId: string): string {
	const m = p.chunk.match(new RegExp(`<h[234]\\b[^>]*\\bid="${rawId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`));
	return m ? slotAt(p, p.end + m.index!) : "";
}

// The rail's slots for a page: one per section (the section's own headings below its h2), or one for the page
// when it has no sections. The rail's lists and the picker's rail rules both resolve items this way.
type RailSlot = { sub: string; items: DocRail[] };
function slotsOf(p: Page, rails: Record<string, DocRail>): RailSlot[] {
	const items = rails[p.id] ?? [];
	return p.secs.length
		? p.secs.map((s) => ({ sub: s.id, items: items.filter((r) => r.id !== s.id && slotOfId(p, r.id) === s.id) }))
		: [{ sub: "", items }];
}

// The final layout for the default view (the first page's first section): every panel but the first is hidden,
// every section but the first page's first is off, and each section tag carries data-rd-sec so the generated CSS
// can select any page/section before first paint. The first panel carries data-doc-subbed as doc.js settles it:
// the shown section's own heading is its tab in the bar, so it stays for screen readers only.
function prepBody(body: string, pages: Page[]): string {
	let out = body;
	for (let i = pages.length - 1; i >= 0; i--) {
		const p = pages[i];
		for (let j = p.secs.length - 1; j >= 0; j--) {
			const s = p.secs[j];
			const tag = out.slice(s.at, s.end);
			const add = ` data-rd-sec="${s.id}"${i === 0 && j > 0 ? " data-rd-off" : ""}`;
			out = out.slice(0, s.at) + tag.replace(/>$/, add + ">") + out.slice(s.end);
		}
		if (i > 0) out = out.slice(0, p.at) + out.slice(p.at, p.end).replace(/>$/, " hidden>") + out.slice(p.end);
		else if (p.secs.length) out = out.slice(0, p.at) + out.slice(p.at, p.end).replace(/>$/, " data-doc-subbed>") + out.slice(p.end);
	}
	return out;
}

// ---- The frame --------------------------------------------------------------

function nav(tabs: DocTab[]): string {
	// Consecutive tabs with the same group form one labelled group; ungrouped tabs form an unlabelled one.
	const groups: { name: string | null; tabs: DocTab[] }[] = [];
	for (const t of tabs) {
		const last = groups[groups.length - 1];
		if (last && last.name === t.group) last.tabs.push(t);
		else groups.push({ name: t.group, tabs: [t] });
	}
	return groups
		.map(
			(g) =>
				`<div class="rd-doc__group">${g.name ? `<p class="rd-doc__label">${esc(g.name)}</p>` : ""}` +
				g.tabs
					.map(
						(t) =>
							`<a role="tab" id="tab-${esc(t.id)}" href="?tab=${esc(t.id)}" aria-controls="${esc(t.id)}" aria-selected="${t === tabs[0] ? "true" : "false"}">` +
							`${t.icon ? icon(t.icon) : ""}<span>${esc(t.label)}</span></a>`,
					)
					.join("") +
				`</div>`,
		)
		.join("");
}

// One head per page (the bar's page title and sub); the shown one is unhidden.
function heads(tabs: DocTab[]): string {
	return tabs
		.map(
			(t, i) =>
				`<div class="rd-doc__head" data-for="${esc(t.id)}"${i ? " hidden" : ""}>` +
				`<h2>${esc(t.label)}</h2><p>${t.sub ? esc(t.sub) : ""}</p></div>`,
		)
		.join("");
}

// The bar's section nav: one group per page (its <h2> sections, a link each), the shown page's group unhidden.
// A page with fewer than two sections has no links; with none anywhere the nav ships hidden.
function subnav(tabs: DocTab[], pages: Page[]): string {
	const groups = tabs
		.map((t, i) => {
			const secs = pages.find((p) => p.id === t.id)?.secs ?? [];
			const links =
				secs.length > 1
					? secs.map((s, j) => `<a href="#${esc(encodeURIComponent(s.id))}" data-sub="${esc(s.id)}"${j ? "" : " aria-current"}>${esc(s.text)}</a>`).join("")
					: "";
			return `<div data-for="${esc(t.id)}"${i ? " hidden" : ""}>${links}</div>`;
		})
		.join("");
	const any = tabs.some((t) => (pages.find((p) => p.id === t.id)?.secs.length ?? 0) > 1);
	return `<nav class="rd-doc__subnav" aria-label="Sections"${any ? "" : " hidden"}>${groups}</nav>`;
}

// On this page: one list per page per section (the section's own headings below its h2; a page with no such
// section is one list of itself). The default view shows the first page's first list; when it is empty the rail
// ships is-empty (quiet space) and the frame data-rail-empty (no toc toggle), as doc.js's showSub settles it.
function rail(tabs: DocTab[], pages: Page[], rails: Record<string, DocRail>): { inner: string; empty: boolean } {
	const lists: string[] = [];
	let empty = false;
	tabs.forEach((t, ti) => {
		const p = pages.find((x) => x.id === t.id);
		const slots = p ? slotsOf(p, rails) : [{ sub: "", items: rails[t.id] ?? [] }];
		slots.forEach((slot, si) => {
			const isDefault = ti === 0 && si === 0;
			if (isDefault) empty = slot.items.length === 0;
			lists.push(
				`<ol data-for="${esc(t.id)}" data-sub="${esc(slot.sub)}"${isDefault ? "" : " hidden"}>` +
					slot.items.map((r) => `<li class="is-l${r.level}"><a href="#${esc(r.id)}">${esc(r.text)}</a></li>`).join("") +
					`</ol>`,
			);
		});
	});
	return {
		inner:
			`<p class="rd-doc__rail-label">On this page</p>${lists.join("")}` +
			`<p class="rd-doc__rail-empty"${empty ? "" : " hidden"}>Nothing to list on this page.</p>`,
		empty,
	};
}

// Previous/next for each page's first stop, in order (doc.js's stops(): a page with no sections is one stop;
// otherwise one per section). doc.js re-renders the shown page's links when a later section is shown.
function pager(tabs: DocTab[], pages: Page[]): string {
	const stops = tabs.flatMap((t, pi) => {
		const secs = pages.find((p) => p.id === t.id)?.secs ?? [];
		if (!secs.length) return [{ pi, label: t.label, href: `?tab=${encodeURIComponent(t.id)}`, id: null as string | null }];
		return secs.map((s, si) => ({ pi, label: secs.length > 1 ? `${t.label}: ${s.text}` : t.label, href: `?tab=${encodeURIComponent(t.id)}`, id: si ? s.id : null }));
	});
	const divs = tabs
		.map((t, i) => {
			const at = stops.findIndex((s) => s.pi === i && !s.id);
			const prev = stops[at - 1];
			const next = stops[at + 1];
			const link = (s: (typeof stops)[number], dir: "prev" | "next"): string => {
				const same = s.pi === i && s.id;
				const href = same ? "#" + encodeURIComponent(s.id!) : s.href + (s.id ? "#" + encodeURIComponent(s.id) : "");
				return (
					`<a class="rd-doc__pager-${dir}" href="${esc(href)}">` +
					`<span class="rd-doc__pager-dir">${dir === "next" ? "Next" : "Previous"}${icon(dir === "next" ? "arrow-right" : "arrow-left")}</span>` +
					`<span class="rd-doc__pager-title">${esc(s.label)}</span></a>`
				);
			};
			const inner = (prev ? link(prev, "prev") : "<span></span>") + (next ? link(next, "next") : "");
			return `<div data-for="${esc(t.id)}"${i ? " hidden" : ""}>${inner}</div>`;
		})
		.join("");
	const any = divs.includes("<a ");
	return `<nav class="rd-doc__pager" aria-label="Previous and next page"${any ? "" : " hidden"}>${divs}</nav>`;
}

// ---- First-paint selection (?tab= / #) ---------------------------------------

// The generated CSS: for each page, the html attributes the head snippet may set select that page's panel,
// section, bar head, section nav, rail list and pager. Specificity: the show rules carry the most attribute
// selectors, so they beat the hide rules; once doc.js clears the attributes, the DOM state alone applies.
function pageCss(pages: Page[], rails: Record<string, DocRail>): string {
	const rules: string[] = [];
	for (const p of pages) {
		const x = cssId(p.id);
		const slots = slotsOf(p, rails);
		const first = p.secs[0]?.id ? cssId(p.secs[0].id) : "";
		// The first section is shown when no section is picked and when the pick names it (a hash inside it).
		const firstState = first ? `:is(:not([data-rd-sub]),[data-rd-sub="${first}"])` : ":not([data-rd-sub])";
		// !important on the show rules: the pre-rendered hidden attributes and the fragment's own
		// `[hidden] { display: none !important }` (inlined after this block) must not win before doc.js takes over.
		rules.push(
			`html[data-rd-tab="${x}"] .rd-doc__panels > .rd-tabpanel { display: none !important; }`,
			`html[data-rd-tab="${x}"] .rd-doc__panels > .rd-tabpanel[data-rd-tab="${x}"] { display: block !important; }`,
			`html[data-rd-tab="${x}"] .rd-doc__head[data-for] { display: none; }`,
			`html[data-rd-tab="${x}"] .rd-doc__head[data-for="${x}"] { display: flex !important; }`,
			`html[data-rd-tab="${x}"] .rd-doc__subnav > div { display: none; }`,
			`html[data-rd-tab="${x}"] .rd-doc__subnav > div[data-for="${x}"] { display: contents !important; }`,
			`html[data-rd-tab="${x}"] .rd-doc__rail ol[data-for="${x}"] { display: none; }`,
			`html[data-rd-tab="${x}"]${firstState} .rd-doc__rail ol[data-for="${x}"][data-sub="${first}"] { display: block !important; }`,
			`html[data-rd-tab="${x}"] .rd-doc__pager > div { display: none; }`,
			`html[data-rd-tab="${x}"] .rd-doc__pager > div[data-for="${x}"] { display: contents !important; }`,
		);
		if (p.secs.length) {
			rules.push(`html[data-rd-tab="${x}"] .rd-doc__panels .rd-tabpanel[data-rd-tab="${x}"] .rd-tabsec { display: none !important; }`);
			for (const s of p.secs)
				rules.push(
					`html[data-rd-tab="${x}"]${s === p.secs[0] ? firstState : `[data-rd-sub="${cssId(s.id)}"]`} .rd-doc__panels .rd-tabpanel[data-rd-tab="${x}"] .rd-tabsec[data-rd-sec="${cssId(s.id)}"] { display: block !important; }`,
				);
			for (const s of p.secs.slice(1))
				rules.push(`html[data-rd-tab="${x}"][data-rd-sub="${cssId(s.id)}"] .rd-doc__rail ol[data-for="${x}"][data-sub="${cssId(s.id)}"] { display: block; }`);
		}
		// The rail's state for the picked section: the pre-rendered is-empty / data-rail-empty describe the default
		// view only, so a pick shows the section's list and label (and keeps the rail quiet space, with no toc
		// toggle, when it has nothing to list) until doc.js settles the DOM.
		slots.forEach((s, si) => {
			const sel = `html[data-rd-tab="${x}"]${si === 0 ? firstState : `[data-rd-sub="${cssId(s.sub)}"]`}`;
			if (s.items.length)
				rules.push(`${sel} .rd-doc__rail :is(.rd-doc__rail-label, ol[data-for="${x}"][data-sub="${cssId(s.sub)}"]) { visibility: visible; }`);
			rules.push(`${sel} .rd-doc [data-rd-doc-toggle="toc"] { visibility: ${s.items.length ? "visible" : "hidden"}; }`);
		});
		if (p !== pages[0]) rules.push(`html[data-rd-tab="${x}"] .rd-doc__intro { display: none; }`);
		// The page list's highlight follows the selected page.
		rules.push(
			`html[data-rd-tab="${x}"] .rd-doc__nav a[aria-selected="true"]:not([aria-controls="${x}"]) { background: transparent; color: var(--rd-text); font-weight: 400; box-shadow: none; }`,
			`html[data-rd-tab="${x}"] .rd-doc__nav a[aria-controls="${x}"] { background: var(--rd-surface); color: var(--rd-accent-ink); font-weight: 600; box-shadow: 0 0 0 1px var(--rd-line-soft); }`,
		);
	}
	return rules.join("\n");
}

// The head snippet: attribute-only, synchronous, no DOM building. It sets html[data-rd-tab] to the ?tab= value
// (or a legacy #<tab-id> hash) and html[data-rd-sub] to the section that holds the #hash, from the map of the
// page's h2/h3/h4 ids (and the panel ids). A hash that names nothing known leaves the default view in place.
function picker(pages: Page[]): string {
	const M: Record<string, Record<string, string>> = {};
	for (const p of pages) {
		const m: Record<string, string> = {};
		m[decode(p.id)] = p.secs[0]?.id ? decode(p.secs[0].id) : "";
		for (const hm of p.chunk.matchAll(/<h[234]\b[^>]*\bid="([^"]+)"[^>]*>/g)) m[decode(hm[1])] = decode(slotAt(p, p.end + hm.index!));
		M[decode(p.id)] = m;
	}
	for (const [k, v] of Object.entries(M)) if (k.includes("</") || Object.values(v).some((s) => s.includes("</"))) throw new Error(`picker map id unsafe: ${k}`);
	const js = `(function(){document.documentElement.classList.add("js");var M=${JSON.stringify(M)};var q=new URLSearchParams(location.search).get("tab");var h=location.hash?decodeURIComponent(location.hash.slice(1)):null;var t=(q&&M[q])?q:(h&&M[h]?h:null);if(!t)return;document.documentElement.setAttribute("data-rd-tab",t);if(h&&M[t][h])document.documentElement.setAttribute("data-rd-sub",M[t][h]);})();`;
	return `<script data-rd-tab-pick>${js}</script>`;
}

/** The <body> content for the Doc design (a generated <style data-rd-doc> leads it) plus the head picker script.
    The caller adds the sprite, page CSS and scripts, and the host chrome. */
export function renderDoc(d: DocInput): { body: string; picker: string } {
	const pages = pagesOf(d.body);
	const body0 = prepBody(d.body, pages);
	const stamp = `<span class="rd-stamp"><span class="rd-stamp__sep"> · </span>created ${esc(d.created)} · updated ${esc(d.updated)}</span>`;
	const brand =
		`<div class="rd-doc__brand">` +
		(d.section ? `<a class="rd-doc__kind" href="${esc(d.section.href)}">${esc(d.section.label)}</a>` : "") +
		`<p class="rd-doc__title">${esc(d.title)}</p>` +
		`<span class="rd-stamp"><span>created ${esc(d.created)}</span><span>updated ${esc(d.updated)}</span></span>` +
		`<p>${esc(d.summary)}</p>` +
		`</div>`;
	const bar =
		`<header class="rd-doc__bar"><div class="rd-doc__row">` +
		`<button type="button" class="rd-doc__btn" data-rd-doc-toggle="nav" aria-controls="rd-doc-side" aria-expanded="false" aria-label="Show or hide the page list" title="Pages">${icon("panel-left")}</button>` +
		heads(d.tabs) +
		`<button type="button" class="rd-doc__btn" data-rd-doc-search aria-label="Search this document" title="Search ( / )">${icon("search")}</button>` +
		`<button type="button" class="rd-doc__btn" data-rd-doc-toggle="toc" aria-controls="rd-doc-toc" aria-expanded="false" aria-label="Show or hide On this page" title="On this page">${icon("panel-right")}</button>` +
		`</div>${subnav(d.tabs, pages)}</header>`;
	const intro =
		`<div class="rd-doc__intro"><p class="rd-eyebrow">${esc(d.eyebrow)}</p>` +
		`<h1>${esc(d.title)}${stamp}</h1><p class="rd-hero__lede">${esc(d.summary)}</p></div>`;
	const search =
		`<dialog class="rd-doc__search" aria-label="Search this document"><div class="rd-doc__search-panel">` +
		`<div class="rd-doc__search-box">${icon("search")}<input type="search" placeholder="Search this document" aria-label="Search this document" autocomplete="off"><kbd>Esc</kbd></div>` +
		`<ul class="rd-doc__search-results"></ul><p class="rd-doc__search-hint"></p></div></dialog>`;
	const railHtml = rail(d.tabs, pages, d.rails);
	const frame =
		`<div class="rd-doc" data-rd="doc" data-first${railHtml.empty ? " data-rail-empty" : ""}>` +
		`<aside class="rd-doc__side" id="rd-doc-side" aria-label="Pages">${brand}` +
		`<nav class="rd-doc__nav" role="tablist" aria-orientation="vertical" aria-label="Pages" data-rd="tabs" data-rd-offset=".rd-doc__bar">${nav(d.tabs)}</nav></aside>` +
		`<main class="rd-doc__main" data-page="${esc(d.slug)}" data-density="comfortable" data-pagefind-body="${d.indexed ? "" : "false"}">` +
		bar +
		intro +
		`<div class="rd-doc__panels rd-prose">${body0}</div>` +
		pager(d.tabs, pages) +
		`<button type="button" class="rd-doc__totop" data-rd-doc-totop>${icon("arrow-up")}Back to top</button>` +
		`</main>` +
		`<aside class="rd-doc__rail${railHtml.empty ? " is-empty" : ""}" id="rd-doc-toc" aria-label="On this page">${railHtml.inner}</aside>` +
		`<div class="rd-doc__scrim" hidden></div>` +
		`</div>` +
		search;
	const style = `<style data-rd-doc>\n/* First-paint selection for ?tab= / # (the head script sets html[data-rd-tab]/[data-rd-sub]; doc.js clears both once the DOM matches). */\n${pageCss(pages, d.rails)}\n</style>`;
	return { body: style + frame, picker: picker(pages) };
}
