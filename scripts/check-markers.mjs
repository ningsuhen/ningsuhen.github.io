// Owner markers (src/plugins/owner-markers.mjs) are hidden notes for the owner. This check fails if any
// marker text, or the marker syntax itself, reaches the built site (HTML, RSS, sitemap, Pagefind index),
// and lists the unresolved markers per post. Unresolved markers are a warning, not a failure, but a
// published post with markers still waits on the owner, so they also go to the CI job summary.
// Run after a build: pnpm check:markers
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseOwnerMarkers } from "../src/plugins/owner-markers.mjs";

const ROOT = path.resolve(".");
const POSTS = path.join(ROOT, "src/content/posts");
const DIST = path.join(ROOT, "dist");
const TEXT_EXT = /\.(html?|xml|json|js|mjs|txt|css|svg|webmanifest)$/i;

/** Lowercase, entities decoded, tags and punctuation spacing flattened: survives HTML/XML escaping. */
const norm = (s) =>
	s
		.replace(/<[^>]+>/g, " ")
		.replace(/&(?:#0*39|#x0*27|apos|rsquo|lsquo);/gi, "'")
		.replace(/&(?:quot|#0*34|#x0*22|ldquo|rdquo);/gi, '"')
		.replace(/&lt;|&#0*60;/gi, "<")
		.replace(/&gt;|&#0*62;/gi, ">")
		.replace(/&amp;/gi, "&")
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/\s+/g, " ")
		.toLowerCase();

/** Every file under dir (fd-style walk, no ignore files). */
function walk(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		return e.isDirectory() ? walk(p) : [p];
	});
}

/** Text of a built file; Pagefind fragments and indexes are gzip. */
function textOf(file) {
	const buf = readFileSync(file);
	if (buf[0] === 0x1f && buf[1] === 0x8b) {
		try {
			return gunzipSync(buf).toString("utf8");
		} catch {
			return "";
		}
	}
	return TEXT_EXT.test(file) ? buf.toString("utf8") : "";
}

/** Marker texts (and drafts) found in a text, plus raw marker syntax. */
export function leaksIn(text, needles) {
	const t = norm(text);
	const hits = needles.filter((n) => t.includes(n));
	if (/<!--\s*owner:/.test(t)) hits.push("<!-- owner: (marker syntax)");
	return hits;
}

// Self-test: the matcher must catch an escaped marker, as markdown-it would render it into RSS.
const canary = "Why did you build the simulation?";
if (
	leaksIn("<p>&lt;!-- owner:question Why did you build the simulation? --&gt;</p>", [norm(canary)])
		.length !== 2 ||
	leaksIn("<p>Why did you <em>build</em> the simulation?</p>", [norm(canary)]).length !== 1 ||
	leaksIn("<p>Something else.</p>", [norm(canary)]).length !== 0
) {
	console.error("check:markers: self-test failed");
	process.exit(1);
}

const posts = readdirSync(POSTS)
	.map((slug) => ({ slug, file: path.join(POSTS, slug, "index.md") }))
	.filter((p) => existsSync(p.file))
	.map((p) => {
		const src = readFileSync(p.file, "utf8");
		return {
			...p,
			draft: /^draft:\s*true\s*$/m.test(src.split(/^---$/m)[1] ?? ""),
			markers: parseOwnerMarkers(src),
			malformed: (src.match(/<!--\s*owner:[\s\S]*?-->/g) ?? []).length,
		};
	});

let failed = 0;
for (const p of posts) {
	if (p.malformed !== p.markers.length) {
		failed++;
		console.error(
			`check:markers: ${p.slug}: ${p.malformed - p.markers.length} marker(s) with an unknown type (use question, confirm, scene, voice or fact)`,
		);
	}
	for (const m of p.markers)
		if (!m.anchorLine) {
			failed++;
			console.error(`check:markers: ${p.slug}:${m.line}: marker has no block after it to anchor to`);
		}
}

// Texts shorter than 12 characters would match ordinary prose; markers are longer in practice.
const needles = [
	...new Set(
		posts
			.flatMap((p) => p.markers.flatMap((m) => [m.text, m.draft ?? ""]))
			.map(norm)
			.map((s) => s.trim())
			.filter((s) => s.length >= 12),
	),
];

if (!existsSync(DIST)) {
	console.error("check:markers: no dist/; run pnpm build first");
	process.exit(1);
}
let scanned = 0;
for (const file of walk(DIST)) {
	const text = textOf(file);
	if (!text) continue;
	scanned++;
	for (const hit of leaksIn(text, needles)) {
		failed++;
		console.error(`check:markers: LEAK ${path.relative(ROOT, file)}: ${hit.slice(0, 60)}`);
	}
}

const open = posts.filter((p) => p.markers.length);
const total = open.reduce((n, p) => n + p.markers.length, 0);
const lines = open.map((p) => {
	const byType = Object.entries(
		p.markers.reduce((a, m) => ({ ...a, [m.type]: (a[m.type] ?? 0) + 1 }), {}),
	)
		.map(([t, n]) => `${n} ${t}`)
		.join(", ");
	return `${p.slug}${p.draft ? " (draft)" : ""}: ${p.markers.length} (${byType})`;
});
if (open.length) {
	console.warn(`check:markers: ${total} unresolved owner marker(s), waiting on the owner:`);
	for (const l of lines) console.warn(`  ${l}`);
}
if (process.env.GITHUB_STEP_SUMMARY && open.length) {
	appendFileSync(
		process.env.GITHUB_STEP_SUMMARY,
		`### Owner markers: ${total} unresolved\n\nPublished first-person posts below wait on the owner (answer in edit mode).\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`,
	);
}
if (failed) process.exit(1);
console.log(`check:markers: ok (${scanned} built files, no marker text in dist)`);
