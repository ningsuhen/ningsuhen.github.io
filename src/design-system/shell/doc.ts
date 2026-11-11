// The Doc design's markup: the frame around a fragment body (components/doc.css, js/doc.js). The Card design is the
// shell's other branch (StandaloneShell.astro); both take the same body, tabs and rails from the fragment loader.
//
// Kept free of Astro and of the site's chrome so another host (the document generator) can render the same frame:
// the caller passes the body and the derived tabs and rails, and wraps the result in its own document and chrome.
//
// Three levels for large content: the left sidebar lists the pages (the fragment's tabs), the bar's nav lists the shown
// page's sections (its <h2 id> sections; doc.js fills it), the right sidebar lists the headings inside the shown section.
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

function rail(tabs: DocTab[], rails: Record<string, DocRail>): string {
	// One list per page; doc.js shows the shown page's. Rail text is already HTML (the loader strips tags only).
	const lists = tabs
		.filter((t) => rails[t.id]?.length)
		.map(
			(t, i) =>
				`<ol data-for="${esc(t.id)}"${i ? " hidden" : ""}>` +
				rails[t.id].map((r) => `<li class="is-l${r.level}"><a href="#${esc(r.id)}">${r.text}</a></li>`).join("") +
				`</ol>`,
		)
		.join("");
	return `<p class="rd-doc__rail-label">On this page</p>${lists}<p class="rd-doc__rail-empty" hidden>Nothing to list on this page.</p>`;
}

// The first page's sections, by doc.js's rule (sectionOf): a <section> (or .rd-tabsec) that opens with its head (a
// <header> or .rd-section__head holding the <h2>) or with the <h2>; its id is the h2's, else the head's, else its own.
const idOf = (attrs: string | undefined) => attrs?.match(/\bid="([^"]+)"/)?.[1] ?? null;
function sectionsOf(chunk: string): { id: string; text: string }[] {
	const out: { id: string; text: string }[] = [];
	for (const m of chunk.matchAll(/<(section|div)\b([^>]*)>/g)) {
		if (/\bdata-rd-tab=/.test(m[2]) || (m[1] === "div" && !/\brd-tabsec\b/.test(m[2]))) continue;
		const rest = chunk.slice(m.index! + m[0].length);
		const head = rest.match(/^\s*<(header|div)\b([^>]*)>/);
		if (head && head[1] === "div" && !/\brd-section__head\b/.test(head[2])) continue;
		const h2 = (head ? rest.slice(head[0].length) : rest).match(head ? /^(?:(?!<\/?section\b)[\s\S])*?<h2\b([^>]*)>([\s\S]*?)<\/h2>/ : /^\s*<h2\b([^>]*)>([\s\S]*?)<\/h2>/);
		if (!h2) continue;
		const id = idOf(h2[1]) ?? idOf(head?.[2]) ?? idOf(m[2]);
		if (id) out.push({ id, text: h2[2].replace(/<[^>]+>/g, "").trim() });
	}
	return out;
}

// The bar's section nav for the first page, as doc.js builds it (one link per section, the first current), so a load with
// no ?tab paints the bar at its final height. doc.js rebuilds it for whichever page it shows.
function subnav(tabs: DocTab[], body: string): string {
	const at = tabs[0] ? body.indexOf(`data-rd-tab="${tabs[0].id}"`) : -1;
	const next = tabs[1] ? body.indexOf(`data-rd-tab="${tabs[1].id}"`) : -1;
	const secs = at < 0 ? [] : sectionsOf(body.slice(body.indexOf(">", at) + 1, next > at ? body.lastIndexOf("<", next) : body.length));
	if (secs.length < 2) return `<nav class="rd-doc__subnav" aria-label="Sections" hidden></nav>`;
	const links = secs.map((s, i) => `<a href="#${esc(encodeURIComponent(s.id))}" data-sub="${esc(s.id)}"${i ? "" : " aria-current"}>${s.text}</a>`).join("");
	return `<nav class="rd-doc__subnav" aria-label="Sections">${links}</nav>`;
}

/** The <body> content for the Doc design. The caller adds the sprite, page CSS and scripts, and the host chrome. */
export function renderDoc(d: DocInput): string {
	const first = d.tabs[0];
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
		`<div class="rd-doc__head"><h2>${first ? esc(first.label) : esc(d.title)}</h2><p>${first?.sub ? esc(first.sub) : ""}</p></div>` +
		`<button type="button" class="rd-doc__btn" data-rd-doc-search aria-label="Search this document" title="Search ( / )">${icon("search")}</button>` +
		`<button type="button" class="rd-doc__btn" data-rd-doc-toggle="toc" aria-controls="rd-doc-toc" aria-expanded="false" aria-label="Show or hide On this page" title="On this page">${icon("panel-right")}</button>` +
		`</div>${subnav(d.tabs, d.body)}</header>`;
	const intro =
		`<div class="rd-doc__intro"><p class="rd-eyebrow">${esc(d.eyebrow)}</p>` +
		`<h1>${esc(d.title)}${stamp}</h1><p class="rd-hero__lede">${esc(d.summary)}</p></div>`;
	const search =
		`<dialog class="rd-doc__search" aria-label="Search this document"><div class="rd-doc__search-panel">` +
			`<div class="rd-doc__search-box">${icon("search")}<input type="search" placeholder="Search this document" aria-label="Search this document" autocomplete="off"><kbd>Esc</kbd></div>` +
		`<ul class="rd-doc__search-results"></ul><p class="rd-doc__search-hint"></p></div></dialog>`;
	return (
		// data-first: a load with no ?tab shows the first page's first section, so the cover ships shown (doc.js keeps it
		// for that view and drops it for any other); set late, it would push the whole page down after first paint.
		`<div class="rd-doc" data-rd="doc" data-nav="closed" data-toc="closed" data-first>` +
		`<aside class="rd-doc__side" id="rd-doc-side" aria-label="Pages">${brand}` +
		`<nav class="rd-doc__nav" role="tablist" aria-orientation="vertical" aria-label="Pages" data-rd="tabs" data-rd-offset=".rd-doc__bar">${nav(d.tabs)}</nav></aside>` +
		`<main class="rd-doc__main" data-page="${esc(d.slug)}" data-density="comfortable" data-pagefind-body="${d.indexed ? "" : "false"}">` +
		bar +
		intro +
		`<div class="rd-doc__panels rd-prose">${d.body}</div>` +
		`<nav class="rd-doc__pager" aria-label="Previous and next page" hidden></nav>` +
		`<button type="button" class="rd-doc__totop" data-rd-doc-totop>${icon("arrow-up")}Back to top</button>` +
		`</main>` +
		`<aside class="rd-doc__rail" id="rd-doc-toc" aria-label="On this page">${rail(d.tabs, d.rails)}</aside>` +
		`<div class="rd-doc__scrim" hidden></div>` +
		`</div>` +
		search
	);
}
