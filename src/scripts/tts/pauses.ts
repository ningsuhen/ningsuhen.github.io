/**
 * Silence the neural voice inserts between sentences, driven by the text. Kokoro's own edge padding is trimmed,
 * so these pauses carry the punctuation timing. Values are seconds at speed 1 and scale with the speed setting.
 * Change them here; test:tts pins the table.
 */
export const PAUSE_S = {
	/** Full stop, question mark or exclamation mark ending a sentence. */
	sentence: 0.4,
	/** Last sentence of a paragraph, before the next paragraph. */
	paragraph: 0.7,
	/** After a heading. */
	heading: 0.8,
	/** After a list item. */
	listItem: 0.3,
} as const;

/** What the pause rule needs about a sentence. */
export interface PauseContext {
	/** Tag name of the sentence's block, e.g. "P", "H2", "LI". */
	tag: string;
	/** True when this is the last sentence of its block (paragraph, heading or list item). */
	endsBlock: boolean;
}

const HEADING = /^H[1-6]$/;

/** Seconds of silence after a sentence, at speed 1. */
export function pauseAfter(context: PauseContext): number {
	if (HEADING.test(context.tag)) return PAUSE_S.heading;
	if (context.endsBlock && context.tag === "LI") return PAUSE_S.listItem;
	if (context.endsBlock) return PAUSE_S.paragraph;
	return PAUSE_S.sentence;
}

/** Pause in seconds for a given playback rate. Faster speech keeps proportionally shorter pauses. */
export function scaledPause(seconds: number, rate: number): number {
	return seconds / Math.max(rate, 0.1);
}
