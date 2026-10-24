// Scaffold a new experiment: standalone page from the template, a draft post, and an Experiments entry.
// Usage: pnpm new-experiment <slug> "<Title>" ["<one-sentence summary>"]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [slug, title, summary = "TODO: one sentence on what this experiment asks."] = process.argv.slice(2);
if (!slug || !title || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
	console.error('Usage: pnpm new-experiment <slug> "<Title>" ["<summary>"]   (slug: lowercase letters, digits, hyphens)');
	process.exit(1);
}
const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
const page = path.join("public", slug, "index.html");
const postDir = path.join("src/content/posts", slug);
if (existsSync(page) || existsSync(postDir)) {
	console.error(`Refusing to overwrite: ${existsSync(page) ? page : postDir} already exists.`);
	process.exit(1);
}

const fill = (s) => s.replaceAll("{{TITLE}}", title).replaceAll("{{DATE}}", today).replaceAll("{{SUMMARY}}", summary).replaceAll("{{SLUG}}", slug);
mkdirSync(path.dirname(page), { recursive: true });
writeFileSync(page, fill(readFileSync("public/design-system/template.html", "utf8")));

mkdirSync(postDir, { recursive: true });
writeFileSync(
	path.join(postDir, "index.md"),
	`---
title: ${JSON.stringify(title)}
published: ${today}
description: ${JSON.stringify(summary)}
tags: [Experiment]
category: Research
draft: true
---

TODO: write this in your own voice. Lead with what you saw, quote only numbers that are on the page, and end with "what I don't trust yet".

Remember: escape every literal dollar sign as \\$ or the math renderer mangles the line.

[Open the report](/${slug}/)
`,
);

const jsonPath = "src/data/experiments.json";
const data = JSON.parse(readFileSync(jsonPath, "utf8"));
data.items.unshift({ title, summary, href: `/${slug}/`, post: `/posts/${slug}/`, started: today, updated: today, status: "Draft", tags: ["Experiment"] });
writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);

console.log(`Created:
  ${page}                     (navbar + license are injected at build time)
  ${path.join(postDir, "index.md")}   (draft: true)
  ${jsonPath}                 (status "Draft": hidden from /experiments/ until you set it to "Live")
Next: pnpm dev -> http://127.0.0.1:4321/${slug}/ (live reload); before the PR: pnpm build && pnpm check:standalone`);
