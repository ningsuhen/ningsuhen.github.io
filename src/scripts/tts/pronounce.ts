/**
 * Hidden pronunciation fixes, applied to each sentence before the normaliser, for every engine.
 *
 * Sources, last wins: the global lexicon (src/data/pronunciations.json), the post's `pronounce:` front matter,
 * and inline `:say[term]{as="..."}` spans (read straight from `data-say` in extract.ts). Terms match whole words,
 * case-sensitively, so "US" never touches the pronoun "us". Dependency-free so test:tts can import it.
 */

/** Written term -> spoken respelling. */
export type Pronunciations = Readonly<Record<string, string>>;

export interface LexiconEntry {
	term: string;
	say: string;
}

export function lexiconMap(entries: readonly LexiconEntry[]): Pronunciations {
	return Object.fromEntries(entries.map((e) => [e.term, e.say]));
}

/** Later maps override earlier ones for the same term. Empty spoken forms are dropped. */
export function mergePronunciations(
	...maps: ReadonlyArray<Pronunciations | null | undefined>
): Pronunciations {
	const out: Record<string, string> = {};
	for (const map of maps)
		for (const [term, say] of Object.entries(map ?? {}))
			if (term && typeof say === "string" && say.trim()) out[term] = say.trim();
	return out;
}

const compiled = new WeakMap<Pronunciations, RegExp | null>();

function patternFor(map: Pronunciations): RegExp | null {
	if (compiled.has(map)) return compiled.get(map) ?? null;
	const terms = Object.keys(map).sort((a, b) => b.length - a.length);
	const re = terms.length
		? new RegExp(
				`(?<![\\p{L}\\p{N}_])(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}_])`,
				"gu",
			)
		: null;
	compiled.set(map, re);
	return re;
}

/** Replaces each whole-word term with its spoken form. Pure. */
export function applyPronunciations(text: string, map: Pronunciations): string {
	const re = patternFor(map);
	return re ? text.replace(re, (term) => map[term] ?? term) : text;
}
