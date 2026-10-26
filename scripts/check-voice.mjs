// check:voice — scan every post for the AI-voice tells the owner's rules ban (CLAUDE.md "Blog Posts"):
// the filler list (delve, landscape, crucial, "worth noting", "not just X but Y"), em-dash chains,
// closing-sermon phrases, emoji in prose, over-long paragraphs and dictation artefacts (um/uh, "like like").
//
//   node scripts/check-voice.mjs
//
// Warn-only by default: it prints per-post counts and writes them to the CI job summary, so the owner can
// see where a post drifts. It FAILS hard on the two things that are never right: emoji in prose, and a
// single paragraph over 300 words (that catches a raw transcript). A post opts out with a `voice-allow:`
// front-matter key that carries a reason (an empty value is rejected). It never rewrites a post.
//
// Dependency-free (node built-ins only) so it runs in the `static` leg.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseOwnerMarkers } from "../src/plugins/owner-markers.mjs";

const ROOT = path.resolve(".");
const POSTS = path.join(ROOT, "src/content/posts");

// Banned filler, from the owner-voice rules. Matched with \b<stem>\w* to catch inflections (delve/delving,
// landscape/landscapes, crucial/crucially).
const FILLER_STEMS = ["delve", "landscape", "crucial"];
const FILLER_PHRASES = ["worth noting"];
// Closing-sermon phrases: the "and so it goes" wrap-up the rules say to drop.
const SERMON_PHRASES = [
	"in conclusion",
	"to sum up",
	"in summary",
	"at the end of the day",
	"the bottom line",
	"it's worth remembering",
	"remember that",
	"in the end",
];
// Emoji in prose (the rules ban emoji; the sprite uses Lucide, not glyph arrows).
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
// Dictation artefacts: a raw transcript leaves these behind.
const DICTATION = [
	{ re: /\b(um|uh)\b/gi, label: "um/uh" },
	{ re: /\blike like\b/gi, label: "'like like'" },
];

const PARA_WARN = 120; // over this many words in one paragraph: warn
const PARA_FAIL = 300; // over this: fail (a raw transcript)
const EM_DASH_WARN = 3; // this many em-dashes in one paragraph: a "chain"

// ---- text prep -------------------------------------------------------------------------------------
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n?/;
function stripFrontMatter(src) {
	return src.replace(FRONT_MATTER, "");
}
// Owner markers (<!-- owner:<type> … -->) are hidden notes, not prose. Every marker comment is dropped; for
// `owner:manual` the block directly under it — the owner's own hand-written words, kept verbatim — is dropped
// too, so it is never flagged. Reuses the plugin's parser (line/anchorLine are 1-based source lines); the
// `manual` type lands in #220, so this is a no-op for it until the branch is rebased onto that master.
function stripOwnerBlocks(src) {
	const lines = src.split("\n");
	const skip = new Set();
	for (const m of parseOwnerMarkers(src)) {
		for (let n = m.line; n <= m.endLine; n++) skip.add(n); // the marker comment
		if (m.type === "manual" && m.anchorLine) {
			// The whole block under the marker: from its first line to the next blank line.
			for (let n = m.anchorLine; n <= lines.length && lines[n - 1].trim() !== ""; n++) skip.add(n);
		}
	}
	return lines.filter((_, i) => !skip.has(i + 1)).join("\n");
}
// Code (fenced blocks and inline spans) is not prose — drop it so its content can't trip a rule.
function stripCode(src) {
	return src.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");
}
// A Markdown table or list is not a prose paragraph: its cells/items would otherwise read as one giant
// paragraph and trip the length rule (which exists to catch a run-on transcript). A table is detected by its
// `|---|` separator row; a list by a leading `1.`/`-`/`*` on most of its lines.
function isStructured(block) {
	const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
	if (!lines.length) return false;
	const table = lines.some((l) => /^\|?[\s:|-]+\|?$/.test(l) && l.includes("-"));
	const list = lines.filter((l) => /^(?:\d+\.|[-*])\s/.test(l)).length / lines.length >= 0.5;
	return table || list;
}
// A post opts out with `voice-allow: <reason>`; the reason is required (an empty value is rejected).
function voiceAllow(src) {
	const m = src.match(FRONT_MATTER);
	if (!m) return null;
	const a = m[0].match(/^voice-allow:\s*(.*)$/m);
	if (!a) return null;
	const reason = a[1].trim().replace(/^["']|["']$/g, "");
	return reason || null;
}

// ---- per-paragraph analysis ------------------------------------------------------------------------
function analyze(src) {
	// Strip front matter, owner markers (and the verbatim block under an `owner:manual`), then code.
	const body = stripCode(stripOwnerBlocks(stripFrontMatter(src)));
	const blocks = body
		.split(/\n{2,}/)
		.map((b) => b.trim())
		.filter(Boolean);
	const f = {
		filler: new Map(),
		sermon: new Map(),
		notJustBut: 0,
		emDashParas: 0,
		emoji: 0,
		dictation: new Map(),
		longWarn: 0,
		longFail: 0,
		maxPara: 0,
	};
	for (const b of blocks) {
		const lower = b.toLowerCase();
		for (const stem of FILLER_STEMS) {
			const n = (b.match(new RegExp(`\\b${stem}\\w*`, "gi")) ?? []).length;
			if (n) f.filler.set(stem, (f.filler.get(stem) ?? 0) + n);
		}
		for (const p of FILLER_PHRASES)
			if (lower.includes(p)) f.filler.set(p, (f.filler.get(p) ?? 0) + 1);
		for (const p of SERMON_PHRASES)
			if (lower.includes(p)) f.sermon.set(p, (f.sermon.get(p) ?? 0) + 1);
		if (/not just [^.!?\n]* but /i.test(b)) f.notJustBut++;
		const dashes = (b.match(/—/g) ?? []).length;
		if (dashes >= EM_DASH_WARN) f.emDashParas++;
		f.emoji += (b.match(EMOJI_RE) ?? []).length;
		for (const d of DICTATION) {
			const n = (b.match(d.re) ?? []).length;
			if (n) f.dictation.set(d.label, (f.dictation.get(d.label) ?? 0) + n);
		}
		// Length rule is prose-only: a table's cells or a list's items are not one paragraph.
		if (!isStructured(b)) {
			const wc = b.split(/\s+/).filter(Boolean).length;
			f.maxPara = Math.max(f.maxPara, wc);
			if (wc > PARA_FAIL) f.longFail++;
			else if (wc > PARA_WARN) f.longWarn++;
		}
	}
	return f;
}

const count = (m) => [...m.entries()].map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ""}`).join(", ");

// ---- run -------------------------------------------------------------------------------------------
const posts = readdirSync(POSTS)
	.map((slug) => ({ slug, file: path.join(POSTS, slug, "index.md") }))
	.filter((p) => existsSync(p.file))
	.map((p) => {
		const src = readFileSync(p.file, "utf8");
		const allow = voiceAllow(src);
		return { slug: p.slug, allow, findings: allow ? null : analyze(src) };
	});

let failed = 0;
const summary = [];
for (const p of posts) {
	if (p.allow) {
		summary.push(`- ${p.slug}: _opted out (${p.allow})_`);
		continue;
	}
	const f = p.findings;
	const bits = [];
	if (f.filler.size) bits.push(`filler: ${count(f.filler)}`);
	if (f.sermon.size) bits.push(`sermon: ${count(f.sermon)}`);
	if (f.notJustBut) bits.push(`"not just…but" ×${f.notJustBut}`);
	if (f.emDashParas) bits.push(`em-dash chain ×${f.emDashParas}`);
	if (f.emoji) bits.push(`emoji ×${f.emoji}`);
	if (f.dictation.size) bits.push(`dictation: ${count(f.dictation)}`);
	if (f.longWarn) bits.push(`long paragraph (>${PARA_WARN}w) ×${f.longWarn}`);
	if (f.longFail) bits.push(`**transcript paragraph (>${PARA_FAIL}w) ×${f.longFail}**`);
	const clean = bits.length === 0;
	summary.push(`- ${p.slug}: ${clean ? "_clean_" : bits.join("; ")}`);
	// Hard failures: emoji in prose, or a paragraph over PARA_FAIL words.
	if (f.emoji) {
		failed++;
		console.error(`check:voice: ${p.slug}: ${f.emoji} emoji in prose`);
	}
	if (f.longFail) {
		failed++;
		console.error(`check:voice: ${p.slug}: ${f.longFail} paragraph(s) over ${PARA_FAIL} words (max ${f.maxPara})`);
	}
}

console.log(`check:voice: ${posts.length} post(s) scanned`);
for (const l of summary) console.log(`  ${l}`);

if (process.env.GITHUB_STEP_SUMMARY) {
	const dirty = summary.filter((l) => !l.includes("_clean_") && !l.includes("opted out"));
	appendFileSync(
		process.env.GITHUB_STEP_SUMMARY,
		`### Voice check\n\n${dirty.length ? dirty.join("\n") : "_All posts clean._"}\n\n` +
			`(warn-only; fails on emoji in prose or a paragraph over ${PARA_FAIL} words. Opt out with \`voice-allow: <reason>\`.)\n`,
	);
}

if (failed) {
	console.error(`check:voice: FAILED (${failed} post(s) with a hard failure)`);
	process.exit(1);
}
console.log("check:voice: ok (no hard failures)");
