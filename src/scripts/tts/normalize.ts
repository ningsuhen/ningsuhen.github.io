/**
 * Text normaliser for speech: turns written text into what a narrator would say, before any engine sees it.
 *
 * This is the single pre-pass for both engines. The Web Speech engine gets this output as is. The neural engine
 * (public/tts/kokoro.js) runs Brev's Rust port of the original rules inside speak(); that second pass is a no-op
 * on this output because no digits, symbols or unspoken acronyms survive (test:tts pins it on every golden).
 * Keep this file dependency-free so the node:test suite can import it directly.
 *
 * Order matters: unicode clean-up, links and citations first; then abbreviations, code tokens, dates, times and
 * versions; then quantities (money, units, sizes, ranges); then bare numbers; then acronyms; punctuation last.
 * Digits never survive into the output. Every rule is listed with examples in test:tts.
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
/** Integers longer than this are read digit by digit (ids, phone numbers). */
const MAX_CARDINAL_DIGITS = 15;

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

const ORDINAL_WORD: Readonly<Record<string, string>> = {
	one: "first",
	two: "second",
	three: "third",
	five: "fifth",
	eight: "eighth",
	nine: "ninth",
	twelve: "twelfth",
};

/** 1 -> "first", 23 -> "twenty-third", 100 -> "one hundredth". */
export function ordinal(n: number): string {
	const words = cardinal(n);
	return words.replace(/([a-z]+)$/, (last: string) => {
		if (ORDINAL_WORD[last]) return ORDINAL_WORD[last];
		if (last.endsWith("y")) return `${last.slice(0, -1)}ieth`;
		return `${last}th`;
	});
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

/** "nineteen ninety" -> "nineteen nineties", "two thousand" -> "two thousands". */
function pluralWords(words: string): string {
	return words.replace(/([a-z]+)$/, (last: string) =>
		last.endsWith("y") ? `${last.slice(0, -1)}ies` : `${last}s`,
	);
}

const DIGIT_WORDS = (digits: string): string =>
	[...digits].map((d) => ONES[Number(d)]).join(" ");

/** Parses "1,113.6" into speech: "one thousand one hundred thirteen point six". */
function numberWords(raw: string, year = false): string {
	const clean = raw.replace(/,/g, "");
	const [intPart, fracPart] = clean.split(".");
	const head =
		intPart === ""
			? ""
			: (intPart.length > 1 && intPart.startsWith("0") && !raw.includes(",")) ||
					intPart.length > MAX_CARDINAL_DIGITS
				? DIGIT_WORDS(intPart)
				: year &&
						!fracPart &&
						!raw.includes(",") &&
						Number(intPart) >= 1900 &&
						Number(intPart) <= 2099
					? yearWords(Number(intPart))
					: cardinal(Number(intPart));
	if (!fracPart) return head;
	return `${head} point ${DIGIT_WORDS(fracPart)}`.trim();
}

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

/** Units after a number: [singular, plural]. Longest match wins, so "MB/s" beats "MB". */
export const UNITS: Readonly<Record<string, readonly [string, string]>> = {
	"%": ["percent", "percent"],
	ms: ["millisecond", "milliseconds"],
	µs: ["microsecond", "microseconds"],
	us: ["microsecond", "microseconds"],
	ns: ["nanosecond", "nanoseconds"],
	s: ["second", "seconds"],
	sec: ["second", "seconds"],
	secs: ["second", "seconds"],
	min: ["minute", "minutes"],
	mins: ["minute", "minutes"],
	hr: ["hour", "hours"],
	hrs: ["hour", "hours"],
	KB: ["kilobyte", "kilobytes"],
	kB: ["kilobyte", "kilobytes"],
	MB: ["megabyte", "megabytes"],
	GB: ["gigabyte", "gigabytes"],
	TB: ["terabyte", "terabytes"],
	PB: ["petabyte", "petabytes"],
	KiB: ["kibibyte", "kibibytes"],
	GiB: ["gibibyte", "gibibytes"],
	MiB: ["mebibyte", "mebibytes"],
	TiB: ["tebibyte", "tebibytes"],
	"KB/s": ["kilobyte per second", "kilobytes per second"],
	"MB/s": ["megabyte per second", "megabytes per second"],
	"GB/s": ["gigabyte per second", "gigabytes per second"],
	"TB/s": ["terabyte per second", "terabytes per second"],
	Kbps: ["kilobit per second", "kilobits per second"],
	kbps: ["kilobit per second", "kilobits per second"],
	Mbps: ["megabit per second", "megabits per second"],
	Gbps: ["gigabit per second", "gigabits per second"],
	"tok/s": ["token per second", "tokens per second"],
	"tokens/s": ["token per second", "tokens per second"],
	"it/s": ["iteration per second", "iterations per second"],
	"req/s": ["request per second", "requests per second"],
	"ops/s": ["operation per second", "operations per second"],
	fps: ["frame per second", "frames per second"],
	px: ["pixel", "pixels"],
	TFLOPS: ["teraflop", "teraflops"],
	GFLOPS: ["gigaflop", "gigaflops"],
	Hz: ["hertz", "hertz"],
	kHz: ["kilohertz", "kilohertz"],
	MHz: ["megahertz", "megahertz"],
	GHz: ["gigahertz", "gigahertz"],
	kW: ["kilowatt", "kilowatts"],
	kWh: ["kilowatt hour", "kilowatt hours"],
	MW: ["megawatt", "megawatts"],
	GW: ["gigawatt", "gigawatts"],
	W: ["watt", "watts"],
	mAh: ["milliamp hour", "milliamp hours"],
	dB: ["decibel", "decibels"],
	bp: ["basis point", "basis points"],
	"mol/L": ["mole per liter", "moles per liter"],
	"°C": ["degree Celsius", "degrees Celsius"],
	"°F": ["degree Fahrenheit", "degrees Fahrenheit"],
	"°": ["degree", "degrees"],
	nm: ["nanometer", "nanometers"],
	mm: ["millimeter", "millimeters"],
	cm: ["centimeter", "centimeters"],
	km: ["kilometer", "kilometers"],
	kg: ["kilogram", "kilograms"],
	lb: ["pound", "pounds"],
	lbs: ["pound", "pounds"],
};
const UNIT_ALTERNATION = Object.keys(UNITS)
	.sort((a, b) => b.length - a.length)
	.map((u) => u.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
	.join("|");

/** A number, an optional range "a-b" / "a–b", then a unit. Lookbehind keeps "p95" and "COVID-19" out. */
const QUANTITY = new RegExp(
	String.raw`(?<![\w.])(${NUM})(?:\s*[–-]\s*(${NUM}))?\s?(${UNIT_ALTERNATION})(?![A-Za-z0-9])`,
	"g",
);
const YEAR_RANGE =
	/(?<![\w.])((?:19|20)\d{2})\s*[–-]\s*((?:19|20)\d{2})(?!\d)/g;

const CURRENCY: Readonly<
	Record<string, readonly [string, string, string, string]>
> = {
	$: ["dollar", "dollars", "cent", "cents"],
	"€": ["euro", "euros", "cent", "cents"],
	"£": ["pound", "pounds", "penny", "pence"],
	"¥": ["yen", "yen", "", ""],
	"₹": ["rupee", "rupees", "paisa", "paise"],
};
const SCALE_WORD: Readonly<Record<string, string>> = {
	K: "thousand",
	k: "thousand",
	M: "million",
	B: "billion",
	bn: "billion",
	T: "trillion",
	tn: "trillion",
};
const MONEY = new RegExp(
	String.raw`([$€£¥₹])\s?(${NUM})\s?(bn|tn|[KkMBT])?(?:\s*[–-]\s*[$€£¥₹]?(${NUM})\s?(bn|tn|[KkMBT])?)?(?![A-Za-z])`,
	"g",
);
/** "7B", "100k", "1.5M": a number with a scale letter and nothing after it. */
const SCALED_NUMBER = new RegExp(
	String.raw`(?<![\w.])(${NUM})(bn|tn|[KkMBT])(?![\w])`,
	"g",
);
const BARE_NUMBER =
	/(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?![\w])/g;

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
	Φ: "phi",
	Ψ: "psi",
	Γ: "gamma",
};

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
const MONTH_BY_PREFIX = (word: string): string | undefined =>
	MONTHS.find((m) =>
		m.toLowerCase().startsWith(word.toLowerCase().slice(0, 3)),
	);
const MONTH_NAME =
	"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

/** Spoken file extensions: "deploy.sh" -> "deploy dot S H". */
const EXTENSIONS: Readonly<Record<string, string>> = {
	sh: "S H",
	js: "J S",
	mjs: "M J S",
	ts: "T S",
	tsx: "T S X",
	py: "P Y",
	rs: "R S",
	md: "M D",
	json: "Jason",
	yaml: "yamel",
	yml: "yamel",
	toml: "tomel",
	txt: "text",
	html: "H T M L",
	css: "C S S",
	wasm: "wasm",
	onnx: "onyx",
	csv: "C S V",
	go: "go",
	rb: "R B",
	cpp: "C P P",
	png: "P N G",
	jpg: "J P G",
	webp: "web P",
	svg: "S V G",
	pdf: "P D F",
	zip: "zip",
	gz: "G Z",
};
const FILE_NAME = new RegExp(
	String.raw`\b([A-Za-z][\w-]*)\.(${Object.keys(EXTENSIONS).join("|")})\b(?!\.\w)`,
	"g",
);

/**
 * Acronyms spelled letter by letter. Configurable: add a token here to spell it, or to SAY to read it as a word.
 * Unlisted all-caps tokens of two to five letters with no vowel (CRDT, HKDF, PGP) are spelled automatically;
 * unlisted ones with a vowel (CAPE, NASA) are left for the engine to read as a word.
 */
export const SPELL: Readonly<Record<string, string>> = {
	LLM: "L L M",
	GPU: "G P U",
	CPU: "C P U",
	NPU: "N P U",
	TPU: "T P U",
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
	PDF: "P D F",
	USD: "U S D",
	IDF: "I D F",
	TF: "T F",
	ETF: "E T F",
	AI: "A I",
	ML: "M L",
	CI: "C I",
	OLS: "O L S",
	IID: "I I D",
	GMM: "G M M",
	CRDT: "C R D T",
	MLS: "M L S",
	PGP: "P G P",
	HKDF: "H K D F",
	AES: "A E S",
	SHA: "S H A",
	CLI: "C L I",
	URL: "U R L",
	UI: "U I",
	UX: "U X",
	IO: "I O",
	OS: "O S",
	AWS: "A W S",
	IDE: "I D E",
	ISO: "I S O",
	AGI: "A G I",
	EU: "E U",
	US: "U S",
	UK: "U K",
	SSE: "S S E",
	IPA: "I P A",
	VAT: "V A T",
	OSS: "O S S",
	NYC: "N Y C",
	AMD: "A M D",
	ARM: "arm",
};
/** Acronyms read as words, respelled so both engines say them the way people do. */
export const SAY: Readonly<Record<string, string>> = {
	JSON: "Jason",
	ONNX: "onyx",
	WASM: "wasm",
	SIMD: "sim D",
	YAML: "yamel",
	GUI: "gooey",
	ASCII: "askee",
	SaaS: "sass",
	TOML: "tomel",
	NASA: "NASA",
	GIF: "gif",
	RAG: "rag",
	KB: "kilobytes",
	MB: "megabytes",
	GB: "gigabytes",
	TB: "terabytes",
};
const SPELL_TOKEN = /\b([A-Z]{2,6}|SaaS)(s?)\b/g;
/** A lowercase-led word glued to an acronym: WebGPU, OpenAI, macOS, vLLM. */
const COMPOUND_TOKEN = /\b([A-Z]?[a-z]+)([A-Z]{2,5})(s?)\b/g;

function spokenAcronym(token: string): string | null {
	if (SAY[token]) return SAY[token];
	if (SPELL[token]) return SPELL[token];
	if (token.length <= 5 && !/[AEIOUY]/.test(token)) return [...token].join(" ");
	return null;
}

/** Roman numerals are only read after a word that takes a number ("Part II", "World War II"). */
const ROMAN_CONTEXT =
	/\b(Chapter|Part|Phase|Act|Book|Volume|Section|Type|Level|Stage|Round|Tier|Season|Episode|War|Class|Article|Appendix|Grade|Step)\s+([IVXLC]{1,6})\b(?!['’])/g;
const ROMAN_AFTER_NAME =
	/(?<=\b[A-Z][a-z]+\s)(II|III|IV|VII|VIII|IX|XII|XIII|XIV|XVI)\b/g;
const ROMAN_VALID = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

export function romanToInt(roman: string): number | null {
	if (!roman || !ROMAN_VALID.test(roman)) return null;
	const value: Record<string, number> = {
		I: 1,
		V: 5,
		X: 10,
		L: 50,
		C: 100,
		D: 500,
		M: 1000,
	};
	let total = 0;
	for (let i = 0; i < roman.length; i++) {
		const v = value[roman[i]];
		const next = value[roman[i + 1]] ?? 0;
		total += v < next ? -v : v;
	}
	return total;
}

const SUPERSCRIPT: Readonly<Record<string, string>> = {
	"⁰": "0",
	"¹": "1",
	"²": "2",
	"³": "3",
	"⁴": "4",
	"⁵": "5",
	"⁶": "6",
	"⁷": "7",
	"⁸": "8",
	"⁹": "9",
	"⁻": "-",
	"⁺": "",
};

/** " to the power of N", with 2 and 3 read as "squared" and "cubed". */
function power(exponent: string): string {
	if (exponent === "2") return " squared";
	if (exponent === "3") return " cubed";
	return ` to the power of ${exponent.replace(/^-/, "minus ")}`;
}

/** Abbreviations whose period must not end a sentence, and how they are said. */
const ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\bTL;DR\b/g, "T L D R"],
	[/\barXiv[:\s]\s*\d{4}\.\d{4,5}(?:v\d+)?/g, "archive"],
	[/\barXiv\b/g, "archive"],
	[/\bE\.g\./g, "For example"],
	[/\be\.g\./g, "for example"],
	[/\bI\.e\./g, "That is"],
	[/\bi\.e\./g, "that is"],
	[/\betc\.(?=\s*$)/g, "et cetera."],
	[/\betc\./g, "et cetera"],
	[/\bet al\./g, "et al"],
	[/\bvs\.?(?=\s)/g, "versus"],
	[/\bDr\./g, "Doctor"],
	[/\bMrs\./g, "Missus"],
	[/\bMr\./g, "Mister"],
	[/\bMs\./g, "Miz"],
	[/\bProf\./g, "Professor"],
	[/\bJr\./g, "Junior"],
	[/\bSr\./g, "Senior"],
	[/\bapprox\./gi, "approximately"],
	[/\bcf\./g, "compare"],
	[/\bFigs?\.\s?(?=\d)/g, "Figure "],
	[/\bEqs?\.\s?(?=\d)/g, "Equation "],
	[/\bNo\.\s?(?=\d)/g, "number "],
	[/\bpp\.\s?(?=\d)/g, "pages "],
	[/\bvol\.\s?(?=\d)/gi, "volume "],
	[/\bU\.S\./g, "U S"],
	[/\bU\.K\./g, "U K"],
	[/\bw\/o\b/g, "without"],
	[/\bw\/(?=\s)/g, "with"],
	[/\bN\/A\b/g, "not applicable"],
	[/\band\/or\b/g, "and or"],
	[/\b24\/7\b/g, "twenty-four seven"],
	[/\b50\/50\b/g, "fifty fifty"],
	[/\bI\/O\b/g, "I O"],
];

const SYMBOLS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\s*~\s*(?=\d)/g, " about "],
	[/\s*~\s*(?=[A-Za-z])/g, " distributed as "],
	[/(?<=[A-Za-z])\s*\/\s*(?=[A-Za-z])/g, "/"],
	[/≈\s*/g, " about "],
	[/≥\s*/g, " at least "],
	[/≤\s*/g, " at most "],
	[/≠\s*|\s*!=\s*/g, " not equal to "],
	[/∞/g, " infinity "],
	[/√\s*/g, " square root of "],
	[/÷/g, " divided by "],
	[/×/g, " times "],
	[/±/g, " plus or minus "],
	[/−|(?<=\s)-(?=\d)/g, " minus "],
	[/\s*(?:→|⇒|->|=>)\s*/g, " to "],
	[/<-|[←↑↓↔⇐]/g, ""],
	[/(?<![=<>!])\s*=\s*(?![=>])/g, " equals "],
	[/(?<=[\w)])\s*\+\s*(?=[\w(])/g, " plus "],
	[/(?<=\d)\+(?!\w)/g, " plus"],
	[/\s>\s/g, " greater than "],
	[/\s<\s/g, " less than "],
	[/&/g, " and "],
	[/\bpH\b/g, "p H"],
	[/#(?=\d)/g, "number "],
	[/(?<=\w)@(?=\w)/g, " at "],
	[/(?<=[A-Za-z0-9])_(?=[A-Za-z0-9])/g, " "],
	[/[*_`#\\^]/g, ""],
	[/\s*[|•·▪◦]\s*/g, ", "],
];

/** "/month" after a quantity: "$5/month" -> "five dollars per month". */
const PER =
	/(?<=\w)\s?\/\s?(second|sec|s|minute|min|hour|hr|h|day|week|month|mo|year|yr|user|seat|token|request|GB|TB|M|million)\b/g;
const PER_WORD: Readonly<Record<string, string>> = {
	sec: "second",
	s: "second",
	min: "minute",
	hr: "hour",
	h: "hour",
	mo: "month",
	yr: "year",
	M: "million",
};

const FRACTION_NAME: Readonly<Record<number, readonly [string, string]>> = {
	2: ["half", "halves"],
	4: ["quarter", "quarters"],
};

function fractionWords(num: number, den: number): string {
	if (num > 0 && num < den && den <= 10) {
		const [one, many] = FRACTION_NAME[den] ?? [
			ordinal(den),
			`${ordinal(den)}s`,
		];
		return `${cardinal(num)} ${num === 1 ? one : many}`;
	}
	if (num <= den && (den === 10 || den === 100 || den === 5))
		return `${cardinal(num)} out of ${cardinal(den)}`;
	return `${cardinal(num)} over ${cardinal(den)}`;
}

function clockWords(
	h: number,
	m: number,
	meridiem: string | undefined,
): string {
	const hour = cardinal(h);
	const suffix = meridiem ? ` ${meridiem.toUpperCase()} M` : "";
	if (m === 0)
		return meridiem
			? `${hour}${suffix}`
			: h <= 12
				? `${hour} o'clock`
				: `${hour} hundred`;
	const minutes = m < 10 ? `oh ${ONES[m]}` : twoDigits(m);
	return `${hour} ${minutes}${suffix}`;
}

/** The period after "pm" also ends the sentence when it is the last thing said or a capital follows. */
function keptStop(inner: string, dot: string, rest: string): string {
	if (!dot) return "";
	return !inner || /^\s*($|[A-Z"])/.test(rest) ? "." : "";
}

/** Inline aside in parentheses: kept, but read as a clause between commas instead of glued to the sentence. */
const ASIDE = /(^|\s)\(([^()]+)\)(?=(\s|[,.;:!?]|$))/g;

/** Normalises prose for a TTS engine. Pure: same input, same output. */
export function normalizeForSpeech(input: string): string {
	let text = input
		.replace(/[\u00A0\u2007\u202F\u2009]/g, " ")
		.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
		.replace(/[‘’‛′´](?=[a-z])/gi, "'")
		.replace(/[‘’‛]/g, "'")
		.replace(/[“”„″]/g, '"')
		.replace(/…/g, "...")
		.replace(/\.{4,}/g, "...");

	// Emoji, pictographs, flags, variation selectors and glyph icons are never spoken.
	text = text
		.replace(
			/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0E\uFE0F\u20E3]/gu,
			"",
		)
		.replace(/[✓✔✗✘☐☑►▶◀▸▹]/g, "");

	// Links, DOIs and email addresses.
	text = text
		.replace(
			/\b(?:doi:\s?|https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/[^\s]*[^\s.,;:!?)\]'"]/gi,
			"link",
		)
		.replace(/\b(?:https?:\/\/|www\.)[^\s<>"]*[^\s<>".,;:!?)\]'"]/gi, "link")
		.replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "email address")
		.replace(
			/\b((?:[a-z0-9-]+\.)+)(com|org|net|io|dev|ai|app|edu|gov)\b(?![\w/])/g,
			(_m, head: string, tld: string) =>
				`${head.replace(/\./g, " dot ")}${tld}`,
		);

	// Citations: dropped, or read as "reference N" where dropping would leave "as shown in." dangling.
	text = text
		.replace(
			/\b(in|see|from|by|of|cf\.?|to|and)\s+\[(\d+(?:\s*[,–-]\s*\d+)*)\]/gi,
			(_m, prep: string, list: string) => {
				const many = /[,–-]/.test(list);
				const spoken = list
					.replace(/\s*[–-]\s*/g, " to ")
					.replace(/\s*,\s*(?=[^,]*$)/, " and ")
					.replace(/\s*,\s*/g, ", ");
				return `${prep} reference${many ? "s" : ""} ${spoken}`;
			},
		)
		.replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "");

	text = text.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
	text = text.replace(/[α-ωΑ-Ω]/gu, (ch) => ` ${GREEK[ch] ?? ch} `);

	// Times before abbreviations, so "10 a.m." keeps its meridiem.
	text = text
		.replace(
			/\b([01]?\d|2[0-3]):([0-5]\d)(?!:\d)(?:\s?([AaPp])(\.?)[Mm](\.?)(?![A-Za-z]))?/g,
			(
				_m,
				h: string,
				m: string,
				mer: string | undefined,
				inner: string,
				dot: string,
				at: number,
				all: string,
			) =>
				clockWords(Number(h), Number(m), mer) +
				keptStop(inner, dot, all.slice(at + _m.length)),
		)
		.replace(
			/\b(1[0-2]|0?[1-9])\s?([AaPp])(\.?)[Mm](\.?)(?![A-Za-z])/g,
			(
				_m,
				h: string,
				mer: string,
				inner: string,
				dot: string,
				at: number,
				all: string,
			) =>
				clockWords(Number(h), 0, mer) +
				keptStop(inner, dot, all.slice(at + _m.length)),
		)
		.replace(/\b(\d{1,2}):(\d{1,2})\b(?!:)/g, "$1 to $2");

	for (const [pattern, replacement] of ABBREVIATIONS)
		text = text.replace(pattern, replacement);

	// Code-shaped tokens people still say aloud.
	text = text
		.replace(/\bC\+\+/g, "C plus plus")
		.replace(/\b([CF])#/g, "$1 sharp")
		.replace(/(^|\s)\.NET\b/g, "$1dot net")
		.replace(/(^|\s)\.([a-z][\w-]*)\b/g, "$1dot $2")
		.replace(/\b([A-Z][A-Za-z0-9]*)\.js\b/g, "$1 J S")
		.replace(
			FILE_NAME,
			(_m, name: string, ext: string) => `${name} dot ${EXTENSIONS[ext]}`,
		)
		.replace(/\(\s*\)/g, "");

	// Dates.
	text = text
		.replace(
			/\b((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g,
			(_m, y: string, mo: string, d: string) =>
				`${MONTHS[Number(mo) - 1]} ${ordinal(Number(d))}, ${yearWords(Number(y))}`,
		)
		.replace(
			new RegExp(
				String.raw`\b(${MONTH_NAME})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!:)(?:(,?)\s+((?:19|20)\d{2})\b)?`,
				"g",
			),
			(_m, mo: string, d: string, _comma: string, y: string | undefined) =>
				`${MONTH_BY_PREFIX(mo)} ${ordinal(Number(d))}${y ? `, ${yearWords(Number(y))}` : ""}`,
		)
		.replace(
			new RegExp(
				String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_NAME})\b\.?(?:,?\s+((?:19|20)\d{2})\b)?`,
				"g",
			),
			(_m, d: string, mo: string, y: string | undefined) =>
				`${MONTH_BY_PREFIX(mo)} ${ordinal(Number(d))}${y ? `, ${yearWords(Number(y))}` : ""}`,
		);

	// Versions: "v1.2.3" and dotted triples are read part by part.
	text = text
		.replace(
			/\b[vV](\d+(?:\.\d+)*)\b/g,
			(_m, v: string) =>
				`version ${v
					.split(".")
					.map((p) => numberWords(p))
					.join(" point ")}`,
		)
		.replace(/(?<![\w.])\d+(?:\.\d+){2,}(?![\w.])/g, (v: string) =>
			v
				.split(".")
				.map((p) => numberWords(p))
				.join(" point "),
		);

	// Powers: scientific notation, carets and superscripts.
	text = text
		.replace(
			/(?<![\w.])(\d+(?:\.\d+)?)[eE]([+-]?\d+)\b/g,
			(_m, mant: string, exp: string) =>
				`${mant} times ten${power(exp.replace("+", ""))}`,
		)
		.replace(/(?<=[\w)])\^\{?(-?\d+)\}?/g, (_m, exp: string) => power(exp))
		.replace(/[⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (sup: string) =>
			power([...sup].map((c) => SUPERSCRIPT[c]).join("")),
		);

	// Hyphen glue: "GPT-4" -> "GPT 4", "Qwen3.5-4B" -> "Qwen3.5 4B"; "Step #1 - Setup" is handled with dashes.
	text = text
		.replace(/(?<=[A-Za-z])-(?=\d)/g, " ")
		.replace(
			/(?<=[A-Za-z]\d+(?:\.\d+)?)-(?=\d+(?:\.\d+)?(?:[KMBT]|bn)\b)/g,
			" ",
		);
	// GPU model numbers are read in pairs: "RTX 4060" -> "RTX forty sixty".
	text = text.replace(
		/\b(RTX|GTX|RX|GT)\s?(\d{2})(\d{2})\b/g,
		(_m, line: string, a: string, b: string) =>
			`${line} ${twoDigits(Number(a))} ${b === "00" ? "hundred" : Number(b) < 10 ? `oh ${ONES[Number(b)]}` : twoDigits(Number(b))}`,
	);

	for (const [pattern, replacement] of SYMBOLS)
		text = text.replace(pattern, replacement);

	text = text.replace(
		MONEY,
		(
			_m,
			symbol: string,
			amount: string,
			scale: string | undefined,
			upper: string | undefined,
			upperScale: string | undefined,
		) => {
			const [one, many, subOne, subMany] = CURRENCY[symbol];
			const lastScale = upperScale ?? scale;
			if (upper) {
				const from = `${numberWords(amount)}${scale && scale !== upperScale ? ` ${SCALE_WORD[scale]}` : ""}`;
				return `${from} to ${numberWords(upper)}${lastScale ? ` ${SCALE_WORD[lastScale]}` : ""} ${many}`;
			}
			const [whole, cents] = amount.replace(/,/g, "").split(".");
			if (!scale && cents?.length === 2 && subMany) {
				const c = Number(cents);
				const centWords = `${cardinal(c)} ${c === 1 ? subOne : subMany}`;
				if (Number(whole) === 0) return centWords;
				const d = numberWords(whole);
				const dollars = `${d} ${whole === "1" ? one : many}`;
				return c === 0 ? dollars : `${dollars} and ${centWords}`;
			}
			const words = numberWords(amount);
			const unit = scale ? ` ${SCALE_WORD[scale]}` : "";
			const name = amount.replace(/,/g, "") === "1" && !scale ? one : many;
			return `${words}${unit} ${name}`;
		},
	);

	// Decades before units, so "1990s" is not "1990 seconds".
	text = text
		.replace(/(?<![\w.])((?:19|20)\d0)s\b/g, (_m, y: string) =>
			pluralWords(yearWords(Number(y))),
		)
		.replace(/'(\d)0s\b/g, (_m, d: string) =>
			pluralWords(TENS[Number(d)] || "ten"),
		)
		// Plural numerals after a determiner: "powers of 2s" -> "twos", not "two seconds".
		.replace(
			/(?<=\b(?:of|in|by|the|into|all)\s)(\d{1,2})s\b/g,
			(_m, n: string) => pluralWords(cardinal(Number(n))),
		);

	// "between 3 and 5", not "between 3 to 5".
	text = text.replace(
		new RegExp(
			String.raw`\b([Bb]etween\s+)(${NUM})\s*[–-]\s*(${NUM})(?![\w.])`,
			"g",
		),
		"$1$2 and $3",
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
		PER,
		(_m, unit: string) => ` per ${PER_WORD[unit] ?? unit}`,
	);

	// Multipliers and dimensions: "3.5x" -> "three point five times", "8x7B" -> "eight by seven billion".
	text = text
		.replace(/(?<![\w.])(\d+)\s?[x×](?=\s?\d)/g, "$1 by ")
		.replace(
			new RegExp(String.raw`(?<![\w.])(${NUM})\s?[xX×](?![\w])`, "g"),
			"$1 times",
		);

	text = text.replace(
		new RegExp(
			String.raw`(?<![\w.])(${NUM})\s*[–-]\s*(${NUM})(bn|tn|[KkMBT])(?![\w])`,
			"g",
		),
		"$1 to $2$3",
	);
	text = text.replace(
		SCALED_NUMBER,
		(_m, n: string, scale: string) => `${numberWords(n)} ${SCALE_WORD[scale]}`,
	);

	text = text.replace(/\b(\d+)(st|nd|rd|th)\b/g, (_m, n: string) =>
		ordinal(Number(n)),
	);

	text = text.replace(
		/(?<![\w./])(\d{1,3})\/(\d{1,3})(?![\w/])/g,
		(_m, a: string, b: string) => fractionWords(Number(a), Number(b)),
	);

	// Plain numeric ranges: "3-5" -> "three to five".
	text = text.replace(
		new RegExp(String.raw`(?<![\w.])(${NUM})\s*[–-]\s*(${NUM})(?![\w.])`, "g"),
		"$1 to $2",
	);

	text = text.replace(
		/(?<=\b(?:in|by|during|for|of|the|and|from|to|through|until|since|each|every|a|per)\s)Q([1-4])\b|\bQ([1-4])(?=\s(?:19|20)\d{2}\b)/g,
		(_m, q: string | undefined, q2: string | undefined) =>
			`quarter ${ONES[Number(q ?? q2)]}`,
	);
	text = text.replace(
		/\bp(\d{1,3})\b/g,
		(_m, digits: string) => `p ${numberWords(digits)}`,
	);
	// Letters glued to digits: "L1" -> "L one", "H100" -> "H one hundred", "x86" -> "x eighty-six".
	text = text.replace(/\b([A-Za-z]{1,4})(\d{1,4})\b/g, "$1 $2");

	text = text
		.replace(ROMAN_CONTEXT, (m, word: string, roman: string) => {
			const n = romanToInt(roman);
			if (n === null || (roman.length === 1 && !"IVX".includes(roman)))
				return m;
			return `${word} ${cardinal(n)}`;
		})
		.replace(ROMAN_AFTER_NAME, (m: string) => {
			const n = romanToInt(m);
			return n === null ? m : cardinal(n);
		});

	text = text.replace(BARE_NUMBER, (_m, raw: string) => numberWords(raw, true));

	// An acronym defined in parentheses right after its words is not read twice: "text to speech (TTS)".
	text = text.replace(/(?<=[a-z]{2})\s\(([A-Z]{2,6}s?)\)/g, "");
	text = text.replace(
		COMPOUND_TOKEN,
		(match, head: string, tail: string, plural: string) => {
			const spoken = spokenAcronym(tail);
			if (!spoken) return match;
			return `${head} ${spoken}${plural ? "'s" : ""}`;
		},
	);
	text = text.replace(SPELL_TOKEN, (match, token: string, plural: string) => {
		const spoken = spokenAcronym(token);
		if (!spoken) return match;
		return plural ? `${spoken}'s` : spoken;
	});

	// Punctuation for prosody: asides, dashes and stray separators become commas.
	text = text
		.replace(ASIDE, (_m, lead: string, inner: string) => `${lead}, ${inner},`)
		.replace(/\s*(?:—|--+|\s–\s|\s-\s)\s*/g, ", ");

	return text
		.replace(/\s+/g, " ")
		.replace(/\s+([,.;:!?)])(?=\s|$|["')\]])/g, "$1")
		.replace(/\(\s+/g, "(")
		.replace(/([!?])\.(?!\.)/g, "$1")
		.replace(/,(\s*,)+/g, ",")
		.replace(/,\s*(?=[.;:!?)]|$)/g, "")
		.replace(/(?<!\.)\.\.(?!\.)/g, ".")
		.replace(/^[\s,;:]+/, "")
		.replace(/([;:])\s*,/g, "$1")
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
