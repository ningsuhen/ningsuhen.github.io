/**
 * Turns the rendered article into speakable sentences.
 *
 * Each sentence keeps a DOM Range (for the highlight) and one or more speech units (chunks of at most
 * CHUNK_BUDGET characters, split at clause boundaries). Skipped: code, KaTeX (its aria-label or "equation"),
 * tables (announced, not read), footnote and citation markers, anchors, copy buttons and anything marked
 * data-no-listen. Figure captions are read; image alt text is not.
 */
import type { SpeechUnit } from "./engine";
import { chunkForBudget, normalizeForSpeech } from "./normalize";

export interface Sentence {
	id: string;
	/** Block element that holds the sentence (paragraph, heading, list item, caption or table). */
	block: HTMLElement;
	/** Covers the sentence in the DOM. Null only for synthetic announcements. */
	range: Range | null;
	units: SpeechUnit[];
}

const SKIP = [
	"pre",
	".expressive-code",
	"script",
	"style",
	"button",
	"nav",
	".copy-btn",
	".katex-mathml",
	".footnotes",
	".anchor",
	"a[href^='#fn']",
	"a[href^='#user-content-fn']",
	"[data-no-listen]",
	"[aria-hidden='true']",
	"img",
	"#comments",
	".license-container",
	".listen-player",
].join(",");

const BLOCK =
	"p, h1, h2, h3, h4, h5, h6, li, figcaption, blockquote, dd, dt, .katex-display";
const ABBREVIATION_END =
	/(\b(?:Dr|Mr|Mrs|Ms|Fig|Eq|No|vs|al|e\.g|i\.e|etc)\.)\s*$/i;

type Piece = { text: string; node: Text } | { text: string; el: Element };

function gather(parent: Node, out: Piece[]): void {
	for (const child of Array.from(parent.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent ?? "";
			if (text) out.push({ text, node: child as Text });
			continue;
		}
		if (!(child instanceof Element) || child.matches(SKIP)) continue;
		if (child.matches(".katex")) {
			out.push({
				text: ` ${child.getAttribute("aria-label") ?? "equation"} `,
				el: child,
			});
			continue;
		}
		// Superscript numbers are footnote or citation markers.
		if (
			child.tagName === "SUP" &&
			/^\[?\d+\]?$/.test(child.textContent?.trim() ?? "")
		)
			continue;
		gather(child, out);
	}
}

function isLeafBlock(el: Element): boolean {
	return !el.querySelector(BLOCK) && !el.closest("table") && !el.closest(SKIP);
}

function splitSentences(text: string, lang: string): Array<[number, number]> {
	const raw: Array<[number, number]> = [];
	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		const seg = new Intl.Segmenter(lang || "en", { granularity: "sentence" });
		for (const s of seg.segment(text))
			raw.push([s.index, s.index + s.segment.length]);
	} else {
		let start = 0;
		for (const m of text.matchAll(/[.!?]+\s+(?=[A-Z0-9"'(])/g)) {
			const end = (m.index ?? 0) + m[0].length;
			raw.push([start, end]);
			start = end;
		}
		raw.push([start, text.length]);
	}
	// Merge fragments that ended at an abbreviation ("Dr. Smith") so they are not split.
	const merged: Array<[number, number]> = [];
	for (const [s, e] of raw) {
		const last = merged[merged.length - 1];
		if (last && ABBREVIATION_END.test(text.slice(last[0], last[1])))
			last[1] = e;
		else merged.push([s, e]);
	}
	return merged.filter(([s, e]) => text.slice(s, e).trim().length > 0);
}

function tableSentence(table: HTMLTableElement, id: string): Sentence {
	const caption = table.caption?.textContent?.trim();
	const spoken = caption
		? normalizeForSpeech(`Table: ${caption}. See page.`)
		: "Table, see page.";
	const range = document.createRange();
	range.selectNode(table);
	return { id, block: table, range, units: [{ sentenceId: id, text: spoken }] };
}

/** Builds the sentence list for one article root, in document order. */
export function extractSentences(root: HTMLElement): Sentence[] {
	const lang =
		root.closest("[lang]")?.getAttribute("lang") ??
		document.documentElement.lang;
	const sentences: Sentence[] = [];
	const push = (
		block: HTMLElement,
		range: Range | null,
		text: string,
	): void => {
		const id = `s${sentences.length}`;
		const units = chunkForBudget(text).map((chunk) => ({
			sentenceId: id,
			text: chunk,
		}));
		sentences.push({ id, block, range, units });
	};

	for (const block of Array.from(
		root.querySelectorAll<HTMLElement>(`${BLOCK}, table`),
	)) {
		if (block instanceof HTMLTableElement) {
			if (!block.closest(SKIP))
				sentences.push(tableSentence(block, `s${sentences.length}`));
			continue;
		}
		if (!isLeafBlock(block)) continue;
		const pieces: Piece[] = [];
		gather(block, pieces);
		const blockText = pieces.map((p) => p.text).join("");
		if (!blockText.trim()) continue;

		for (const [start, end] of splitSentences(blockText, lang)) {
			const raw = blockText.slice(start, end);
			const speech = normalizeForSpeech(raw);
			if (!/[\p{L}\p{N}]/u.test(speech)) continue;
			const range = rangeFor(pieces, start, end);
			push(block, range, speech);
		}
	}

	return sentences;
}

function rangeFor(pieces: Piece[], start: number, end: number): Range | null {
	const range = document.createRange();
	let offset = 0;
	let startSet = false;
	for (const piece of pieces) {
		const pieceStart = offset;
		const pieceEnd = offset + piece.text.length;
		offset = pieceEnd;
		if (pieceEnd <= start || pieceStart >= end) continue;
		if ("node" in piece) {
			const from = Math.max(start, pieceStart) - pieceStart;
			const to = Math.min(end, pieceEnd) - pieceStart;
			if (!startSet) {
				range.setStart(piece.node, from);
				startSet = true;
			}
			range.setEnd(piece.node, to);
		} else {
			if (!startSet) {
				range.setStartBefore(piece.el);
				startSet = true;
			}
			range.setEndAfter(piece.el);
		}
	}
	return startSet ? range : null;
}
