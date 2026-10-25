/**
 * Text normaliser for speech: turns scientific notation into words before the engine sees it.
 *
 * Phase-1 JavaScript version. The Rust/WASM normaliser will replace `normalizeForSpeech` with the
 * same signature. Keep this file dependency-free so the node:test suite can import it directly.
 *
 * Order matters: citations, abbreviations and Greek first; then quantities with units (ranges,
 * percent, money); then bare numbers; then acronyms. Digits never survive into the output.
 */

const ONES = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen",
	"seventeen",
	"eighteen",
	"nineteen",
];
const TENS = [
	"",
	"",
	"twenty",
	"thirty",
	"forty",
	"fifty",
	"sixty",
	"seventy",
	"eighty",
	"ninety",
];
const SCALES: ReadonlyArray<readonly [number, string]> = [
	[1e12, "trillion"],
	[1e9, "billion"],
	[1e6, "million"],
	[1e3, "thousand"],
];

function twoDigits(n: number): string {
	if (n < 20) return ONES[n];
	return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}

function underThousand(n: number): string {
	const hundreds = Math.floor(n / 100);
	const rest = n % 100;
	const parts: string[] = [];
	if (hundreds) parts.push(`${ONES[hundreds]} hundred`);
	if (rest) parts.push(twoDigits(rest));
	return parts.join(" ");
}

/** 0 -> "zero", 1113 -> "one thousand one hundred thirteen". Integers up to 999 trillion. */
export function cardinal(n: number): string {
	if (n === 0) return "zero";
	const parts: string[] = [];
	let rest = Math.floor(n);
	for (const [value, name] of SCALES) {
		const chunk = Math.floor(rest / value);
		if (chunk) parts.push(`${underThousand(chunk)} ${name}`);
		rest %= value;
	}
	if (rest) parts.push(underThousand(rest));
	return parts.join(" ");
}

/** Year reading for 1900-2099: 1971 -> "nineteen seventy-one", 2008 -> "two thousand eight", 2024 -> "twenty twenty-four". */
function yearWords(n: number): string {
	if (n >= 2000 && n < 2010)
		return n === 2000 ? "two thousand" : `two thousand ${ONES[n - 2000]}`;
	const high = Math.floor(n / 100);
	const low = n % 100;
	const head = high === 19 ? "nineteen" : "twenty";
	if (low === 0) return `${head} hundred`;
	return `${head} ${low < 10 ? `oh ${ONES[low]}` : twoDigits(low)}`;
}

const DIGIT_WORDS = (digits: string): string =>
	[...digits].map((d) => ONES[Number(d)]).join(" ");

/** Parses "1,113.6" into speech: "one thousand one hundred thirteen point six". */
function numberWords(raw: string, year = false): string {
	const clean = raw.replace(/,/g, "");
	const [intPart, fracPart] = clean.split(".");
	const whole = Number(intPart);
	const isYear =
		year && !fracPart && !raw.includes(",") && whole >= 1900 && whole <= 2099;
	const head = isYear ? yearWords(whole) : cardinal(whole);
	return fracPart ? `${head} point ${DIGIT_WORDS(fracPart)}` : head;
}

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

const UNITS: Readonly<Record<string, readonly [string, string]>> = {
	"%": ["percent", "percent"],
	ms: ["millisecond", "milliseconds"],
	µs: ["microsecond", "microseconds"],
	us: ["microsecond", "microseconds"],
	ns: ["nanosecond", "nanoseconds"],
	s: ["second", "seconds"],
	KB: ["kilobyte", "kilobytes"],
	MB: ["megabyte", "megabytes"],
	GB: ["gigabyte", "gigabytes"],
	TB: ["terabyte", "terabytes"],
	GiB: ["gibibyte", "gibibytes"],
	MiB: ["mebibyte", "mebibytes"],
	TFLOPS: ["teraflop", "teraflops"],
	GFLOPS: ["gigaflop", "gigaflops"],
	Hz: ["hertz", "hertz"],
	kHz: ["kilohertz", "kilohertz"],
	MHz: ["megahertz", "megahertz"],
	GHz: ["gigahertz", "gigahertz"],
	kW: ["kilowatt", "kilowatts"],
	W: ["watt", "watts"],
	bp: ["basis point", "basis points"],
	"mol/L": ["mole per liter", "moles per liter"],
	"°C": ["degree Celsius", "degrees Celsius"],
	km: ["kilometer", "kilometers"],
	kg: ["kilogram", "kilograms"],
};
const UNIT_ALTERNATION = Object.keys(UNITS)
	.sort((a, b) => b.length - a.length)
	.map((u) => u.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
	.join("|");

/** A number, an optional range "a-b" / "a–b", then a unit. Lookbehind keeps "p95" and "COVID-19" out. */
const QUANTITY = new RegExp(
	String.raw`(?<![\w.])(${NUM})(?:\s*[–-]\s*(${NUM}))?\s?(${UNIT_ALTERNATION})(?![A-Za-z])`,
	"g",
);
const YEAR_RANGE =
	/(?<![\w.])((?:19|20)\d{2})\s*[–-]\s*((?:19|20)\d{2})(?!\d)/g;
const MONEY =
	/\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(bn|tn|[KMBT])?(?![A-Za-z])/g;
const MONEY_SCALE: Readonly<Record<string, string>> = {
	K: "thousand",
	M: "million",
	B: "billion",
	bn: "billion",
	T: "trillion",
	tn: "trillion",
};
const BARE_NUMBER =
	/(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\w])/g;

/** Greek letters and math symbols a TTS engine cannot pronounce. */
const GREEK: Readonly<Record<string, string>> = {
	α: "alpha",
	β: "beta",
	γ: "gamma",
	δ: "delta",
	ε: "epsilon",
	ζ: "zeta",
	η: "eta",
	θ: "theta",
	ι: "iota",
	κ: "kappa",
	λ: "lambda",
	μ: "mu",
	ν: "nu",
	ξ: "xi",
	π: "pi",
	ρ: "rho",
	σ: "sigma",
	τ: "tau",
	φ: "phi",
	χ: "chi",
	ψ: "psi",
	ω: "omega",
	Δ: "delta",
	Σ: "sigma",
	Ω: "omega",
	Π: "pi",
	Λ: "lambda",
	Θ: "theta",
};

const SYMBOLS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\s*~\s*(?=\d)/g, " about "],
	[/\s*~\s*(?=[A-Za-z])/g, " distributed as "],
	[/²/g, " squared"],
	[/³/g, " cubed"],
	[/(?<=[A-Za-z])\s*\/\s*(?=[A-Za-z])/g, "/"],
	[/≈\s*/g, " about "],
	[/≥\s*/g, " at least "],
	[/≤\s*/g, " at most "],
	[/×/g, " times "],
	[/±/g, " plus or minus "],
	[/−|(?<=\s)-(?=\d)/g, " minus "],
	[/→/g, " to "],
	[/&/g, " and "],
	[/\bpH\b/g, "p H"],
	[/\be\.g\.,?/g, "for example"],
	[/\bi\.e\.,?/g, "that is"],
	[/\bet al\./g, "et al"],
	[/\bvs\.?(?=\s)/g, "versus"],
	[/\bDr\./g, "Doctor"],
	[/\bFig\.\s?(?=\d)/g, "Figure "],
	[/[*_`#]/g, ""],
];

/** Acronyms a TTS engine would mispronounce. Spelled letter by letter. Unlisted all-caps tokens are left alone. */
const SPELL: Readonly<Record<string, string>> = {
	LLM: "L L M",
	GPU: "G P U",
	CPU: "C P U",
	RAM: "R A M",
	VRAM: "V R A M",
	GDP: "G D P",
	OAS: "O A S",
	HY: "H Y",
	API: "A P I",
	TTS: "T T S",
	ASR: "A S R",
	WER: "W E R",
	RTF: "R T F",
	SQL: "S Q L",
	HTML: "H T M L",
	CSS: "C S S",
	JSON: "J S O N",
	PDF: "P D F",
	USD: "U S D",
	ETF: "E T F",
	AI: "A I",
	ML: "M L",
	CI: "C I",
	OLS: "O L S",
	IID: "I I D",
	GMM: "G M M",
	ONNX: "O N N X",
	WASM: "W A S M",
};
const SPELL_TOKEN = /\b([A-Z]{2,6})(s?)\b/g;

/** Normalises prose for a TTS engine. Pure: same input, same output. */
export function normalizeForSpeech(input: string): string {
	let text = input
		.replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "") // citations [12], [3, 4]
		.normalize("NFD")
		.replace(/\p{M}/gu, "") // combining marks (Ŷ -> Y)
		.normalize("NFC");

	text = text.replace(/[α-ωΑ-Ω]/gu, (ch) => ` ${GREEK[ch] ?? ch} `);
	for (const [pattern, replacement] of SYMBOLS)
		text = text.replace(pattern, replacement);

	text = text.replace(
		MONEY,
		(_m, amount: string, scale: string | undefined) => {
			const words = numberWords(amount);
			const unit = scale ? ` ${MONEY_SCALE[scale]}` : "";
			const dollars =
				amount.replace(/,/g, "") === "1" && !scale ? "dollar" : "dollars";
			return `${words}${unit} ${dollars}`;
		},
	);

	text = text.replace(
		YEAR_RANGE,
		(_m, a: string, b: string) =>
			`${yearWords(Number(a))} to ${yearWords(Number(b))}`,
	);

	text = text.replace(
		QUANTITY,
		(_m, a: string, b: string | undefined, unit: string) => {
			const [singular, plural] = UNITS[unit];
			const lastValue = Number((b ?? a).replace(/,/g, ""));
			const spokenUnit = lastValue === 1 ? singular : plural;
			const from = numberWords(a);
			if (!b) return `${from} ${spokenUnit}`;
			return `${from} to ${numberWords(b)} ${spokenUnit}`;
		},
	);

	text = text.replace(
		/\bQ([1-4])\b/g,
		(_m, q: string) => `quarter ${ONES[Number(q)]}`,
	);
	text = text.replace(
		/\bp(\d{1,3})\b/g,
		(_m, digits: string) => `p ${numberWords(digits)}`,
	);
	text = text.replace(BARE_NUMBER, (_m, raw: string) => numberWords(raw, true));

	text = text.replace(SPELL_TOKEN, (match, token: string, plural: string) => {
		const spelled = SPELL[token];
		if (!spelled) return match;
		return plural ? `${spelled}'s` : spelled;
	});

	return text
		.replace(/\s+/g, " ")
		.replace(/\s+([,.;:!?)])/g, "$1")
		.trim();
}

export const CHUNK_BUDGET = 300;

/** Splits text at clause boundaries so each piece is at most `budget` characters. */
export function chunkForBudget(text: string, budget = CHUNK_BUDGET): string[] {
	if (text.length <= budget) return [text];
	const pieces: string[] = [];
	let current = "";
	for (const clause of text.split(/(?<=[,;:])\s+/)) {
		const candidate = current ? `${current} ${clause}` : clause;
		if (candidate.length <= budget) {
			current = candidate;
			continue;
		}
		if (current) pieces.push(current);
		// A single clause over budget is split at word boundaries.
		let rest = clause;
		while (rest.length > budget) {
			const cut = rest.lastIndexOf(" ", budget);
			const at = cut > 0 ? cut : budget;
			pieces.push(rest.slice(0, at));
			rest = rest.slice(at).trimStart();
		}
		current = rest;
	}
	if (current) pieces.push(current);
	return pieces;
}
