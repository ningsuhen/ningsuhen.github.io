// Qwen3 byte-level BPE tokenizer (no dependencies, runs in the browser and Node).
//
// Same algorithm as the Hugging Face `tokenizers` Qwen3 tokenizer.json:
//   normalizer      NFC
//   pre-tokenizer   split by the Qwen regex below, then GPT-2 byte-to-unicode
//   model           BPE over vocab.json + merges.txt (rank = line order)
//   special tokens  matched literally before BPE (only the few below)
// Verified against the reference by probes/tokenizer-check.mjs (fixture:
// web/tok/qwen3-fixture.json, produced by probes/tokenizer-gen-fixture.py).

// Qwen3 pre-tokenizer regex. The reference spells the contraction group with the
// inline modifier (?i:...); it is expanded by hand here so older engines parse it.
const SPLIT = new RegExp(
  "(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])" +
    "|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+",
  "gu",
);

// Special tokens the demos can use (ids from tokenizer.json added_tokens).
export const SPECIAL = {
  "<|endoftext|>": 151643,
  "<|im_start|>": 151644,
  "<|im_end|>": 151645,
};

// GPT-2 byte <-> printable-unicode map.
function byteMap() {
  const bs = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  }
  const m = new Array(256);
  bs.forEach((b, i) => (m[b] = String.fromCodePoint(cs[i])));
  return m;
}

export class Qwen3Tokenizer {
  /** @param {Record<string, number>} vocab vocab.json  @param {string} mergesText merges.txt */
  constructor(vocab, mergesText) {
    this.vocab = new Map(Object.entries(vocab));
    this.ranks = new Map();
    let rank = 0;
    for (const line of mergesText.split("\n")) {
      if (!line || line.startsWith("#version")) continue;
      this.ranks.set(line, rank++);
    }
    this.bytes = byteMap();
    this.enc = new TextEncoder();
    this.cache = new Map();
    this.specialRe = new RegExp("(" + Object.keys(SPECIAL).map((s) => s.replace(/[|]/g, "\\|")).join("|") + ")");
  }

  static async load(base = "tok/") {
    const [v, m] = await Promise.all([
      fetch(base + "vocab.json").then((r) => {
        if (!r.ok) throw new Error(`tokenizer: ${base}vocab.json ${r.status}`);
        return r.json();
      }),
      fetch(base + "merges.txt").then((r) => {
        if (!r.ok) throw new Error(`tokenizer: ${base}merges.txt ${r.status}`);
        return r.text();
      }),
    ]);
    return new Qwen3Tokenizer(v, m);
  }

  /** BPE-merge one pre-token (already byte-mapped to a string of symbols). */
  bpe(word) {
    const hit = this.cache.get(word);
    if (hit) return hit;
    let parts = Array.from(word);
    while (parts.length > 1) {
      let best = Infinity;
      let at = -1;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = this.ranks.get(parts[i] + " " + parts[i + 1]);
        if (r !== undefined && r < best) {
          best = r;
          at = i;
        }
      }
      if (at < 0) break;
      parts.splice(at, 2, parts[at] + parts[at + 1]);
    }
    const ids = parts.map((p) => {
      const id = this.vocab.get(p);
      if (id === undefined) throw new Error(`tokenizer: symbol ${JSON.stringify(p)} not in vocab`);
      return id;
    });
    this.cache.set(word, ids);
    return ids;
  }

  /** Text -> token ids. */
  encode(text) {
    const out = [];
    for (const seg of text.split(this.specialRe)) {
      if (seg in SPECIAL) {
        out.push(SPECIAL[seg]);
        continue;
      }
      const s = seg.normalize("NFC");
      for (const m of s.matchAll(SPLIT)) {
        let w = "";
        for (const b of this.enc.encode(m[0])) w += this.bytes[b];
        out.push(...this.bpe(w));
      }
    }
    return out;
  }
}
