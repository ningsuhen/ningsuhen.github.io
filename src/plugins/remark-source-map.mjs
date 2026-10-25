import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseOwnerMarkers } from "./owner-markers.mjs";

/**
 * Source map for in-place editing (the browser extension's post editor reads it).
 *
 * Every top-level block gets `data-src="<first>-<last>"` (1-based, inclusive lines of the post's
 * index.md) and `data-src-kind`: `text` when it round-trips as prose, `raw` when it must be edited as
 * source. The frontmatter gets `editSource` ({ path, blob }), which the post page emits as
 * `<meta name="edit-source">`; `blob` is the git blob SHA of the file, so the editor can prove the
 * page was built from the file it is about to change. Runs last: sectionize has wrapped the blocks
 * and directives are resolved by then.
 */
const TEXT_BLOCKS = new Set(["paragraph", "heading", "list", "blockquote"]);
// Inline content the editor cannot serialize back to Markdown.
const RAW_INLINE = new Set([
	"image",
	"imageReference",
	"linkReference",
	"footnoteReference",
	"html",
	"textDirective",
	"leafDirective",
	"containerDirective",
	"math",
	"code",
	"table",
]);

function isText(node) {
	if (!TEXT_BLOCKS.has(node.type)) return false;
	let ok = true;
	const visit = (n) => {
		if (!ok) return;
		if (
			RAW_INLINE.has(n.type) ||
			(n.type === "listItem" && typeof n.checked === "boolean")
		) {
			ok = false;
			return;
		}
		for (const c of n.children ?? []) visit(c);
	};
	for (const c of node.children ?? []) visit(c);
	return ok;
}

export function remarkSourceMap({ root }) {
	return (tree, file) => {
		if (!file.path) return;
		const raw = readFileSync(file.path);
		const text = raw.toString("utf8");
		// Astro hands remark the body with the frontmatter cut (or blanked) and the ends trimmed:
		// its first line is the file line after `at`'s preceding newlines.
		const at = text.indexOf(String(file.value));
		if (at < 0) return;
		const offset = text.slice(0, at).split("\n").length - 1;

		const stamp = (parent) => {
			for (const node of parent.children ?? []) {
				if (node.type === "section") {
					stamp(node);
					continue;
				}
				const pos = node.position;
				if (!pos?.start?.line || !pos?.end?.line) continue;
				node.data ??= {};
				node.data.hProperties = {
					...node.data.hProperties,
					dataSrc: `${pos.start.line + offset}-${pos.end.line + offset}`,
					dataSrcKind: isText(node) ? "text" : "raw",
				};
			}
		};
		stamp(tree);

		const blob = createHash("sha1")
			.update(`blob ${raw.length}\0`)
			.update(raw)
			.digest("hex");
		file.data.astro.frontmatter.editSource = {
			path: path.relative(root, file.path).split(path.sep).join("/"),
			blob,
			// Count only (the editor reads the markers from the source); no marker text is shipped.
			markers: parseOwnerMarkers(text).length,
		};
	};
}
