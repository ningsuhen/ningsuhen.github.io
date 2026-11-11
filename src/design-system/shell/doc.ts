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
		`</div><nav class="rd-doc__subnav" aria-label="Sections" hidden></nav></header>`;
	const intro =
		`<div class="rd-doc__intro"><p class="rd-eyebrow">${esc(d.eyebrow)}</p>` +
		`<h1>${esc(d.title)}${stamp}</h1><p class="rd-hero__lede">${esc(d.summary)}</p></div>`;
	const search =
		`<dialog class="rd-doc__search" aria-label="Search this document"><div class="rd-doc__search-panel">` +
			`<div class="rd-doc__search-box">${icon("search")}<input type="search" placeholder="Search this document" aria-label="Search this document" autocomplete="off"><kbd>Esc</kbd></div>` +
		`<ul class="rd-doc__search-results"></ul><p class="rd-doc__search-hint"></p></div></dialog>`;
	return (
		`<div class="rd-doc" data-rd="doc" data-nav="closed" data-toc="closed">` +
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
