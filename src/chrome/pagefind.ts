// Pagefind indexes the visible text of each standalone page. Left to its own devices it would index the
// injected chrome too (navbar links, breadcrumb, license footer), so scope it to the page's content column
// with data-pagefind-body on <main>. Large data tables (reference tables with many rows) are data, not prose;
// mark them data-pagefind-ignore so their blobs don't pollute the index. Opt a whole page out with:
// <meta name="pagefind" content="off"> — the page is then skipped entirely.
const PAGEFIND_BODY = "data-pagefind-body";
const OPT_OUT = /<meta[^>]+name=["']pagefind["'][^>]+content=["']off["']/i;
// Tables with more rows than this are data blobs, not prose (reference tables top out around 20 rows).
const DATA_TABLE_ROWS = 30;

export function addPagefindBody(html: string): string {
	// A page that already manages its own indexing is left alone.
	if (html.includes(PAGEFIND_BODY)) return html;
	const masked = mask(html);

	// Whole-page opt-out: mark <body> so Pagefind skips the page.
	if (OPT_OUT.test(html)) return addAttr(html, masked, /<body(?=[\s>])[^>]*>/i, "data-pagefind-ignore");

	// Scope indexing to the content column, then ignore the large data tables inside it.
	return ignoreDataTables(addAttr(html, masked, /<main\b[^>]*>/i, PAGEFIND_BODY));
}

// Add `attr` to the first tag matching `re`. Positions come from the masked copy, which is length-preserving,
// so they line up with the original.
function addAttr(html: string, masked: string, re: RegExp, attr: string): string {
	const m = masked.match(re);
	if (!m || m.index === undefined) return html;
	const tag = m[0];
	const close = tag.endsWith("/>") ? tag.length - 2 : tag.lastIndexOf(">");
	if (close === -1) return html;
	return html.slice(0, m.index + close) + ` ${attr}` + html.slice(m.index + close);
}

// Mark tables with more than DATA_TABLE_ROWS rows as data-pagefind-ignore.
function ignoreDataTables(html: string): string {
	const masked = mask(html);
	const re = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
	let out = html;
	let offset = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(masked)) !== null) {
		const table = m[0];
		const rows = (table.match(/<tr/gi) ?? []).length;
		if (rows <= DATA_TABLE_ROWS || table.includes("data-pagefind-ignore")) continue;
		const at = m.index + offset;
		const tagEnd = table.indexOf(">") + 1;
		out = out.slice(0, at + tagEnd) + " data-pagefind-ignore" + out.slice(at + tagEnd);
		offset += " data-pagefind-ignore".length;
	}
	return out;
}

// Blank out style/script/comment text (length-preserving) so a mention of "<body" or "<main" in inlined CSS,
// JS or a comment is not mistaken for a real tag.
function mask(html: string): string {
	return html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/gi, (s) => " ".repeat(s.length));
}
