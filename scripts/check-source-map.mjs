// Checks the in-place editor contract on the built site (src/plugins/remark-source-map.mjs): every post
// page names its source file in <meta name="edit-source"> with the file's current git blob SHA, and every
// data-src line range points at the block that rendered it. A broken map would splice edits into the
// wrong lines, so CI fails instead.
// Run after a build: pnpm check:source-map
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".");
const PAGES = path.join(ROOT, "dist/posts");
// What the first source line of a block must look like, by rendered tag.
const STARTS = {
	h: /^#{1,6}\s/,
	ul: /^\s*[-*+]\s/,
	ol: /^\s*\d+[.)]\s/,
	blockquote: /^\s*>/,
	table: /^\s*\|/,
};

const unescape = (s) =>
	s
		.replace(/&quot;/g, '"')
		.replace(/&#34;/g, '"')
		.replace(/&amp;/g, "&");

function problems(page) {
	const html = readFileSync(page, "utf8");
	const meta = html.match(/<meta name="edit-source" content="([^"]*)"/);
	if (!meta) return ['no <meta name="edit-source">'];
	let src;
	try {
		src = JSON.parse(unescape(meta[1]));
	} catch {
		return ["edit-source is not JSON"];
	}
	const file = path.join(ROOT, src.path ?? "");
	if (path.isAbsolute(src.path ?? "/") || !existsSync(file))
		return [`source ${src.path} does not exist`];
	const raw = readFileSync(file);
	const blob = createHash("sha1")
		.update(`blob ${raw.length}\0`)
		.update(raw)
		.digest("hex");
	const out = [];
	if (src.blob !== blob)
		out.push(`blob ${src.blob} is not ${src.path}'s (${blob})`);
	const lines = raw.toString("utf8").split("\n");
	let blocks = 0;
	for (const m of html.matchAll(
		/<(\w+)[^>]*?data-src="(\d+)-(\d+)" data-src-kind="(text|raw)"/g,
	)) {
		blocks++;
		const [tag, a, b] = [m[1], Number(m[2]), Number(m[3])];
		const where = `<${tag} data-src="${a}-${b}">`;
		if (a < 1 || b < a || b > lines.length) {
			out.push(`${where} is outside the file (${lines.length} lines)`);
			continue;
		}
		if (!lines[a - 1].trim() || !lines[b - 1].trim())
			out.push(`${where} starts or ends on a blank line`);
		const start = STARTS[/^h[1-6]$/.test(tag) ? "h" : tag];
		if (start && !start.test(lines[a - 1]))
			out.push(
				`${where} does not start a ${tag}: ${lines[a - 1].slice(0, 60)}`,
			);
	}
	if (!blocks) out.push("no data-src blocks");
	return out;
}

if (!existsSync(PAGES)) {
	console.error("check:source-map: no dist/posts; run pnpm build first");
	process.exit(1);
}
let failed = 0;
for (const slug of readdirSync(PAGES)) {
	const page = path.join(PAGES, slug, "index.html");
	if (!existsSync(page)) continue;
	for (const p of problems(page)) {
		failed++;
		console.error(`check:source-map: /posts/${slug}/: ${p}`);
	}
}
if (failed) process.exit(1);
console.log("check:source-map: ok");
