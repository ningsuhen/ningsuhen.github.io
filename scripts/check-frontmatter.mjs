// check:frontmatter — every post's front matter must be complete and valid, with one clear, actionable
// message per problem. Catches a raw post (e.g. one created by the in-place editor) that has an empty
// title, no description, no tags, a missing/invalid category, a bad date, or — when published — no
// thumbnail, before the heavier checks run. It never edits a post.
//
//   node scripts/check-frontmatter.mjs
//
// Checks, per post:
//   - title:        present and non-empty.
//   - description:  present, non-empty, and a real sentence (not a bare fragment).
//   - tags:         a non-empty list.
//   - category:     present and in the current set (the categories in use across the posts).
//   - published:    a valid YYYY-MM-DD calendar date.
//   - thumbnail:    present and conforming (800x800, < 60 KB) whenever draft is not true.
//
// Dependency-free for the front matter (node built-ins); sharp is used only for the thumbnail size check,
// the same way check:thumbnails does.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(".");
const POSTS = path.join(ROOT, "src/content/posts");
const SIDE = 800;
const MAX_BYTES = 60 * 1024;
const MIN_DESC = 15; // a "real" description is more than a fragment

// ---- front matter (same simple parsing as check:thumbnails) ------------------------------------------
const frontmatter = (file) => readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
const field = (fm, key) =>
	(fm.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"))?.[1] ?? "").replace(/^["']|["']$/g, "");
// A flow list: `tags: [a, b, c]` -> ["a","b"]; `tags: []` -> [].
const listField = (fm, key) => {
	const raw = field(fm, key);
	if (!raw || raw === "[]") return [];
	return raw
		.replace(/^\[|\]$/g, "")
		.split(",")
		.map((s) => s.trim().replace(/^["']|["']$/g, ""))
		.filter(Boolean);
};

// ---- per-post checks ----------------------------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value) {
	if (!DATE_RE.test(value)) return false;
	const d = new Date(value + "T00:00:00Z");
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

async function thumbnailProblems(label, slug, rel) {
	const file = rel.startsWith("/") ? path.join(ROOT, "public", rel) : path.resolve(POSTS, slug, rel);
	if (!existsSync(file)) return [`${label}: thumbnail file not found (${rel})`];
	const out = [];
	try {
		const { width = 0, height = 0 } = await sharp(file).metadata();
		if (width !== SIDE || height !== SIDE) out.push(`${label}: thumbnail ${width}x${height} must be ${SIDE}x${SIDE}`);
	} catch {
		out.push(`${label}: thumbnail is not a readable image (${rel})`);
	}
	if (statSync(file).size >= MAX_BYTES)
		out.push(`${label}: thumbnail ${(statSync(file).size / 1024).toFixed(1)} KB must be < 60 KB`);
	return out;
}

// ---- run ----------------------------------------------------------------------------------------------
const slugs = readdirSync(POSTS, { withFileTypes: true })
	.filter((e) => e.isDirectory())
	.map((e) => e.name);

// The current set of categories: every category in use across the posts. A new post must reuse one.
const categories = new Set();
for (const slug of slugs) {
	const c = field(frontmatter(path.join(POSTS, slug, "index.md")), "category");
	if (c) categories.add(c);
}

const failures = [];
for (const slug of slugs) {
	const file = path.join(POSTS, slug, "index.md");
	const fm = frontmatter(file);
	const label = `src/content/posts/${slug}`;
	const problems = [];

	const title = field(fm, "title");
	if (!title) problems.push("missing or empty `title`");

	const description = field(fm, "description");
	if (!description) problems.push("missing `description` (add a one-sentence summary)");
	else if (description.length < MIN_DESC)
		problems.push(`description is too short to be a real sentence ("${description}")`);

	if (listField(fm, "tags").length === 0) problems.push("empty `tags` (add at least one)");

	const category = field(fm, "category");
	if (!category) problems.push("missing `category`");
	else if (categories.size && !categories.has(category))
		problems.push(`category "${category}" is not in the current set (${[...categories].join(", ")})`);

	const published = field(fm, "published");
	if (!published) problems.push("missing `published` date");
	else if (!validDate(published)) problems.push(`invalid \`published\` date ("${published}", want YYYY-MM-DD)`);

	if (field(fm, "draft") !== "true") {
		const thumb = field(fm, "thumbnail");
		if (!thumb) problems.push("published post has no `thumbnail` (add a square 800x800 thumb.webp)");
		else problems.push(...(await thumbnailProblems(label, slug, thumb)));
	}

	if (problems.length) failures.push(`${label}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
}

console.log(`check:frontmatter: ${slugs.length} post(s) scanned`);
if (failures.length) {
	console.error(`\ncheck:frontmatter: ${failures.length} post(s) need fixing:\n`);
	for (const f of failures) console.error(f + "\n");
	process.exit(1);
}
console.log("check:frontmatter: ok");
