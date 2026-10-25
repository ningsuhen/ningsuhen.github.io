/**
 * What the Listen player says for things that are not plain prose: code, tables, images, captions, lists, quotes
 * and math. Pure functions with no DOM access, so test:tts covers them; extract.ts feeds them what it reads from
 * the page. Their output still goes through normalizeForSpeech (numbers, acronyms) afterwards.
 */

/** A code block is announced, never read: "Code block, deploy.sh, 20 lines." */
export function codeBlockSpeech(lines: number, title = ""): string {
	const name = title.trim();
	const count = Math.max(1, lines);
	return `Code block${name ? `, ${name}` : ""}, ${count} ${count === 1 ? "line" : "lines"}.`;
}

/** Columns are listed only when the header row is short enough to say. */
const TABLE_MAX_SPOKEN_COLUMNS = 6;
const TABLE_MAX_HEADER_WORDS = 4;

/** "Table with 14 rows. Columns: Operation, Latency and Notes." A summary instead of pipes and cells. */
export function tableSpeech(
	rows: number,
	headers: readonly string[],
	columns = headers.length,
	caption = "",
): string {
	const title = caption.trim().replace(/[.:]$/, "");
	const rowText = `${rows} ${rows === 1 ? "row" : "rows"}`;
	const head = `Table${title ? `, ${title},` : ""} with ${rowText}`;
	const names = headers.map((h) => h.trim()).filter(Boolean);
	const speakable =
		names.length > 0 &&
		names.length <= TABLE_MAX_SPOKEN_COLUMNS &&
		names.every((n) => n.split(/\s+/).length <= TABLE_MAX_HEADER_WORDS);
	if (speakable) return `${head}. Columns: ${listJoin(names)}.`;
	return columns > 0
		? `${head} and ${columns} ${columns === 1 ? "column" : "columns"}.`
		: `${head}.`;
}

/** "a, b and c". */
export function listJoin(items: readonly string[]): string {
	if (items.length <= 1) return items.join("");
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const GENERIC_ALT =
	/^(image|img|picture|pic|photo|photograph|screenshot|screen shot|figure|fig|cover|cover image|thumbnail|thumb|logo|icon|banner|diagram|chart|graph|illustration|placeholder|untitled|alt|null)\.?$/i;

/** Alt text is read only when it says something: not empty, not a file name, not "image" or "screenshot". */
export function isMeaningfulAlt(alt: string | null | undefined): boolean {
	const text = (alt ?? "").trim();
	if (text.length < 4) return false;
	if (GENERIC_ALT.test(text)) return false;
	if (/^[\w-]+\.(png|jpe?g|gif|webp|svg|avif)$/i.test(text)) return false;
	if (/^(img|image|dsc|screenshot)[\s_-]?\d+/i.test(text)) return false;
	return /\p{L}{2,}/u.test(text);
}

/** "Image: a cat on a keyboard." or null when the alt text says nothing. */
export function imageSpeech(alt: string | null | undefined): string | null {
	if (!isMeaningfulAlt(alt)) return null;
	return `Image: ${withTerminalPunctuation((alt ?? "").trim())}`;
}

/** Captions are announced once: "Figure: Latency by model." unless they already start with Figure or Table. */
export function captionPrefix(caption: string): string {
	return /^\s*(fig(ure)?|table|chart|image|listing)\b/i.test(caption)
		? ""
		: "Figure: ";
}

/** Headings, list items and captions often lack a full stop; the voice needs one to land the sentence. */
export function withTerminalPunctuation(text: string): string {
	const trimmed = text.trimEnd();
	if (!trimmed || /[.!?:;…]["'”’)\]]*$/.test(trimmed)) return trimmed;
	return `${trimmed.replace(/,$/, "")}.`;
}

/** Inline code longer than this is announced as "code" instead of being read. */
const INLINE_CODE_MAX_CHARS = 32;
const INLINE_CODE_MAX_WORDS = 3;

/** Splits an identifier into words: chunkForBudget -> "chunk For Budget", snake_case -> "snake case". */
export function identifierWords(id: string): string {
	return id
		.replace(/(?<=[a-z0-9])(?=[A-Z][a-z])/g, " ")
		.replace(/(?<=[a-z])(?=[A-Z])/g, " ")
		.replace(/[_]+/g, " ")
		.replace(/(?<=[A-Za-z])-(?=[A-Za-z])/g, " ")
		.trim();
}

/**
 * Inline code is read as words only when it is a word or a short identifier (`rsync`, `deploy.sh`,
 * `chunkForBudget`, `git push`). Anything else (flags, paths, expressions) is said as "code".
 */
export function inlineCodeSpeech(code: string): string {
	const text = code.trim().replace(/\(\)$/, "");
	if (!text) return "";
	// A path is read by its last part: `.git/hooks/pre-push` -> "pre push".
	if (/^[~.]?[\w.@-]*(\/[\w.@-]+)+\/?$/.test(text)) {
		const last = text.split("/").filter(Boolean).pop() ?? "";
		return identifierWords(last.replace(/^\./, "")) || "code";
	}
	// Flags are read by name: `--locked` -> "locked".
	const words = text
		.split(/\s+/)
		.map((w) => w.replace(/^--(?=[A-Za-z]{2})/, ""));
	const wordLike = (w: string): boolean =>
		/^[A-Za-z][\w.'-]*[A-Za-z0-9]$|^[A-Za-z]$|^\d+(\.\d+)?$/.test(w);
	if (
		text.length <= INLINE_CODE_MAX_CHARS &&
		words.length <= INLINE_CODE_MAX_WORDS &&
		words.every(wordLike)
	)
		return words.map(identifierWords).join(" ");
	return "code";
}

/** Ordered list items carry their number: "1. Install Hugo." (extract.ts capitalises the spoken "One."). */
export function listItemPrefix(index: number): string {
	return `${index}. `;
}

/** A plain blockquote starts with a cue; admonitions say their label ("Note.") instead. */
export const QUOTE_PREFIX = "Quote: ";

export function admonitionSpeech(label: string): string {
	const word = label.trim().toLowerCase();
	return word ? `${word[0].toUpperCase()}${word.slice(1)}.` : "";
}

/* ---------- math ---------- */

/** Longer or structured TeX (alignments, matrices, integrals) is announced as "equation". */
const TEX_MAX_CHARS = 60;
const TEX_MAX_WORDS = 16;
const TEX_COMPLEX =
	/\\begin|\\\\|&|\\int|\\iint|\\oint|\\matrix|\\binom|\\lim|\\prod|\\sum\s*[_^]|\\over\b|\\choose|\\array/;

const TEX_WORDS: Readonly<Record<string, string>> = {
	times: "times",
	cdot: "times",
	div: "divided by",
	pm: "plus or minus",
	mp: "minus or plus",
	le: "at most",
	leq: "at most",
	ge: "at least",
	geq: "at least",
	neq: "not equal to",
	ne: "not equal to",
	approx: "approximately",
	sim: "about",
	propto: "proportional to",
	infty: "infinity",
	to: "to",
	rightarrow: "to",
	Rightarrow: "implies",
	implies: "implies",
	in: "in",
	notin: "not in",
	subset: "subset of",
	log: "log",
	ln: "natural log",
	exp: "exp",
	sin: "sine",
	cos: "cosine",
	tan: "tangent",
	max: "max",
	min: "min",
	arg: "arg",
	sum: "the sum of",
	ldots: "and so on",
	cdots: "and so on",
	dots: "and so on",
	partial: "partial",
	nabla: "del",
	forall: "for all",
	exists: "there exists",
	lt: "less than",
	gt: "greater than",
	mid: "given",
	quad: "",
	qquad: "",
	left: "",
	right: "",
	big: "",
	Big: "",
	bigl: "",
	bigr: "",
	displaystyle: "",
	limits: "",
	vert: "",
	lvert: "",
	rvert: "",
	"%": "percent",
	$: "dollars",
	",": "",
	";": "",
	"!": "",
	" ": "",
};
const TEX_GREEK = new Set([
	"alpha",
	"beta",
	"gamma",
	"delta",
	"epsilon",
	"varepsilon",
	"zeta",
	"eta",
	"theta",
	"vartheta",
	"iota",
	"kappa",
	"lambda",
	"mu",
	"nu",
	"xi",
	"pi",
	"rho",
	"sigma",
	"tau",
	"upsilon",
	"phi",
	"varphi",
	"chi",
	"psi",
	"omega",
	"Gamma",
	"Delta",
	"Theta",
	"Lambda",
	"Xi",
	"Pi",
	"Sigma",
	"Phi",
	"Psi",
	"Omega",
]);

/**
 * Reads simple TeX as a phrase: "O(n \log n)" -> "O of n log n", "x^2 + y_1" -> "x squared plus y sub 1".
 * Returns null for anything complex; the caller then says "equation". Digits are left for normalizeForSpeech.
 */
export function texToSpeech(tex: string): string | null {
	const source = tex.trim();
	if (!source || source.length > TEX_MAX_CHARS || TEX_COMPLEX.test(source))
		return null;
	let t = source.replace(
		/\\(?:text|mathrm|mathbf|mathit|mathcal|mathbb|mathsf|operatorname|textbf|textit|boldsymbol)\s*\{([^{}]*)\}/g,
		" $1 ",
	);
	for (let i = 0; i < 3; i++)
		t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, " $1 over $2 ");
	t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, " square root of $1 ");
	t = t.replace(
		/\^\s*\{([^{}]*)\}|\^\s*(\\?\w)/g,
		(_m, braced: string | undefined, single: string | undefined) => {
			const e = (braced ?? single ?? "").trim();
			if (e === "2") return " squared ";
			if (e === "3") return " cubed ";
			if (e === "\\prime" || e === "'") return " prime ";
			return ` to the power of ${e} `;
		},
	);
	t = t.replace(
		/_\s*\{([^{}]*)\}|_\s*(\\?\w)/g,
		(_m, braced: string | undefined, single: string | undefined) =>
			` sub ${(braced ?? single ?? "").trim()} `,
	);
	let unknown = false;
	t = t.replace(/\\([A-Za-z]+|[,;!%$ ])/g, (_m, name: string) => {
		if (name in TEX_WORDS) return ` ${TEX_WORDS[name]} `;
		if (TEX_GREEK.has(name))
			return ` ${name.replace(/^var/, "").toLowerCase()} `;
		unknown = true;
		return " ";
	});
	if (unknown) return null;
	t = t
		.replace(/\b([A-Za-z])\s*\(/g, "$1 of (")
		.replace(/!/g, " factorial ")
		.replace(/'/g, " prime ")
		.replace(/\s*=\s*/g, " equals ")
		.replace(/\s*\+\s*/g, " plus ")
		.replace(/(?<=\S)\s*-\s*/g, " minus ")
		.replace(/^\s*-\s*/, "minus ")
		.replace(/\s*<\s*/g, " less than ")
		.replace(/\s*>\s*/g, " greater than ")
		.replace(/\s*\/\s*/g, " over ")
		.replace(/[{}()[\]|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!t || t.split(" ").length > TEX_MAX_WORDS) return null;
	return t;
}
