// Page opt-outs written as <meta name="…" content="off">. Shared by the build (src/chrome) and the checks, so a page
// is judged the same way in both, whatever order its exporter wrote the two attributes in.

/** True when `html` has `<meta name="<name>" content="off">` (attribute order and case do not matter). */
export function metaOff(html, name) {
	const attr = (tag, key) => tag.match(new RegExp(`\\s${key}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1]?.toLowerCase();
	for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
		if (attr(tag, "name") === name && attr(tag, "content") === "off") return true;
	}
	return false;
}
