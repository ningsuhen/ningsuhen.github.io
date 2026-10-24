// Scaffold a standalone page from the template, a draft post, and a Draft entry.
// Without --research: an Experiments entry (src/data/experiments.json, tag Experiment).
// With --research: a Research entry (src/data/research.json, tag Research).
// Usage: pnpm new-experiment [--research] <slug> "<Title>" ["<one-sentence summary>"]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const research = args.includes("--research");
const [slug, title, summary = "TODO: one sentence on what this is about."] = args.filter((a) => a !== "--research");
if (!slug || !title || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
	console.error('Usage: pnpm new-experiment [--research] <slug> "<Title>" ["<summary>"]   (slug: lowercase letters, digits, hyphens)');
	process.exit(1);
}
const tag = research ? "Research" : "Experiment";
const jsonPath = research ? "src/data/research.json" : "src/data/experiments.json";
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
tags: [${tag}]
category: Research
draft: true
---

TODO: write this in your own voice. Lead with what you saw, quote only numbers that are on the page, and end with "what I don't trust yet".

Remember: escape every literal dollar sign as \\$ or the math renderer mangles the line.

[Open the report](/${slug}/)
`,
);

const data = JSON.parse(readFileSync(jsonPath, "utf8"));
data.items.unshift({ title, summary, href: `/${slug}/`, post: `/posts/${slug}/`, started: today, updated: today, status: "Draft", tags: [tag] });
writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);

const listPage = research ? "/research/" : "/experiments/";
console.log(`Created:
  ${page}                     (navbar + license are injected at build time)
  ${path.join(postDir, "index.md")}   (draft: true)
  ${jsonPath}                 (status "Draft": hidden from ${listPage} until you set it to "Live")
Next: write the page, then set its status to "Live" in ${jsonPath}; pnpm dev -> http://127.0.0.1:4321/${slug}/ (live reload); before the PR: pnpm build && pnpm check:standalone`);
