// check:voice — the `owner:manual` skip and a couple of the core rules, on real markers.
// Run: pnpm test:voice
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, stripOwnerBlocks } from "./check-voice.mjs";

// A real `owner:manual` marker above a block that would otherwise trip the rules (emoji + a banned
// filler). The owner's verbatim block must be dropped, so nothing is flagged.
const MANUAL = [
	"---",
	"title: Manual block",
	"---",
	"",
	"An intro paragraph that is fine.",
	"",
	"<!-- owner:manual -->",
	"",
	"The owner wrote this by hand 🚀 and it is not just a demo but a real tool.",
	"",
	"Another real paragraph after it.",
].join("\n");

test("owner:manual drops the verbatim block under it (never flagged)", () => {
	const f = analyze(MANUAL);
	assert.equal(f.emoji, 0, "emoji in the manual block must not be counted");
	assert.equal(f.notJustBut, 0, "'not just…but' in the manual block must not be counted");
	assert.equal(f.filler.size, 0, "no filler from the manual block");
});

test("owner:manual drops only the block under it; surrounding prose is still analysed", () => {
	// Put a banned filler in the paragraph AFTER the manual block — it must still be flagged.
	const src = [
		"<!-- owner:manual -->",
		"",
		"Owner verbatim: clean words, no tells.",
		"",
		"This paragraph delves into the landscape of things.",
	].join("\n");
	const f = analyze(src);
	assert.equal(f.filler.get("delves") ?? f.filler.get("delve"), 1, "filler after the manual block is flagged");
	assert.ok(f.filler.has("landscape"), "filler after the manual block is flagged");
});

test("a non-manual owner marker drops the note but keeps the block under it", () => {
	// A `question` marker is a hidden note: the marker is dropped, but the block under it is real prose.
	const src = [
		"<!-- owner:question Why this? -->",
		"",
		"This real prose delves into it.",
	].join("\n");
	const f = analyze(src);
	assert.equal(f.filler.get("delve"), 1, "prose under a non-manual marker is still analysed");
});

test("stripOwnerBlocks removes the manual marker and its verbatim block", () => {
	const out = stripOwnerBlocks(MANUAL);
	assert.ok(!out.includes("owner:manual"), "the marker comment is gone");
	assert.ok(!out.includes("not just a demo"), "the verbatim block is gone");
	assert.ok(out.includes("An intro paragraph"), "the intro is kept");
	assert.ok(out.includes("Another real paragraph"), "the following paragraph is kept");
});

test("a paragraph over 300 words is a hard failure; under 120 is clean", () => {
	const long = "word ".repeat(301).trim();
	assert.equal(analyze(long).longFail, 1, ">300 words fails");
	assert.equal(analyze("A short, clean sentence.").longWarn, 0, "short paragraph is clean");
});
