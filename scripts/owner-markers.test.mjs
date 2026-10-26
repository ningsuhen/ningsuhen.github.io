// Owner markers: parser, the `manual` lock type, stripping, and data-src anchoring around markers.
// Run: pnpm test:markers
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import {
	isOpenMarker,
	parseOwnerMarkers,
	remarkOwnerMarkers,
	stripOwnerMarkers,
} from "../src/plugins/owner-markers.mjs";
import { remarkSourceMap } from "../src/plugins/remark-source-map.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Line numbers matter: the tests assert them.
const SRC = [
	"# Title",
	"",
	"<!-- owner:manual -->",
	"",
	"My own words.",
	"",
	"<!-- owner:question Why did you start this?",
	"draft: I wanted to see. -->",
	"",
	"Agent text.",
	"",
	"<!-- owner:manual edited 2026-10-26 -->",
	"",
	"## Kept heading",
	"",
].join("\n");

test("parses manual markers: no text, no draft, anchored to the next block", () => {
	const [manual, question, manual2] = parseOwnerMarkers(SRC);
	assert.deepEqual(manual, { type: "manual", text: "", line: 3, endLine: 3, anchorLine: 5 });
	assert.deepEqual(question, {
		type: "question",
		text: "Why did you start this?",
		draft: "I wanted to see.",
		line: 7,
		endLine: 8,
		anchorLine: 10,
	});
	assert.equal(manual2.type, "manual");
	assert.equal(manual2.text, "", "text after `manual` is ignored");
	assert.equal(manual2.anchorLine, 14);
});

test("manual markers are not open (not a to-do)", () => {
	const types = parseOwnerMarkers(SRC).filter(isOpenMarker).map((m) => m.type);
	assert.deepEqual(types, ["question"]);
});

test("a manual draft: line is not read as a draft", () => {
	const [m] = parseOwnerMarkers("<!-- owner:manual\ndraft: no -->\n\nText.\n");
	assert.equal(m.draft, undefined);
	assert.equal(m.text, "");
});

test("stripOwnerMarkers removes manual markers from the raw body", () => {
	const out = stripOwnerMarkers(SRC);
	assert.doesNotMatch(out, /owner:/);
	assert.match(out, /My own words\./);
});

test("remark drops manual markers and keeps data-src on the real source lines", async (t) => {
	mkdirSync(path.join(ROOT, ".tmp"), { recursive: true });
	const dir = mkdtempSync(path.join(ROOT, ".tmp", "owner-markers-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = path.join(dir, "index.md");
	writeFileSync(file, SRC);
	const md = await createMarkdownProcessor({
		syntaxHighlight: false,
		remarkPlugins: [remarkOwnerMarkers, [remarkSourceMap, { root: dir }]],
	});
	const { code, metadata } = await md.render(SRC, {
		fileURL: pathToFileURL(file),
		frontmatter: {},
	});
	assert.doesNotMatch(code, /owner:|&lt;!--/);
	assert.match(code, /<h1[^>]*data-src="1-1"/);
	assert.match(code, /<p data-src="5-5" data-src-kind="text">My own words\.<\/p>/);
	assert.match(code, /<p data-src="10-10" data-src-kind="text">Agent text\.<\/p>/);
	assert.match(code, /<h2[^>]*data-src="14-14"/);
	const { editSource } = metadata.frontmatter;
	assert.equal(editSource.markers, 1);
	assert.equal(editSource.manual, 2);
});
