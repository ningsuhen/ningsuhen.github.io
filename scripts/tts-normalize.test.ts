// Unit tests for the Listen player's speech text: normaliser, announcements and chunker. Run: pnpm test:tts
// Sentences come from the site's posts and the scientific-text probe set.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
	codeBlockSpeech,
	identifierWords,
	imageSpeech,
	inlineCodeSpeech,
	isMeaningfulAlt,
	tableSpeech,
	texToSpeech,
	withTerminalPunctuation,
} from "../src/scripts/tts/announce.ts";
import {
	CHUNK,
	estimateTokens,
	pauseClass,
	prosodyGroups,
	splitFirstSentence,
	splitSentence,
	withPauses,
} from "../src/scripts/tts/chunk.ts";
import { accelerationLabel } from "../src/scripts/tts/engine.ts";
import { PAUSE_S, pauseAfter, scaledPause } from "../src/scripts/tts/pauses.ts";
import {
	CHUNK_BUDGET,
	cardinal,
	chunkForBudget,
	normalizeForSpeech,
	ordinal,
	romanToInt,
} from "../src/scripts/tts/normalize.ts";
import {
	applyPronunciations,
	type LexiconEntry,
	lexiconMap,
	mergePronunciations,
} from "../src/scripts/tts/pronounce.ts";

/**
 * The original goldens (shared with Brev's Rust port). Three changed on purpose in kokoro-natural:
 * #5 a citation after "in" is read ("in reference twelve") instead of leaving "as shown in." dangling;
 * #7 "=" and "+" are read as "equals" and "plus"; #16 "Between a-b" reads "between a and b".
 */
const GOLDENS: ReadonlyArray<readonly [string, string]> = [
	[
		"The fund held $1,113.6B in assets, up 12.5%.",
		"The fund held one thousand one hundred thirteen point six billion dollars in assets, up twelve point five percent.",
	],
	[
		"2026 capex guidance is $760bn against $152bn of revenue.",
		"twenty twenty-six capex guidance is seven hundred sixty billion dollars against one hundred fifty-two billion dollars of revenue.",
	],
	[
		"Recession odds are 9% at 6 months, and 80% at 60 months.",
		"Recession odds are nine percent at six months, and eighty percent at sixty months.",
	],
	[
		"CAPE and HY OAS widened to 412 bp in Q3.",
		"CAPE and H Y O A S widened to four hundred twelve basis points in quarter three.",
	],
	[
		"Results are in Figure 3, as shown in [12].",
		"Results are in Figure three, as shown in reference twelve.",
	],
	[
		"Let α be the learning rate and β the momentum.",
		"Let alpha be the learning rate and beta the momentum.",
	],
	[
		"The estimator is Ŷ = Xβ + ε, where ε ~ N(0, σ²).",
		"The estimator is Y equals X beta plus epsilon, where epsilon distributed as N(zero, sigma squared).",
	],
	["α/β and 42% leaks.", "alpha/beta and forty-two percent leaks."],
	[
		"We report a 3–5 ms latency range.",
		"We report a three to five milliseconds latency range.",
	],
	[
		"Dr. Smith's 2024 paper argued that LLMs read well.",
		"Doctor Smith's twenty twenty-four paper argued that L L M's read well.",
	],
	[
		"The GPU ran at 1.5 TFLOPS with 16 GB of VRAM.",
		"The G P U ran at one point five teraflops with sixteen gigabytes of V R A M.",
	],
	[
		"pH 7.4 at 37 °C with 0.5 mol/L NaCl.",
		"p H seven point four at thirty-seven degrees Celsius with zero point five moles per liter NaCl.",
	],
	[
		"The 2008–2009 recession cut GDP by 2.5%.",
		"The two thousand eight to two thousand nine recession cut G D P by two point five percent.",
	],
	["p95 ~97 ms", "p ninety-five about ninety-seven milliseconds"],
	[
		"Run pip install kokoro, e.g. with -5 offset.",
		"Run pip install kokoro, for example with minus five offset.",
	],
	[
		"Between 1971-2019 the curve inverted 14 times.",
		"Between nineteen seventy-one and twenty nineteen the curve inverted fourteen times.",
	],
	[
		"A 4.66 billion parameter model needs 2.27 GiB.",
		"A four point six six billion parameter model needs two point two seven gibibytes.",
	],
	["Citations like [3, 4] disappear.", "Citations like disappear."],
	[
		"The gap is $55B, a 1 ms delay, and 2.5% of GDP.",
		"The gap is fifty-five billion dollars, a one millisecond delay, and two point five percent of G D P.",
	],
];

/** One or more goldens per rule (rule name, input, expected). RULES.md in the PR lists the same table. */
const RULES: ReadonlyArray<readonly [string, string, string]> = [
	// numbers
	["cardinal", "We tested 3 models.", "We tested three models."],
	["thousands", "It has 1,048,576 entries.", "It has one million forty-eight thousand five hundred seventy-six entries."],
	["decimal", "Latency was 0.5 seconds.", "Latency was zero point five seconds."],
	["leading-decimal", "A gain of .5 is small.", "A gain of point five is small."],
	["leading-zero", "Agent 007 called.", "Agent zero zero seven called."],
	["year", "In 1999 it shipped.", "In nineteen ninety-nine it shipped."],
	["year-2000s", "By 2005 it was gone.", "By two thousand five it was gone."],
	["ordinal", "The 1st, 2nd, 3rd and 23rd runs.", "The first, second, third and twenty-third runs."],
	["ordinal-hundred", "Her 100th post.", "Her one hundredth post."],
	["percent", "Accuracy rose 12%.", "Accuracy rose twelve percent."],
	["percent-range", "A 10-20% drop.", "A ten to twenty percent drop."],
	["range", "Pick 3-5 items.", "Pick three to five items."],
	["range-en-dash", "Pages 10–20 cover it.", "Pages ten to twenty cover it."],
	["range-between", "Between 3-5 items fit.", "Between three and five items fit."],
	["negative", "Set it to -5 now.", "Set it to minus five now."],
	["minus-sign", "The delta was −3.", "The delta was minus three."],
	["plural-numeral", "Powers of 2s are obvious.", "Powers of twos are obvious."],
	["decade", "Music from the 1990s.", "Music from the nineteen nineties."],
	["decade-short", "Back in the '80s.", "Back in the eighties."],
	["multiplier", "It is 3.5x faster.", "It is three point five times faster."],
	["multiplier-upper", "About 4X memory.", "About four times memory."],
	["dimension", "An 8x7B mixture.", "An eight by seven billion mixture."],
	["scale-billion", "A 7B model.", "A seven billion model."],
	["scale-thousand", "Over 100k users.", "Over one hundred thousand users."],
	["fraction-half", "Add 1/2 cup.", "Add one half cup."],
	["fraction-quarter", "About 3/4 of runs.", "About three quarters of runs."],
	["fraction-tenths", "I give it 7/10.", "I give it seven tenths."],
	["fraction-over", "A 16/32 split.", "A sixteen over thirty-two split."],
	["ratio", "A 16:9 screen.", "A sixteen to nine screen."],
	["scientific", "A step of 1e-9 works.", "A step of one times ten to the power of minus nine works."],
	["caret-power", "That is 2^10 bytes.", "That is two to the power of ten bytes."],
	["superscript-power", "About 10⁻⁹ seconds.", "About ten to the power of minus nine seconds."],
	["squared", "Area is x² here.", "Area is x squared here."],
	// currency
	["money-scale", "It raised $2.5M.", "It raised two point five million dollars."],
	["money-cents", "It costs $5.99.", "It costs five dollars and ninety-nine cents."],
	["money-cents-only", "Just $0.50 each.", "Just fifty cents each."],
	["money-one", "Only $1 today.", "Only one dollar today."],
	["money-range", "Plans cost $5-10.", "Plans cost five to ten dollars."],
	["money-per", "It is $20/month.", "It is twenty dollars per month."],
	["money-euro", "It costs €30.", "It costs thirty euros."],
	["money-pound", "Tickets are £20.", "Tickets are twenty pounds."],
	// units
	["unit-ms", "Each call takes 120 ms.", "Each call takes one hundred twenty milliseconds."],
	["unit-singular", "Just 1 GB left.", "Just one gigabyte left."],
	["unit-glued", "A 16GB card.", "A sixteen gigabytes card."],
	["unit-rate", "It moves 2 GB/s.", "It moves two gigabytes per second."],
	["unit-mbps", "A 100 Mbps link.", "A one hundred megabits per second link."],
	["unit-khz", "Sampled at 24 kHz.", "Sampled at twenty-four kilohertz."],
	["unit-tok-s", "It runs at 50 tok/s.", "It runs at fifty tokens per second."],
	["unit-minutes", "Wait 5 min please.", "Wait five minutes please."],
	["unit-degrees", "Turn it 45° left.", "Turn it forty-five degrees left."],
	["unit-fahrenheit", "It was 98 °F.", "It was ninety-eight degrees Fahrenheit."],
	["unit-nm", "A 5 nm process.", "A five nanometers process."],
	["unit-per-hour", "Speed in km/h matters.", "Speed in km per hour matters."],
	// dates and times
	["date-iso", "Released 2024-05-01.", "Released May first, twenty twenty-four."],
	["date-us", "On May 1, 2024 it shipped.", "On May first, twenty twenty-four it shipped."],
	["date-day-month", "On 3 March 2025 it broke.", "On March third, twenty twenty-five it broke."],
	["date-short-month", "Due Oct 25.", "Due October twenty-fifth."],
	["time-am", "Meet at 10:30 am.", "Meet at ten thirty A M."],
	["time-oclock", "Starts at 9:00.", "Starts at nine o'clock."],
	["time-oh", "Ends at 4:05 pm.", "Ends at four oh five P M."],
	["time-24h", "Lands at 14:00.", "Lands at fourteen hundred."],
	["time-hour-pm", "Doors open 7pm.", "Doors open seven P M."],
	["time-dotted-meridiem", "By 10 a.m. sharp.", "By ten A M sharp."],
	// versions and code-shaped tokens
	["version", "Upgrade to v1.2.3 now.", "Upgrade to version one point two point three now."],
	["version-minor", "Python v3.12 works.", "Python version three point twelve works."],
	["version-bare", "Tested on 1.27.0 only.", "Tested on one point twenty-seven point zero only."],
	["file-name", "Run deploy.sh first.", "Run deploy dot S H first."],
	["file-json", "Edit config.json today.", "Edit config dot Jason today."],
	["node-js", "Built on Node.js.", "Built on Node J S."],
	["c-plus-plus", "Written in C++ and C#.", "Written in C plus plus and C sharp."],
	["dot-net", "A .NET app.", "A dot net app."],
	["snake-case", "Call chunk_for_budget once.", "Call chunk for budget once."],
	["letter-digit", "The L1 cache and H100 card.", "The L one cache and H one hundred card."],
	["x86", "Runs on x86_64.", "Runs on x eighty-six sixty-four."],
	["hyphen-digit", "GPT-4 is out.", "G P T four is out."],
	["hash-number", "Step #1 - Setup Source Project.", "Step number one, Setup Source Project."],
	["dotfile", "It cleans .git files.", "It cleans dot git files."],
	["model-name", "Derived from Qwen3.5-4B.", "Derived from Qwen three point five four billion."],
	["scaled-range", "We stored 3-5B rows.", "We stored three to five billion rows."],
	["gpu-model", "One RTX 4060 card.", "One R T X forty sixty card."],
	["arxiv", "FeedbackEval (arXiv 2504.06939) found it.", "FeedbackEval, archive, found it."],
	["tldr", "TL;DR it works.", "T L D R it works."],
	["quarter-not-quant", "A Q4_K_M quant.", "A Q four K M quant."],
	["quarter-year", "Revenue in Q3 2024.", "Revenue in quarter three twenty twenty-four."],
	["question-stop", "Went away?.", "Went away?"],
	// acronyms
	["acronym-spell", "The CPU and API.", "The C P U and A P I."],
	["acronym-say", "Export to ONNX as JSON.", "Export to onyx as Jason."],
	["acronym-say-wasm", "Compiled to WASM with SIMD.", "Compiled to wasm with sim D."],
	["acronym-no-vowel", "A CRDT with HKDF and PGP.", "A C R D T with H K D F and P G P."],
	["acronym-mls", "Group chat over MLS.", "Group chat over M L S."],
	["acronym-plural", "Two GPUs and APIs.", "Two G P U's and A P I's."],
	["acronym-word", "NASA and CAPE stay words.", "NASA and CAPE stay words."],
	["acronym-compound", "Runs on WebGPU.", "Runs on Web G P U."],
	["acronym-compound-ai", "OpenAI and macOS.", "Open A I and mac O S."],
	["acronym-definition", "Text to speech (TTS) is fun.", "Text to speech is fun."],
	["acronym-tts", "The TTS voice.", "The T T S voice."],
	["acronym-llm", "An LLM answers.", "An L L M answers."],
	// roman numerals
	["roman-context", "Read Part IV next.", "Read Part four next."],
	["roman-war", "After World War II ended.", "After World War two ended."],
	["roman-after-name", "Diablo II is old.", "Diablo two is old."],
	["roman-not-letter", "See Section C below.", "See Section C below."],
	["roman-pronoun", "I think I can.", "I think I can."],
	// links
	["url", "See https://gohugo.io/tutorials/ for more.", "See link for more."],
	["url-trailing", "Read https://example.com/a.", "Read link."],
	["www", "Visit www.example.org today.", "Visit link today."],
	["doi", "Cited as doi:10.1000/182 here.", "Cited as link here."],
	["email", "Mail me@example.com today.", "Mail email address today."],
	["domain", "Hosted on gohugo.io now.", "Hosted on gohugo dot io now."],
	// citations and footnotes
	["citation-drop", "This is known [3].", "This is known."],
	["citation-range", "As shown in [3-5].", "As shown in references three to five."],
	["citation-list", "See [3, 4] for details.", "See references three and four for details."],
	// abbreviations
	["eg", "Use a tool, e.g., rsync.", "Use a tool, for example, rsync."],
	["eg-capital", "E.g. this one.", "For example this one."],
	["ie", "One rule, i.e. this one.", "One rule, that is this one."],
	["etc-end", "Apples, pears, etc.", "Apples, pears, et cetera."],
	["etc-mid", "Apples, etc. are fruit", "Apples, et cetera are fruit"],
	["vs", "Rust vs. Go.", "Rust versus Go."],
	["mr", "Mr. Smith met Mrs. Jones.", "Mister Smith met Missus Jones."],
	["prof", "Prof. Lee spoke.", "Professor Lee spoke."],
	["approx", "It took approx. 5 s.", "It took approximately five seconds."],
	["no", "Item No. 5 sold.", "Item number five sold."],
	["fig", "See Fig. 2 and Eq. 3.", "See Figure two and Equation three."],
	["w-slash", "Tea w/ milk, w/o sugar.", "Tea with milk, without sugar."],
	["na", "Price is N/A.", "Price is not applicable."],
	["and-or", "Read and/or write.", "Read and or write."],
	["twenty-four-seven", "It runs 24/7.", "It runs twenty-four seven."],
	// symbols and math
	["equals", "Set N=5 first.", "Set N equals five first."],
	["not-equal", "Here x != y holds.", "Here x not equal to y holds."],
	["greater", "When a > b it fails.", "When a greater than b it fails."],
	["approx-sign", "It is ≈ 3 ms.", "It is about three milliseconds."],
	["tilde", "Assuming ~1 GB/sec.", "Assuming about one gigabyte per second."],
	["arrow", "Send CA->NL->CA.", "Send CA to N L to CA."],
	["arrow-glyph", "Input → output.", "Input to output."],
	["ampersand", "Rock & roll.", "Rock and roll."],
	["plus-number", "Over 10+ years.", "Over ten plus years."],
	["at-sign", "Ping user@host.", "Ping user at host."],
	// non-ASCII
	["diacritics", "A café for the naïve.", "A cafe for the naive."],
	["greek", "Set λ and π.", "Set lambda and pi."],
	["curly-apostrophe", "It’s fine, don’t worry.", "It's fine, don't worry."],
	["curly-quotes", "He said “hi” today.", 'He said "hi" today.'],
	["ellipsis", "Wait… what?", "Wait... what?"],
	["nbsp", "Ten\u00a0GB free.", "Ten gigabytes free."],
	["zero-width", "Soft\u00adware\u200b here.", "Software here."],
	["emoji", "Shipped 🚀 today ✅.", "Shipped today."],
	["flag-emoji", "Made in 🇮🇳 India.", "Made in India."],
	["glyph-icons", "Done ✓ next ▶ go.", "Done next go."],
	["bullet", "Fast • small • local.", "Fast, small, local."],
	// punctuation for prosody
	["em-dash", "It works—mostly—today.", "It works, mostly, today."],
	["spaced-en-dash", "It works – mostly.", "It works, mostly."],
	["double-hyphen", "It works -- mostly.", "It works, mostly."],
	["aside-short", "Kokoro (82M) runs fast.", "Kokoro, eighty-two million, runs fast."],
	[
		"aside-long",
		"The model (which I trained on a laptop over a weekend) works.",
		"The model, which I trained on a laptop over a weekend, works.",
	],
	["aside-end", "It ran (mostly).", "It ran, mostly."],
	["function-call", "Call f(x) here.", "Call f(x) here."],
	["empty-parens", "Call init() first.", "Call init first."],
	["compound-hyphen", "A state-of-the-art model.", "A state-of-the-art model."],
	["slash-words", "Read/write access.", "Read/write access."],
];

for (const [input, expected] of GOLDENS) {
	test(`golden: ${input}`, () => {
		assert.equal(normalizeForSpeech(input), expected);
	});
}

for (const [rule, input, expected] of RULES) {
	test(`rule ${rule}: ${input}`, () => {
		assert.equal(normalizeForSpeech(input), expected);
	});
}

const ALL_INPUTS = [...GOLDENS.map(([i]) => i), ...RULES.map(([, i]) => i)];

test("never leaves digits or stray markup in speech text", () => {
	for (const input of ALL_INPUTS)
		assert.doesNotMatch(normalizeForSpeech(input), /\d|\*|`|\$|€|£/, input);
});

test("normalising twice changes nothing", () => {
	for (const input of ALL_INPUTS) {
		const once = normalizeForSpeech(input);
		assert.equal(normalizeForSpeech(once), once, input);
	}
});

test("number helpers", () => {
	assert.equal(cardinal(0), "zero");
	assert.equal(cardinal(1113), "one thousand one hundred thirteen");
	assert.equal(ordinal(12), "twelfth");
	assert.equal(ordinal(40), "fortieth");
	assert.equal(ordinal(101), "one hundred first");
	assert.equal(romanToInt("XIV"), 14);
	assert.equal(romanToInt("IIII"), null);
});

/**
 * Brev's Rust normaliser runs again inside the neural engine's speak(). On this pass's output it must be a no-op,
 * or the two would double-process. Skipped when the wasm is not in public/tts.
 */
const GLUE = new URL("../public/tts/kokoro_glue.js", import.meta.url);
const WASM = new URL("../public/tts/kokoro_bg.wasm", import.meta.url);
test(
	"Rust normaliser in kokoro.js is a no-op on this output",
	{ skip: !existsSync(WASM) },
	async () => {
		const glue = (await import(GLUE.href)) as {
			initSync: (opts: { module: Uint8Array }) => void;
			normalizeForSpeech: (t: string) => string;
		};
		glue.initSync({ module: readFileSync(WASM) });
		const changed = ALL_INPUTS.map((input) => normalizeForSpeech(input))
			.filter((out) => glue.normalizeForSpeech(out) !== out)
			.map((out) => `${out} -> ${glue.normalizeForSpeech(out)}`);
		assert.deepEqual(changed, []);
	},
);

/* ---------- announcements ---------- */

test("code blocks are announced, not read", () => {
	assert.equal(codeBlockSpeech(12), "Code block, 12 lines.");
	assert.equal(codeBlockSpeech(1), "Code block, 1 line.");
	assert.equal(
		normalizeForSpeech(codeBlockSpeech(40, "deploy.sh")),
		"Code block, deploy dot S H, forty lines.",
	);
});

test("tables are summarised instead of read cell by cell", () => {
	assert.equal(
		tableSpeech(5, ["Model", "Size", "Speed"]),
		"Table with 5 rows. Columns: Model, Size and Speed.",
	);
	assert.equal(
		normalizeForSpeech(tableSpeech(14, ["a", "b", "c", "d", "e", "f", "g"])),
		"Table with fourteen rows and seven columns.",
	);
	assert.equal(
		tableSpeech(1, [], 2, "Results"),
		"Table, Results, with 1 row and 2 columns.",
	);
});

test("alt text only when it says something", () => {
	assert.equal(isMeaningfulAlt(""), false);
	assert.equal(isMeaningfulAlt("image"), false);
	assert.equal(isMeaningfulAlt("cover.png"), false);
	assert.equal(isMeaningfulAlt("IMG_2041"), false);
	assert.equal(
		imageSpeech("A cat asleep on a keyboard"),
		"Image: A cat asleep on a keyboard.",
	);
	assert.equal(imageSpeech("Screenshot"), null);
});

test("inline code is read only when it is a word", () => {
	assert.equal(inlineCodeSpeech("rsync"), "rsync");
	assert.equal(inlineCodeSpeech("chunkForBudget"), "chunk For Budget");
	assert.equal(inlineCodeSpeech("git push"), "git push");
	assert.equal(inlineCodeSpeech("hugo -d public"), "code");
	assert.equal(inlineCodeSpeech("/path/to/project"), "project");
	assert.equal(inlineCodeSpeech(".git/hooks/pre-push"), "pre push");
	assert.equal(inlineCodeSpeech("--locked"), "locked");
	assert.equal(inlineCodeSpeech("toordinal()"), "toordinal");
	assert.equal(inlineCodeSpeech("device: 'webgpu'"), "code");
	assert.equal(inlineCodeSpeech("a.b(c) + d"), "code");
	assert.equal(identifierWords("snake_case_name"), "snake case name");
});

test("headings, list items and captions land on a full stop", () => {
	assert.equal(withTerminalPunctuation("Jeff Dean's Numbers"), "Jeff Dean's Numbers.");
	assert.equal(withTerminalPunctuation("Already done?"), "Already done?");
	assert.equal(withTerminalPunctuation("Trailing comma,"), "Trailing comma.");
});

test("simple math is read as a phrase, the rest is 'equation'", () => {
	assert.equal(texToSpeech("x^2 + y_1"), "x squared plus y sub 1");
	assert.equal(normalizeForSpeech(texToSpeech("O(n \\log n)") ?? ""), "O of n log n");
	assert.equal(texToSpeech("\\alpha \\leq \\frac{1}{2}"), "alpha at most 1 over 2");
	assert.equal(
		normalizeForSpeech(texToSpeech("2^{10} = 1024") ?? ""),
		"two to the power of ten equals one thousand twenty-four",
	);
	assert.equal(texToSpeech("\\begin{align*} 2^0 &= 1 \\end{align*}"), null);
	assert.equal(texToSpeech("\\int_0^1 f(x) dx"), null);
	assert.equal(texToSpeech("\\weirdmacro{x}"), null);
});

/* ---------- chunking ---------- */

const words = (n: number, w = "word"): string =>
	Array.from({ length: n }, () => w).join(" ");

test("short sentences stay whole", () => {
	assert.deepEqual(splitSentence("A short sentence, with a comma."), [
		"A short sentence, with a comma.",
	]);
});

test("long sentences split at clauses, never losing words", () => {
	const sentence =
		"The model loads once per page, the voice is cached in the browser, the first chunk is kept short so audio starts quickly, and the rest follows in sentence groups that keep the prosody natural.";
	const pieces = splitSentence(sentence);
	assert.ok(pieces.length > 1, "split");
	for (const p of pieces)
		assert.ok(p.split(" ").length <= CHUNK.longSentenceWords * 1.6, p);
	assert.equal(pieces.join(" "), sentence);
	for (const p of pieces.slice(0, -1))
		assert.match(p, /[,;:]$/, "cut at clause punctuation");
});

test("tiny clauses are not left alone", () => {
	const sentence = `However, ${words(30)}, and ${words(4, "tail")}.`;
	const pieces = splitSentence(sentence);
	assert.ok(!pieces.includes("However,"));
	assert.equal(pieces.join(" "), sentence);
});

test("clause-free long sentences split at a conjunction", () => {
	const sentence = `${words(24, "alpha")} and ${words(24, "beta")}.`;
	const pieces = splitSentence(sentence);
	assert.equal(pieces.length, 2);
	assert.ok(pieces[1].startsWith("and beta"));
});

test("nothing exceeds the hard token cap", () => {
	const run = words(200);
	const pieces = splitSentence(run);
	for (const p of pieces)
		assert.ok(estimateTokens(p) <= CHUNK.hardCapTokens, `${p.length}`);
	assert.equal(pieces.join(" "), run);
});

test("the first unit is short for a fast start", () => {
	const first =
		"When I started this blog I did not expect to write about speech, but here we are, reading posts aloud in the browser with a small model.";
	const pieces = splitFirstSentence(first);
	assert.ok(pieces[0].length <= CHUNK.firstMaxChars, pieces[0]);
	assert.equal(pieces.join(" "), first);
	assert.deepEqual(splitFirstSentence("Short start."), ["Short start."]);
});

test("pause classes match the audio side's pause table names", () => {
	// Same contexts as pauseAfter() in pauses.ts: sentence, paragraph, heading, listItem.
	assert.equal(pauseClass("P", false), "sentence");
	assert.equal(pauseClass("P", true), "paragraph");
	assert.equal(pauseClass("H2", true), "heading");
	assert.equal(pauseClass("H3", false), "heading");
	assert.equal(pauseClass("LI", true), "listItem");
	assert.equal(pauseClass("LI", false), "sentence");
	assert.deepEqual(withPauses(["a,", "b."], "paragraph"), [
		{ text: "a,", pause: "clause" },
		{ text: "b.", pause: "paragraph" },
	]);
});

test("prosody groups: whole units, one block, at most 300 chars, first group single", () => {
	const block = {};
	const other = {};
	const sentence = (text: string, pause: "sentence" | "paragraph", b: object) => ({
		block: b,
		units: [{ text, pause }],
	});
	const s = (n: number): string => `${words(n, "talk")}.`;
	const sentences = [
		sentence(s(8), "sentence", block),
		sentence(s(10), "sentence", block),
		sentence(s(10), "sentence", block),
		sentence(s(10), "sentence", block),
		sentence(s(10), "paragraph", block),
		sentence(s(6), "paragraph", other),
	];
	const groups = prosodyGroups(sentences);
	assert.equal(groups[0].parts.length, 1, "first group is one unit");
	for (const g of groups) {
		assert.ok(g.text.length <= CHUNK.targetMaxChars, `${g.text.length}`);
		const blocks = new Set(g.parts.map((p) => sentences[p.sentenceIndex].block));
		assert.equal(blocks.size, 1, "never across a block");
		for (const p of g.parts)
			assert.equal(
				g.text.slice(p.start, p.end),
				sentences[p.sentenceIndex].units[p.unitIndex].text,
			);
	}
	assert.equal(groups.flatMap((g) => g.parts).length, sentences.length, "every unit once");
	assert.equal(groups[groups.length - 1].pause, "paragraph");
	assert.ok(groups.some((g) => g.parts.length > 1), "sentences are grouped");
});

/* ---------- legacy chunker (kept for parity with the Rust port) ---------- */

test("chunker keeps every piece within the budget and loses no words", () => {
	const long = Array.from(
		{ length: 60 },
		(_, i) => `clause number ${i}, with a word or two`,
	).join(" ");
	const pieces = chunkForBudget(long, CHUNK_BUDGET);
	assert.ok(pieces.length > 1);
	for (const piece of pieces)
		assert.ok(piece.length <= CHUNK_BUDGET, `piece of ${piece.length} chars`);
	assert.equal(
		pieces.join(" ").replace(/\s+/g, " "),
		long.replace(/\s+/g, " "),
	);
});

test("chunker splits an unbroken run at word boundaries", () => {
	const run = Array.from({ length: 200 }, () => "word").join(" ");
	const pieces = chunkForBudget(run, 100);
	assert.ok(pieces.every((p) => p.length <= 100));
	assert.equal(pieces.join(" "), run);
});

test("short text is one chunk", () => {
	assert.deepEqual(chunkForBudget("Short sentence."), ["Short sentence."]);
});

test("superscript label: GPU only when WebGPU is reported and exposed", () => {
	const nav = globalThis as { navigator?: unknown };
	const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	const setNavigator = (value: object): void => {
		Object.defineProperty(globalThis, "navigator", {
			value,
			configurable: true,
		});
	};
	try {
		setNavigator({ gpu: {} });
		assert.equal(accelerationLabel("webgpu"), "GPU");
		assert.equal(accelerationLabel("wasm"), "CPU");
		assert.equal(accelerationLabel("none"), "");
		setNavigator({});
		assert.equal(
			accelerationLabel("webgpu"),
			"CPU",
			"reported WebGPU without navigator.gpu is not GPU",
		);
	} finally {
		if (original) Object.defineProperty(globalThis, "navigator", original);
		else delete nav.navigator;
	}
});

test("pause table: sentence, paragraph, heading and list item", () => {
	assert.equal(pauseAfter({ tag: "P", endsBlock: false }), PAUSE_S.sentence);
	assert.equal(pauseAfter({ tag: "P", endsBlock: true }), PAUSE_S.paragraph);
	assert.equal(pauseAfter({ tag: "H2", endsBlock: true }), PAUSE_S.heading);
	assert.equal(pauseAfter({ tag: "H3", endsBlock: false }), PAUSE_S.heading);
	assert.equal(pauseAfter({ tag: "LI", endsBlock: true }), PAUSE_S.listItem);
	assert.equal(pauseAfter({ tag: "LI", endsBlock: false }), PAUSE_S.sentence);
});

test("pause table: clause boundary", () => {
	assert.equal(PAUSE_S.clause, 0.15);
});

test("pauses scale with the playback rate", () => {
	assert.equal(scaledPause(0.4, 1), 0.4);
	assert.equal(scaledPause(0.4, 2), 0.2);
	assert.equal(scaledPause(0.4, 0.5), 0.8);
});

// Pronunciation fixes (pronounce.ts, src/data/pronunciations.json): applied to the raw sentence, then normalised,
// exactly as extract.ts does it.
const LEXICON = lexiconMap(
	(
		JSON.parse(
			readFileSync(new URL("../src/data/pronunciations.json", import.meta.url), "utf8"),
		) as { entries: LexiconEntry[] }
	).entries,
);
const speak = (text: string, post: Record<string, string> = {}): string =>
	normalizeForSpeech(applyPronunciations(text, mergePronunciations(LEXICON, post)));

test("pronounce: the country US is spelled, the pronoun us is not", () => {
	assert.equal(speak("A US recession shows up."), "A U S recession shows up.");
	assert.equal(speak("Not all of it stays in the US."), "Not all of it stays in the U S.");
	assert.equal(speak("the U.S. economy"), "the U S economy");
	assert.equal(speak("Give it to us."), "Give it to us.");
	assert.equal(speak("Let us see what the US does."), "Let us see what the U S does.");
});

test("pronounce: Wikipedia is respelled, related words are not", () => {
	assert.equal(speak("I have been thinking about Wikipedia and AI."), "I have been thinking about wicky pedia and A I.");
	assert.equal(speak("Wikipedia's rules."), "wicky pedia's rules.");
	// Whole word and case-sensitive: the Kokoro lexicon already knows "Wikipedians"; lowercase is a URL fragment.
	assert.equal(speak("Wikipedians argue."), "Wikipedians argue.");
	assert.equal(applyPronunciations("en.wikipedia.org", LEXICON), "en.wikipedia.org");
});

test("pronounce: the post's map beats the global lexicon", () => {
	assert.equal(speak("Wikipedia", { Wikipedia: "wiki pedia" }), "wiki pedia");
	assert.equal(speak("Qwen runs.", { Qwen: "chwen" }), "chwen runs.");
	// An empty override is ignored, so a typo in front matter never silences a word.
	assert.equal(speak("Wikipedia", { Wikipedia: " " }), "wicky pedia");
	// Longest term first: a phrase entry wins over a word inside it.
	assert.equal(applyPronunciations("Open Tofu", { Open: "x", "Open Tofu": "open toe foo" }), "open toe foo");
});

test("pronounce: ordinary text is untouched", () => {
	const plain = [
		"The model ran on the GPU in nine seconds.",
		"Use your redistributable copy; it is fine.",
		"A wiki is a website people edit together.",
	];
	for (const t of plain) assert.equal(speak(t), normalizeForSpeech(t));
	assert.equal(applyPronunciations("anything", {}), "anything");
});

test("pronounce: lexicon spoken forms keep sentence and chunk boundaries", () => {
	// No sentence punctuation, digits or clause marks in a respelling: extract.ts splits sentences and chunk.ts
	// splits clauses on the written text's punctuation, and the highlight Range comes from the written text.
	for (const [term, say] of Object.entries(LEXICON)) {
		assert.match(say, /^[A-Za-z' -]+$/, `${term}: respelling "${say}" has punctuation or digits`);
		assert.equal(normalizeForSpeech(say), say, `${term}: the normaliser rewrites "${say}"`);
	}
	const sentence = "On Wikipedia a citation is a footnote, and SciPy uses Redis.";
	assert.equal(splitSentence(speak(sentence)).length, splitSentence(normalizeForSpeech(sentence)).length);
});
