/**
 * Owner markers: hidden notes an agent leaves in a post where it needs the owner's input.
 *
 * Syntax (an HTML comment on its own lines, directly above the block it is about):
 *
 *   <!-- owner:question Why did you build the simulation? -->
 *   <!-- owner:scene What made you start?
 *   draft: I wanted to see ... -->
 *
 * Types: question (ask the owner), confirm (check a reading or wording), scene (a missing personal
 * reason or moment), voice (does this sound like you), fact (a fact or source to supply or check).
 * The anchor is the first block that starts after the marker (its `data-src` start line); a marker
 * before a heading is about that section. `draft:` is an optional suggested wording, never published.
 *
 * `manual` is different: not a to-do but a lock. `<!-- owner:manual -->` (any text after the type is
 * ignored, no `draft:`) sits above one block the owner wrote or edited by hand, and covers that block
 * only (a heading too means just the heading line; several manual blocks get one marker each). Keep
 * that block verbatim: fix only grammar and punctuation; rephrase only on the owner's instruction or
 * for an unavoidable reason stated in the PR. It is never counted as unresolved (`isOpenMarker`).
 *
 * Markers never reach readers: `remarkOwnerMarkers` drops them from the tree (so no HTML, excerpt,
 * reading time or search index), the RSS feed strips them from the raw body (`stripOwnerMarkers`),
 * and `pnpm check:markers` fails if any marker text shows up in dist/. The editor reads them from
 * the Markdown source it already fetches (see CLAUDE.md, "Owner markers").
 */

export const MARKER_TYPES = /** @type {const} */ ([
	"question",
	"confirm",
	"scene",
	"voice",
	"fact",
	"manual",
]);

const MARKER_RE = new RegExp(
	`<!--\\s*owner:(${MARKER_TYPES.join("|")})\\b([\\s\\S]*?)-->`,
	"g",
);
/** Any comment that starts like a marker, valid or not (a typo must not slip through to readers). */
const ANY_MARKER_RE = /<!--\s*owner:[\s\S]*?-->/g;

/**
 * @typedef {{ type: (typeof MARKER_TYPES)[number], text: string, draft?: string,
 *   line: number, endLine: number, anchorLine?: number }} OwnerMarker
 */

/** Line (1-based) of a character offset. */
const lineAt = (src, i) => src.slice(0, i).split("\n").length;

/**
 * Every marker in a Markdown file, with its source lines and anchor line (the first non-blank line
 * after the marker that is not another marker; undefined at the end of the file).
 * @param {string} src
 * @returns {OwnerMarker[]}
 */
export function parseOwnerMarkers(src) {
	const lines = src.split("\n");
	const spans = [...src.matchAll(MARKER_RE)].map((m) => ({
		m,
		line: lineAt(src, m.index),
		endLine: lineAt(src, m.index + m[0].length),
	}));
	const markerLines = new Set(
		spans.flatMap((s) =>
			Array.from({ length: s.endLine - s.line + 1 }, (_, k) => s.line + k),
		),
	);
	return spans.map(({ m, line, endLine }) => {
		const [, type, body] = m;
		const [text, ...rest] =
			type === "manual" ? [""] : body.split(/^\s*draft:\s*/m);
		let anchorLine;
		for (let n = endLine + 1; n <= lines.length; n++) {
			if (lines[n - 1].trim() && !markerLines.has(n)) {
				anchorLine = n;
				break;
			}
		}
		const draft = rest.join("draft: ").trim();
		return {
			type: /** @type {OwnerMarker["type"]} */ (type),
			text: text.trim().replace(/\s+/g, " "),
			...(draft ? { draft } : {}),
			line,
			endLine,
			...(anchorLine ? { anchorLine } : {}),
		};
	});
}

/** A marker that waits on the owner (every type but `manual`, which only locks its block). */
export const isOpenMarker = (m) => m.type !== "manual";

/** The Markdown with every marker comment removed (for outputs built from the raw body, like RSS). */
export const stripOwnerMarkers = (src) => src.replace(ANY_MARKER_RE, "");

const isMarkerNode = (node) =>
	node.type === "html" && /^\s*<!--\s*owner:/.test(node.value);

/** Remark plugin, first in the chain: drops marker nodes so nothing downstream sees them. */
export function remarkOwnerMarkers() {
	const prune = (parent) => {
		if (!parent.children) return;
		parent.children = parent.children.filter((c) => !isMarkerNode(c));
		for (const c of parent.children) prune(c);
	};
	return (tree) => prune(tree);
}
