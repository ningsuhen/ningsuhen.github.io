/**
 * Turns the rendered article into speakable sentences.
 *
 * Each sentence keeps a DOM Range (for the highlight) and one or more speech units. Units split a sentence only
 * when it is long (chunk.ts); each unit carries the pause class that follows it. What is read and how:
 * - prose, headings, list items (ordered ones with their number), captions ("Figure: ..."), quotes ("Quote: ...");
 * - code blocks are announced ("Code block, 12 lines."), tables summarised ("Table with 5 rows. Columns: ..."),
 *   images read only when their alt text says something, simple math read as a phrase, the rest "equation";
 * - never read: buttons, nav, share and licence UI, footnote and citation markers, anchors, icons, emoji.
 * Synthetic announcements (code, table) get a Range over their element so the highlight still lands.
 * Pronunciation fixes (pronounce.ts) change only the spoken text, after the Ranges are fixed, so highlights hold.
 */
import {
	admonitionSpeech,
	captionPrefix,
	codeBlockSpeech,
	imageSpeech,
	inlineCodeSpeech,
	listItemPrefix,
	QUOTE_PREFIX,
	tableSpeech,
	texToSpeech,
	withTerminalPunctuation,
} from "./announce";
import {
	type PauseClass,
	pauseClass,
	splitFirstSentence,
	splitSentence,
	withPauses,
} from "./chunk";
import type { SpeechUnit } from "./engine";
import { normalizeForSpeech } from "./normalize";
import { applyPronunciations, type Pronunciations } from "./pronounce";

/** A speech unit plus the pause that follows it (see chunk.ts and pauses.ts). */
export interface SentenceUnit extends SpeechUnit {
	pause: PauseClass;
}

/** What the sentence came from. Text is prose; the others are announcements. */
export type SentenceKind = "text" | "code" | "table" | "math" | "image";

export interface Sentence {
	id: string;
	/** Block element that holds the sentence (paragraph, heading, list item, caption, table or code block). */
	block: HTMLElement;
	/** Covers the sentence in the DOM. Null only for synthetic announcements. */
	range: Range | null;
	units: SentenceUnit[];
	kind: SentenceKind;
}

/** Never read, and nothing inside is read. */
const SKIP = [
	"script",
	"style",
	"button",
	"nav",
	"footer",
	"form",
	"input",
	"select",
	"textarea",
	"svg",
	"audio",
	"video",
	"iframe",
	"canvas",
	"noscript",
	"template",
	"[role='button']",
	"[role='navigation']",
	".copy-btn",
	".btn-card",
	".katex-mathml",
	".footnotes",
	"[data-footnotes]",
	"[data-footnote-ref]",
	"[data-footnote-backref]",
	".anchor",
	".sr-only",
	"a[href^='#fn']",
	"a[href^='#user-content-fn']",
	"[data-no-listen]",
	"[aria-hidden='true']",
	"#toc",
	"#comments",
	".license-container",
	".listen-player",
].join(",");

/** Code blocks: announced with their line count, never read. */
const CODE = "pre, .expressive-code";

const BLOCK =
	"p, h1, h2, h3, h4, h5, h6, li, figcaption, blockquote, dd, dt, .katex-display";
const ABBREVIATION_END =
	/(\b(?:Dr|Mr|Mrs|Ms|Prof|Jr|Sr|St|Fig|Figs|Eq|Eqs|No|vol|pp|vs|al|cf|approx|e\.g|i\.e|etc|U\.S|U\.K|a\.m|p\.m|Inc|Ltd)\.)\s*$/i;

type Piece = { text: string; node: Text } | { text: string; el: Element };

function gather(parent: Node, out: Piece[]): void {
	for (const child of Array.from(parent.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent ?? "";
			if (text) out.push({ text, node: child as Text });
			continue;
		}
		if (!(child instanceof Element) || child.matches(SKIP)) continue;
		// Hidden pronunciation (:say[term]{as="..."}): the spoken form replaces the text; the highlight still covers the term.
		const say = child.getAttribute("data-say")?.trim();
		if (say) {
			out.push({ text: say, el: child });
			continue;
		}
		// Nested blocks, tables and code are read as their own sentences.
		if (child.matches(`${BLOCK}, table, ${CODE}`)) continue;
		if (child.matches(".katex")) {
			out.push({ text: ` ${mathSpeech(child)} `, el: child });
			continue;
		}
		if (child.tagName === "IMG") {
			const spoken = child.closest("figure")?.querySelector("figcaption")
				? null
				: imageSpeech(child.getAttribute("alt"));
			if (spoken) out.push({ text: ` ${spoken} `, el: child });
			continue;
		}
		if (child.tagName === "CODE") {
			const spoken = inlineCodeSpeech(child.textContent ?? "");
			if (spoken) out.push({ text: spoken, el: child });
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

/** Simple TeX is read as a phrase; anything structured is "equation". */
function mathSpeech(katex: Element): string {
	const label = katex.getAttribute("aria-label");
	if (label) return label;
	const tex =
		katex.querySelector("annotation[encoding='application/x-tex']")
			?.textContent ?? "";
	return texToSpeech(tex) ?? "equation";
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

function rangeOver(el: Element): Range {
	const range = document.createRange();
	range.selectNode(el);
	return range;
}

function tableText(table: HTMLTableElement): string {
	const headRow =
		table.tHead?.rows[0] ??
		(table.rows[0]?.querySelector("th") ? table.rows[0] : null);
	const headers = headRow
		? Array.from(headRow.cells, (c) => c.textContent ?? "")
		: [];
	const bodyRows = Array.from(table.rows).filter((r) => r !== headRow).length;
	const columns = Math.max(0, ...Array.from(table.rows, (r) => r.cells.length));
	return tableSpeech(
		bodyRows,
		headers,
		columns,
		table.caption?.textContent ?? "",
	);
}

function codeText(block: Element): string {
	const pre = block.matches("pre") ? block : block.querySelector("pre");
	const lines =
		block.querySelectorAll(".ec-line").length ||
		(pre?.textContent ?? "").replace(/\n+$/, "").split("\n").length;
	const title = block.querySelector(".title")?.textContent ?? "";
	return codeBlockSpeech(lines, title);
}

/** Text added before a block's first sentence: list numbers, caption and quote cues. */
function blockPrefix(block: HTMLElement): string {
	if (block.tagName === "LI" && block.parentElement?.tagName === "OL") {
		const list = block.parentElement as HTMLOListElement;
		const items = Array.from(list.children).filter((c) => c.tagName === "LI");
		return listItemPrefix((list.start || 1) + items.indexOf(block));
	}
	if (block.tagName === "FIGCAPTION")
		return captionPrefix(block.textContent ?? "");
	const quote = block.closest("blockquote");
	if (quote && !quote.matches(".admonition") && quote !== block) {
		const first = quote.querySelector(BLOCK);
		if (first === block) return QUOTE_PREFIX;
	}
	return "";
}

/** Builds the sentence list for one article root, in document order. `pronounce`: see pronounce.ts. */
export function extractSentences(
	root: HTMLElement,
	pronounce: Pronunciations = {},
): Sentence[] {
	const speakable = (text: string): string =>
		normalizeForSpeech(applyPronunciations(text, pronounce));
	const lang =
		root.closest("[lang]")?.getAttribute("lang") ??
		document.documentElement.lang;
	const drafts: Array<{
		block: HTMLElement;
		range: Range | null;
		text: string;
		kind: SentenceKind;
	}> = [];

	for (const block of Array.from(
		root.querySelectorAll<HTMLElement>(`${BLOCK}, table, ${CODE}`),
	)) {
		const parent = block.parentElement;
		if (parent?.closest(SKIP) || parent?.closest(CODE)) continue;
		if (block.matches(SKIP)) continue;
		if (block instanceof HTMLTableElement) {
			drafts.push({
				block,
				range: rangeOver(block),
				text: tableText(block),
				kind: "table",
			});
			continue;
		}
		if (block.matches(CODE)) {
			drafts.push({
				block,
				range: rangeOver(block),
				text: codeText(block),
				kind: "code",
			});
			continue;
		}
		if (block.closest("table")) continue;
		const pieces: Piece[] = [];
		gather(block, pieces);
		const blockText = pieces.map((p) => p.text).join("");
		if (!blockText.trim()) continue;

		if (block.matches(".admonition")) {
			const label = admonitionSpeech(blockText);
			if (label)
				drafts.push({
					block,
					range: rangeFor(pieces, 0, blockText.length),
					text: label,
					kind: "text",
				});
			continue;
		}

		const prefix = blockPrefix(block);
		const kind: SentenceKind = block.matches(".katex-display")
			? "math"
			: pieces.length === 1 &&
					"el" in pieces[0] &&
					pieces[0].el.tagName === "IMG"
				? "image"
				: "text";
		const spans = splitSentences(blockText, lang);
		spans.forEach(([start, end], i) => {
			let raw = blockText.slice(start, end);
			if (i === 0 && prefix) raw = `${prefix}${raw.trimStart()}`;
			// Every block's last sentence lands on a full stop, so headings and items end with falling intonation.
			if (i === spans.length - 1) raw = withTerminalPunctuation(raw);
			const normalised = speakable(raw);
			// A spoken prefix ("One.") or a display equation starts the sentence with a capital.
			const speech =
				(i === 0 && prefix) || kind === "math"
					? `${normalised.charAt(0).toUpperCase()}${normalised.slice(1)}`
					: normalised;
			if (!/[\p{L}\p{N}]/u.test(speech)) return;
			drafts.push({
				block,
				range: rangeFor(pieces, start, end),
				text: speech,
				kind,
			});
		});
	}

	return drafts.map((draft, i) => {
		const id = `s${i}`;
		const next = drafts[i + 1];
		const final = pauseClass(
			draft.block.tagName,
			!next || next.block !== draft.block,
		);
		const text =
			draft.kind === "text" || draft.kind === "image" || draft.kind === "math"
				? draft.text
				: speakable(draft.text);
		const pieces = i === 0 ? splitFirstSentence(text) : splitSentence(text);
		const units = withPauses(pieces, final).map((u) => ({
			sentenceId: id,
			...u,
		}));
		return {
			id,
			block: draft.block,
			range: draft.range,
			units,
			kind: draft.kind,
		};
	});
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
