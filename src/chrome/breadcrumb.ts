import { esc } from "./util";

// Breadcrumb band (.rd-crumb-band) and trail (.rd-breadcrumb) in research.css. Every page on the design system gets the
// band at the top of <body>: sticky under the navbar card, opaque, in its frame, holding the trail. A page with no trail
// (opt-out or no title) gets an empty band, so the content never shows through the gap. Pages without the design
// system stylesheet get neither (their own shell). Opt out of the trail with: <meta name="rd-breadcrumb" content="off">
export const CRUMB_MARKER = "data-site-breadcrumb";
const OPT_OUT_CRUMB = /<meta[^>]+name=["']rd-breadcrumb["'][^>]+content=["']off["']/i;
// Section label by first path segment. A page at the section's own URL (/design-system/) is its own current item.
const SECTIONS: Record<string, string> = { research: "Research", playground: "Playground", ideas: "Ideas", "design-system": "Design system" };
const DATE_SUFFIX = /\s*·\s*created\s+\d{4}-\d{2}-\d{2}\s*·\s*updated\s+\d{4}-\d{2}-\d{2}\s*$/;

export function addBreadcrumb(html: string, urlPath: string, base: string, site: string): string {
	if (html.includes(CRUMB_MARKER) || !(/design-system\/(?:research|rd)\.css/.test(html) || html.includes(".rd-crumb-band {"))) return html;
	// Find the real tags: style, script and comment text can mention "<body" or "<main" (inlined CSS comments do).
	const masked = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/gi, (m) => " ".repeat(m.length));
	const main = masked.match(/<main\b[^>]*>/i);
	const mainTag = main?.[0] ?? "";
	// After <body>; a fragment export with no <body> tag gets it before its first body element (the first tag that cannot
	// live in <head>), which is where the parser opens <body>.
	const body = masked.match(/<body(?=[\s>])[^>]*>/i);
	const firstBodyTag = masked.match(/<(?!\/|!|(?:html|head|title|meta|link|style|script|base|noscript)\b)[a-z][^>]*>/i);
	const at = body?.index !== undefined ? body.index + body[0].length : firstBodyTag?.index;
	if (at === undefined) return html;
	// The trail lines up with the page's text column: rd-container (default), --wide, rd-tabbed, or a page-owned column.
	const tabbed = /\brd-tabbed\b/.test(mainTag);
	const wide = !tabbed && /\brd-container--wide\b/.test(mainTag);
	const own = !tabbed && !/\brd-container\b/.test(mainTag);
	const title = pageTitle(html);
	const crumb = OPT_OUT_CRUMB.test(html) || !title ? "" : trailMarkup(urlPath, title, base, site);
	const cls = ["rd-crumb-band", wide ? "rd-crumb-band--wide" : "", tabbed ? "rd-crumb-band--tabbed" : "", own ? "rd-crumb-band--page" : "", crumb ? "" : "rd-crumb-band--empty"].filter(Boolean).join(" ");
	return html.slice(0, at) + `<div class="${cls}" ${CRUMB_MARKER}>${crumb}</div>` + html.slice(at);
}

// The trail for one page: JSON-LD BreadcrumbList plus the visible nav (Home > section > page; current item is text).
function trailMarkup(urlPath: string, title: string, base: string, site: string): string {
	const segs = urlPath.split("/").filter(Boolean);
	const section = SECTIONS[segs[0] ?? ""];
	const onSection = !!section && segs.length === 1;
	const trail: { name: string; url: string }[] = [{ name: "Home", url: "/" }];
	if (section && !onSection) trail.push({ name: section, url: `/${segs[0]}/` });
	trail.push({ name: onSection ? section : title, url: urlPath });
	const prefix = base.replace(/\/$/, "");
	const abs = (p: string) => new URL(prefix + p, site).href;
	const ld = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: abs(t.url) })) };
	const items = trail
		.map((t, i) => (i === trail.length - 1
			? `<li><span aria-current="page" title="${esc(t.name)}">${esc(t.name)}</span></li>`
			: `<li><a href="${esc(prefix + t.url)}">${esc(t.name)}</a></li>`))
		.join("");
	return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` +
		`<nav class="rd-breadcrumb" aria-label="Breadcrumb" data-pagefind-ignore><ol>${items}</ol></nav>`;
}

// The page's own title (its <title>, or its h1), without the "· created · updated" stamp.
function pageTitle(html: string): string {
	const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
	const text = raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
	const decoded = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
	return decoded.replace(DATE_SUFFIX, "").trim();
}
