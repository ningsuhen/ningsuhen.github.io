// Checks card thumbnails: every post `thumbnail:` and the site default must be a near-square,
// full-size, small image so it reads as ONE focal element in a square card.  Run: pnpm check:thumbnails
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(".");
const POSTS = path.join(ROOT, "src/content/posts");
const DEFAULT_THUMB = path.join(ROOT, "public/images/default-thumbnail.webp");
const MIN_ASPECT = 0.85;
const MAX_ASPECT = 1.18;
const MIN_WIDTH = 400;
const MAX_BYTES = 120 * 1024;

/** Returns the raw `thumbnail:` value from a markdown file's frontmatter, or "". */
function frontmatterThumbnail(file) {
	const [, fm = ""] = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/) ?? [];
	const value = fm.match(/^thumbnail:\s*(.+?)\s*$/m)?.[1] ?? "";
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
	const aspect = width / height;
	const out = [];
	if (!(aspect >= MIN_ASPECT && aspect <= MAX_ASPECT)) {
		out.push(`${label}: aspect ${aspect.toFixed(2)} (${width}x${height}) must be between ${MIN_ASPECT} and ${MAX_ASPECT}; a wide chart is cropped mid-panel on cards`);
	}
	if (width < MIN_WIDTH) out.push(`${label}: width ${width}px must be >= ${MIN_WIDTH}`);
	if (stat.size >= MAX_BYTES) out.push(`${label}: ${(stat.size / 1024).toFixed(1)} KB must be < 120 KB`);
	return out;
}

const failures = [];
let checked = 0;
for (const slug of readdirSync(POSTS, { withFileTypes: true }).filter((e) => e.isDirectory())) {
	const index = path.join(POSTS, slug.name, "index.md");
	let thumb = "";
	try {
		thumb = frontmatterThumbnail(index);
	} catch {
		continue;
	}
	if (!thumb) continue;
	const file = thumb.startsWith("/") ? path.join(ROOT, "public", thumb) : path.resolve(POSTS, slug.name, thumb);
	checked++;
	failures.push(...(await problems(`src/content/posts/${slug.name}`, file)));
}
failures.push(...(await problems("public/images/default-thumbnail.webp", DEFAULT_THUMB)));

if (failures.length > 0) {
	console.error(`Thumbnail check failed (${failures.length}):\n- ${failures.join("\n- ")}`);
	process.exit(1);
}
console.log(`Thumbnail check passed: ${checked} post thumbnail(s) + default.`);
