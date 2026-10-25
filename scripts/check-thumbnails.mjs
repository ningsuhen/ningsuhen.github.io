// Enforces card thumbnails. Every published post (draft: false) must set `thumbnail:` to a square
// 800x800 image under 60 KB that shows ONE focal element; the site default must meet the same size rules.
// Run: pnpm check:thumbnails
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(".");
const POSTS = path.join(ROOT, "src/content/posts");
const DEFAULT_THUMB = path.join(ROOT, "public/images/default-thumbnail.webp");
const SIDE = 800;
const MAX_BYTES = 60 * 1024;

/** Returns the frontmatter block of a markdown file, or "". */
function frontmatter(file) {
	return readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
}

/** Returns one frontmatter field's raw value, without quotes, or "". */
function field(fm, key) {
	const value = fm.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"))?.[1] ?? "";
	return value.replace(/^["']|["']$/g, "");
}

/** Lists every problem with one thumbnail file; empty when it passes. */
async function problems(label, file) {
	let stat;
	try {
		stat = statSync(file);
	} catch {
		return [`${label}: file not found (${file})`];
	}
	const { width = 0, height = 0 } = await sharp(file).metadata();
	const out = [];
	if (width !== SIDE || height !== SIDE) out.push(`${label}: ${width}x${height} must be ${SIDE}x${SIDE}`);
	if (stat.size >= MAX_BYTES) out.push(`${label}: ${(stat.size / 1024).toFixed(1)} KB must be < 60 KB`);
	return out;
}

const failures = [];
let checked = 0;
for (const slug of readdirSync(POSTS, { withFileTypes: true }).filter((e) => e.isDirectory())) {
	const index = path.join(POSTS, slug.name, "index.md");
	let fm = "";
	try {
		fm = frontmatter(index);
	} catch {
		continue;
	}
	const label = `src/content/posts/${slug.name}`;
	const thumb = field(fm, "thumbnail");
	if (!thumb) {
		if (field(fm, "draft") !== "true") {
			failures.push(`${label}: no \`thumbnail\` in frontmatter; add a square ${SIDE}x${SIDE} thumb.webp (generate one from the post if it has no suitable image)`);
		}
		continue;
	}
	const file = thumb.startsWith("/") ? path.join(ROOT, "public", thumb) : path.resolve(POSTS, slug.name, thumb);
	checked++;
	failures.push(...(await problems(label, file)));
}
failures.push(...(await problems("public/images/default-thumbnail.webp", DEFAULT_THUMB)));

if (failures.length > 0) {
	console.error(`Thumbnail check failed (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log(`Thumbnail check passed: ${checked} post thumbnail(s) + default.`);
