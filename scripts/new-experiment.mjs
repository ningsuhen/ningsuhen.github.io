// Scaffold a draft post plus a Draft entry. Three kinds:
// Default: a live experiment at /experiments/<slug>/ (src/data/experiments.json, tag Experiment), plus its standalone page.
// --research: a report at /research/<slug>/ (src/data/research.json, tag Research), plus its standalone page.
// --idea: a short write-up with no standalone page (src/data/ideas.json, tag Idea); the entry links to the post itself.
// Usage: pnpm new-experiment [--research|--idea] <slug> "<Title>" ["<one-sentence summary>"]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const idea = args.includes("--idea");
const research = args.includes("--research");
const [slug, title, summary = "TODO: one sentence on what this is about."] = args.filter((a) => !a.startsWith("--"));
if (!slug || !title || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
	console.error('Usage: pnpm new-experiment [--research|--idea] <slug> "<Title>" ["<summary>"]   (slug: lowercase letters, digits, hyphens)');
	process.exit(1);
}
const kind = idea ? "Idea" : research ? "Research" : "Experiment"; // tag, category and eyebrow
const section = research ? "research" : "experiments";
const jsonPath = idea ? "src/data/ideas.json" : research ? "src/data/research.json" : "src/data/experiments.json";
const href = idea ? `/posts/${slug}/` : `/${section}/${slug}/`;
const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
const page = path.join("public", section, slug, "index.html");
const postDir = path.join("src/content/posts", slug);
if ((!idea && existsSync(page)) || existsSync(postDir)) {
	console.error(`Refusing to overwrite: ${existsSync(page) && !idea ? page : postDir} already exists.`);
	process.exit(1);
}

const fill = (s) =>
	s
		.replaceAll("{{TITLE}}", title)
		.replaceAll("{{DATE}}", today)
		.replaceAll("{{SUMMARY}}", summary)
		.replaceAll("{{SLUG}}", slug)
		.replaceAll("{{KIND}}", kind);
if (!idea) {
	mkdirSync(path.dirname(page), { recursive: true });
	writeFileSync(page, fill(readFileSync("public/design-system/template.html", "utf8")));
}

const linkLabel = research ? "Open the report" : "Open the experiment";
const body = idea
	? "TODO: write this in your own voice. Say what the idea is, why it might be worth building or testing, and what would make you start."
	: `TODO: write this in your own voice. Lead with what you saw, quote only numbers that are on the page, and end with "what I don't trust yet".

[${linkLabel}](${href})`;
mkdirSync(postDir, { recursive: true });
writeFileSync(
	path.join(postDir, "index.md"),
	`---
title: ${JSON.stringify(title)}
published: ${today}
description: ${JSON.stringify(summary)}
tags: [${kind}]
category: ${kind}
draft: true
---

${body}

Remember: escape every literal dollar sign as \\$ or the math renderer mangles the line.
`,
);

const data = JSON.parse(readFileSync(jsonPath, "utf8"));
const entry = idea
	? { title, summary, href, started: today, updated: today, status: "Draft", tags: [kind] }
	: { title, summary, href, post: `/posts/${slug}/`, started: today, updated: today, status: "Draft", tags: [kind] };
data.items.unshift(entry);
writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);

console.log(`Created:
  ${idea ? "" : `${page}                     (navbar + license are injected at build time)\n  `}${path.join(postDir, "index.md")}   (draft: true)
  ${jsonPath}                 (status "Draft": hidden from /${idea ? "ideas" : section}/ until you set it to "Live")
Next: ${idea ? "write the post" : "write the page"}, then set its status to "Live" in ${jsonPath}; pnpm dev -> http://127.0.0.1:4321${href} (live reload); before the PR: pnpm build && pnpm check:standalone`);
