// A self-contained BPE tokenizer for the two models in the pipeline.
//
// This is the JS port of the Rust `bpe` module in `crates/voice-chat` — the byte-for-byte-verified
// reference (tested against the models' own `tokenizer.json` with the reference `tokenizers` lib).
// It lives in JS, not the wasm, because the tokenizer is a non-hot-path text op (one encode per
// turn, a few decodes per token) and keeping it out of the wasm keeps the browser build small.
//
// Two schemes, one core:
//   * LFM2.5-1.2B  — GPT-2/Qwen byte-level BPE. The Qwen split regex breaks the text into pieces,
//     every UTF-8 byte of each piece becomes a GPT-2 byte-level code point, and BPE merges those.
//   * Moonshine    — Whisper-style BPE. A `▁`-normalizer prepends `▁` and turns spaces into `▁`;
//     there is no split, so the whole string is one piece; BPE runs over the Unicode characters,
//     with one `<0xXX>` token per UTF-8 byte for a character not in the vocab.

// The GPT-2 `bytes_to_unicode` "printable" set: 33..=126, 161..=172, 174..=255.
const printable = (b) => (b >= 33 && b <= 126) || (b >= 161 && b <= 172) || (b >= 174 && b <= 255);

/** GPT-2 `bytes_to_unicode`: a byte → the code point its byte-level char sits at. */
function byteToCp(b) {
	if (printable(b)) return b;
	let n = 0;
	for (let x = 0; x < 256; x++) {
		if (printable(x)) continue;
		if (x === b) return 256 + n;
		n++;
	}
	throw new Error('every byte has a code point');
}

/** The inverse of {@link byteToCp}. */
function cpToByte(cp) {
	if (printable(cp)) return cp;
	let n = 0;
	for (let x = 0; x < 256; x++) {
		if (printable(x)) continue;
		if (256 + n === cp) return x;
		n++;
	}
	throw new Error('every code point has a byte');
}

// The Qwen-family pre-tokenizer regex, verbatim from the model's `tokenizer.json`
// (`pre_tokenizer.pattern.Regex`). Leftmost-first, so the contraction branch wins over the
// letter-run branch. The `u` flag makes `\p{L}`/`\p{N}` mean Unicode properties.
const QWEN_SPLIT =
	/(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

/**
 * A compiled BPE tokenizer.
 *
 * @param {object} opts
 * @param {Map<string, number>} opts.vocab  piece → id.
 * @param {string[]} opts.merges            the merges list, each a `"a b"` pair.
 * @param {boolean} opts.byteLevel          true for the GPT-2/Qwen byte-level scheme (LFM2.5).
 * @param {boolean} opts.byteFallback       true for the Whisper-style scheme (Moonshine).
 * @param {string} [opts.prepend]           the normalizer char (`▁` for Moonshine).
 */
export function Bpe({ vocab, merges, byteLevel, byteFallback, prepend }) {
	const byId = new Array(vocab.size);
	for (const [piece, id] of vocab) byId[id] = piece;
	const rank = new Map(merges.map((m, i) => [m, i]));
	const split = byteLevel ? QWEN_SPLIT : null;
	const pre = prepend || null;

	/** Turn a piece into the symbols BPE starts from. */
	function toSymbols(piece) {
		if (split) {
			return [...enc.encode(piece)].map((b) => String.fromCodePoint(byteToCp(b)));
		}
		const out = [];
		for (const c of piece) {
			if (vocab.has(c)) out.push(c);
			else if (byteFallback) for (const b of enc.encode(c)) out.push(`<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`);
			else out.push(c);
		}
		return out;
	}

	/** The BPE merge loop: repeatedly apply the lowest-ranked pair, merging every occurrence. */
	function bpe(symbols) {
		while (symbols.length > 1) {
			let bestRank = Infinity;
			let bestAt = -1;
			for (let i = 0; i < symbols.length - 1; i++) {
				const r = rank.get(`${symbols[i]} ${symbols[i + 1]}`);
				if (r !== undefined && r < bestRank) {
					bestRank = r;
					bestAt = i;
				}
			}
			if (bestAt < 0) break;
			const left = symbols[bestAt];
			const right = symbols[bestAt + 1];
			const merged = left + right; // the rank key is "a b"; the merged symbol is "ab".
			const out = [];
			let i = 0;
			while (i < symbols.length) {
				if (i < symbols.length - 1 && symbols[i] === left && symbols[i + 1] === right) {
					out.push(merged);
					i += 2;
				} else {
					out.push(symbols[i]);
					i += 1;
				}
			}
			symbols = out;
		}
		return symbols;
	}

	/** Encode text to token ids. */
	function encode(text) {
		let s = String(text);
		if (pre) {
			s = pre + s;
			s = s.replace(/ /g, pre);
		}
		const pieces = split ? [...s.matchAll(split)].map((m) => m[0]) : [s];
		const out = [];
		for (const piece of pieces) for (const sym of bpe(toSymbols(piece))) {
			const id = vocab.get(sym);
			if (id !== undefined) out.push(id);
		}
		return out;
	}

	/** Decode token ids to text. */
	function decode(ids) {
		const joined = ids.map((id) => byId[id] ?? '').join('');
		let bytes;
		if (split) {
			// Byte-level: every char is a GPT-2 byte-level code point.
			bytes = [...joined].map((c) => cpToByte(c.codePointAt(0)));
		} else {
			// Whisper-style: a mix of Unicode chars, `▁` (space) and `<0xXX>` byte tokens.
			bytes = [];
			const chars = [...joined];
			for (let i = 0; i < chars.length; i++) {
				const c = chars[i];
				if (c === '<' && chars[i + 1] === '0') {
					// A `<0xXX>` token: 7 chars total.
					const hex = chars.slice(i + 2, i + 6).join('');
					bytes.push(parseInt(hex, 16));
					i += 6;
				} else if (c === '▁') {
					bytes.push(0x20);
				} else {
					bytes.push(...enc.encode(c));
				}
			}
		}
		let text = dec.decode(new Uint8Array(bytes));
		if (!split && text.startsWith(' ')) text = text.slice(1); // the prepended `▁` became one space.
		return text;
	}

	return { encode, decode, vocabSize: vocab.size };
}

/**
 * Build a BPE from a parsed `tokenizer.json`.
 *
 * @param {object} json  the parsed `tokenizer.json`.
 * @param {object} opts  `{ byteLevel, byteFallback, prepend }`.
 */
export function fromTokenizerJson(json, { byteLevel, byteFallback, prepend }) {
	const vocab = new Map(Object.entries(json.model.vocab));
	const merges = (json.model.merges ?? []).map((m) => (Array.isArray(m) ? `${m[0]} ${m[1]}` : m));
	return Bpe({ vocab, merges, byteLevel, byteFallback, prepend });
}
