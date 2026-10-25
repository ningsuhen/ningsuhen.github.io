// Unit tests for the Listen player's speech normaliser and chunker. Run: pnpm test:tts
// Sentences come from the three newest posts and the scientific-text probe set.
import assert from "node:assert/strict";
import { test } from "node:test";
import { accelerationLabel } from "../src/scripts/tts/engine.ts";
import { PAUSE_S, pauseAfter, scaledPause } from "../src/scripts/tts/pauses.ts";
import {
	CHUNK_BUDGET,
	chunkForBudget,
	normalizeForSpeech,
} from "../src/scripts/tts/normalize.ts";

const CASES: ReadonlyArray<readonly [string, string]> = [
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
		"Results are in Figure three, as shown in.",
	],
	[
		"Let α be the learning rate and β the momentum.",
		"Let alpha be the learning rate and beta the momentum.",
	],
	[
		"The estimator is Ŷ = Xβ + ε, where ε ~ N(0, σ²).",
		"The estimator is Y = X beta + epsilon, where epsilon distributed as N(zero, sigma squared).",
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
		"Between nineteen seventy-one to twenty nineteen the curve inverted fourteen times.",
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

for (const [input, expected] of CASES) {
	test(`normalizes: ${input}`, () => {
		assert.equal(normalizeForSpeech(input), expected);
	});
}

test("never leaves digits or stray markup in speech text", () => {
	for (const [input] of CASES) {
		assert.doesNotMatch(normalizeForSpeech(input), /\d|\*|`/, input);
	}
});

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
