/**
 * Speech chunking: how a sentence is cut into units for the engine, and which pause follows each unit.
 *
 * Rules: never split mid-sentence unless the sentence is long (over LONG_SENTENCE_WORDS); long sentences split at
 * clause punctuation, then at conjunctions, then (only past the hard cap) at word boundaries. The first unit of the
 * article is kept short so audio starts fast. Every unit carries the pause class that follows it, named after the
 * audio side's pause table (pauses.ts: sentence, paragraph, heading, listItem) plus "clause" inside a sentence.
 *
 * prosodyGroups() offers the audio side larger synthesis units: consecutive sentences of one block, 150-300
 * characters, so the model hears a sentence's neighbours. Highlighting stays per sentence through the offsets.
 * Pure and DOM-free; test:tts covers it.
 */

/** Pause after a unit. Matches the keys of PAUSE_S in pauses.ts, plus "clause" for a split inside a sentence. */
export type PauseClass =
	| "clause"
	| "sentence"
	| "paragraph"
	| "heading"
	| "listItem";

export const CHUNK = {
	/** First unit of a reading: one short sentence or clause, for a fast start. */
	firstMaxChars: 100,
	/** Sentence groups aim for this window. */
	targetMinChars: 150,
	targetMaxChars: 300,
	/** Kokoro takes at most 510 phoneme tokens per pass; stay well under. */
	hardCapTokens: 400,
	/** Rough phoneme tokens per character of English text (misaki IPA plus spaces and punctuation). */
	tokensPerChar: 1,
	/** Sentences longer than this are split at clauses. */
	longSentenceWords: 25,
	/** Clause pieces shorter than this are merged with a neighbour ("However," never stands alone). */
	minClauseWords: 4,
} as const;

/** Estimated phoneme tokens for a piece of text. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length * CHUNK.tokensPerChar);
}

const HEADING = /^H[1-6]$/;

/** The pause after a sentence, from its block. Mirrors pauseAfter() in pauses.ts; test:tts pins the mapping. */
export function pauseClass(
	tag: string,
	endsBlock: boolean,
): Exclude<PauseClass, "clause"> {
	const upper = tag.toUpperCase();
	if (HEADING.test(upper)) return "heading";
	if (endsBlock && upper === "LI") return "listItem";
	if (endsBlock) return "paragraph";
	return "sentence";
}

const wordCount = (text: string): number =>
	text.split(/\s+/).filter(Boolean).length;
const hardCapChars = (): number =>
	Math.floor(CHUNK.hardCapTokens / CHUNK.tokensPerChar);
const CONJUNCTION =
	/\s(?=(?:and|but|or|so|because|which|while|whereas|although|though|unless|until|when|where|that)\s)/g;

/** Splits one over-long clause at the conjunction nearest its middle, else at the word boundary nearest it. */
function halve(text: string, allowWordCut: boolean): [string, string] | null {
	const middle = text.length / 2;
	let best = -1;
	for (const m of text.matchAll(CONJUNCTION)) {
		const at = m.index ?? -1;
		const left = text.slice(0, at);
		const right = text.slice(at + 1);
		if (
			wordCount(left) < CHUNK.minClauseWords ||
			wordCount(right) < CHUNK.minClauseWords
		)
			continue;
		if (best < 0 || Math.abs(at - middle) < Math.abs(best - middle)) best = at;
	}
	if (best < 0 && allowWordCut) {
		const before = text.lastIndexOf(" ", middle);
		best = before > 0 ? before : text.indexOf(" ", middle);
	}
	if (best <= 0) return null;
	return [text.slice(0, best).trim(), text.slice(best + 1).trim()];
}

/** Cuts a piece that is still too long: conjunctions first, word boundaries only past the hard cap. */
function refine(piece: string, out: string[]): void {
	const tooManyWords = wordCount(piece) > CHUNK.longSentenceWords * 1.6;
	const overCap = estimateTokens(piece) > CHUNK.hardCapTokens;
	if (!tooManyWords && !overCap) {
		out.push(piece);
		return;
	}
	const halves = halve(piece, overCap);
	if (!halves) {
		out.push(piece);
		return;
	}
	refine(halves[0], out);
	refine(halves[1], out);
}

/**
 * Splits one normalised sentence into speech pieces. Short sentences stay whole. `maxChars` bounds each piece
 * (the first unit of a reading uses CHUNK.firstMaxChars). Joining the pieces with spaces gives the input back.
 */
export function splitSentence(
	text: string,
	maxChars: number = CHUNK.targetMaxChars,
): string[] {
	const sentence = text.replace(/\s+/g, " ").trim();
	if (!sentence) return [];
	const short =
		wordCount(sentence) <= CHUNK.longSentenceWords &&
		sentence.length <= maxChars;
	if (short && estimateTokens(sentence) <= CHUNK.hardCapTokens)
		return [sentence];

	const clauses = sentence.split(/(?<=[,;:])\s+/);
	const merged: string[] = [];
	let current = "";
	for (const clause of clauses) {
		if (!current) {
			current = clause;
			continue;
		}
		const candidate = `${current} ${clause}`;
		const tiny =
			wordCount(current) < CHUNK.minClauseWords ||
			wordCount(clause) < CHUNK.minClauseWords;
		const fits =
			wordCount(candidate) <= CHUNK.longSentenceWords &&
			candidate.length <= maxChars;
		if ((fits || tiny) && estimateTokens(candidate) <= CHUNK.hardCapTokens) {
			current = candidate;
			continue;
		}
		merged.push(current);
		current = clause;
	}
	const last = merged[merged.length - 1];
	if (
		last &&
		wordCount(current) < CHUNK.minClauseWords &&
		estimateTokens(`${last} ${current}`) <= CHUNK.hardCapTokens
	)
		merged[merged.length - 1] = `${last} ${current}`;
	else if (current) merged.push(current);

	const pieces: string[] = [];
	for (const piece of merged) refine(piece, pieces);
	// Over the hard cap even after conjunctions: cut at words so no unit exceeds the model's window.
	const capped: string[] = [];
	for (const piece of pieces) {
		let rest = piece;
		while (estimateTokens(rest) > CHUNK.hardCapTokens) {
			const cut = rest.lastIndexOf(" ", hardCapChars());
			const at = cut > 0 ? cut : hardCapChars();
			capped.push(rest.slice(0, at).trim());
			rest = rest.slice(at).trim();
		}
		if (rest) capped.push(rest);
	}
	return capped;
}

/** The first unit of a reading: the first clause or two, at most CHUNK.firstMaxChars when a boundary allows it. */
export function splitFirstSentence(text: string): string[] {
	const sentence = text.replace(/\s+/g, " ").trim();
	if (sentence.length <= CHUNK.firstMaxChars) return splitSentence(sentence);
	const clauses = sentence.split(/(?<=[,;:])\s+/);
	let head = "";
	let used = 0;
	for (const clause of clauses) {
		const candidate = head ? `${head} ${clause}` : clause;
		if (head && candidate.length > CHUNK.firstMaxChars) break;
		head = candidate;
		used++;
	}
	if (head.length > CHUNK.firstMaxChars) {
		const halves = halve(head, false);
		if (halves && halves[0].length <= CHUNK.firstMaxChars * 1.5) {
			const rest = [halves[1], ...clauses.slice(used)].join(" ");
			return [halves[0], ...splitSentence(rest)];
		}
	}
	if (used >= clauses.length) return splitSentence(sentence);
	return [head, ...splitSentence(clauses.slice(used).join(" "))];
}

/** One planned unit: text for the engine and the pause that follows it. */
export interface PlannedUnit {
	text: string;
	pause: PauseClass;
}

/** Gives every piece of a sentence a pause: "clause" inside, the sentence's own class at the end. */
export function withPauses(
	pieces: readonly string[],
	final: Exclude<PauseClass, "clause">,
): PlannedUnit[] {
	return pieces.map((text, i) => ({
		text,
		pause: i === pieces.length - 1 ? final : "clause",
	}));
}

/** Where one sentence unit sits inside a group's text. */
export interface GroupPart {
	sentenceIndex: number;
	unitIndex: number;
	/** Character offsets in the group's text. */
	start: number;
	end: number;
}

/** A synthesis unit made of whole units from one block. */
export interface ProsodyGroup {
	text: string;
	pause: PauseClass;
	parts: GroupPart[];
}

interface GroupableSentence {
	block: unknown;
	units: ReadonlyArray<{ text: string; pause: PauseClass }>;
}

/**
 * Groups consecutive units of one block into 150-300 character synthesis units, never past the hard cap and never
 * across a block. The first group of a reading (from `from`) is a single unit for a fast start. A group closes at
 * a sentence end once it has reached CHUNK.targetMinChars.
 */
export function prosodyGroups(
	sentences: readonly GroupableSentence[],
	from = 0,
): ProsodyGroup[] {
	const groups: ProsodyGroup[] = [];
	let current: ProsodyGroup | null = null;
	let currentBlock: unknown = null;
	const close = (): void => {
		if (current) groups.push(current);
		current = null;
	};
	for (let s = from; s < sentences.length; s++) {
		const sentence = sentences[s];
		sentence.units.forEach((unit, u) => {
			if (current) {
				const joined = current.text.length + 1 + unit.text.length;
				const sameBlock = currentBlock === sentence.block;
				const full =
					current.text.length >= CHUNK.targetMinChars &&
					current.pause !== "clause";
				if (
					!sameBlock ||
					full ||
					joined > CHUNK.targetMaxChars ||
					joined * CHUNK.tokensPerChar > CHUNK.hardCapTokens
				)
					close();
			}
			if (!current) {
				current = {
					text: unit.text,
					pause: unit.pause,
					parts: [
						{ sentenceIndex: s, unitIndex: u, start: 0, end: unit.text.length },
					],
				};
				currentBlock = sentence.block;
			} else {
				const start: number = current.text.length + 1;
				current.text = `${current.text} ${unit.text}`;
				current.pause = unit.pause;
				current.parts.push({
					sentenceIndex: s,
					unitIndex: u,
					start,
					end: start + unit.text.length,
				});
			}
			// The first group of a reading is one unit; block-ending units always close their group.
			if (
				groups.length === 0 ||
				unit.pause === "paragraph" ||
				unit.pause === "heading" ||
				unit.pause === "listItem"
			)
				close();
		});
	}
	close();
	return groups;
}
