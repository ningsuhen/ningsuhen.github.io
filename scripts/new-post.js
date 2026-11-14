// Scaffold a plain blog post (not a report, demo or idea: those are `pnpm new-research`, `new-playground`, `new-idea`).
// Usage: pnpm new-post <slug> ["<Title>"]
// Writes src/content/posts/<slug>/index.mdx as a draft whose front matter passes check:frontmatter; fill in the TODOs,
// pick the category and tags, add the thumbnail, then set draft: false.
import fs from "node:fs";
import path from "node:path";
import { POST_SOURCES } from "./lib/posts.mjs";

const [arg, title] = process.argv.slice(2);
const slug = arg?.replace(/\/?(index)?\.mdx?$/i, "");
if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
	console.error('Usage: pnpm new-post <slug> ["<Title>"]   (slug: lowercase letters, digits, hyphens)');
	process.exit(1);
}

const dir = path.join("src/content/posts", slug);
if (fs.existsSync(dir)) {
	console.error(`Refusing to overwrite: ${dir} already exists.`);
	process.exit(1);
}
const file = path.join(dir, POST_SOURCES[0]); // new posts are MDX
const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
	file,
	`---
title: ${JSON.stringify(title ?? slug)}
published: ${today}
description: "TODO: one sentence on what this post is about."
tags: [TODO]
category: Thoughts
draft: true
---

TODO: write this in your own voice.

Remember: escape every literal dollar sign as \\$ or the math renderer mangles the line. This is MDX: escape a literal \`{\` or \`<\` in prose as \`\\{\` or \`\\<\`, and write comments (owner markers too) as HTML comments.
`,
);
console.log(`Created ${file} (draft: true). Category must be one of the list in .pages.yml; add thumb.webp before publishing.`);
