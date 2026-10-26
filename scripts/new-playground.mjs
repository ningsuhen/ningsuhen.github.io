// Scaffold a draft post plus a Draft entry. Kinds:
// Default: a live demo at /playground/<slug>/ (src/data/playground.json, tag Playground), plus its standalone page.
// --research: a report at /research/<slug>/ (src/data/research.json, tag Research), plus its standalone page.
// --idea: a short write-up (src/data/ideas.json, tag Idea). The entry links to the post. Add --page for a standalone
//   page at /ideas/<slug>/ (the entry links to the page, the post is its companion write-up).
// Usage: pnpm new-playground [--research | --idea [--page]] <slug> "<Title>" ["<one-sentence summary>"]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const idea = args.includes("--idea");
const research = args.includes("--research");
const page = args.includes("--page");
const [slug, title, summary = "TODO: one sentence on what this is about."] = args.filter((a) => !a.startsWith("--"));
if (!slug || !title || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || (page && !idea) || (idea && research)) {
	console.error('Usage: pnpm new-playground [--research | --idea [--page]] <slug> "<Title>" ["<summary>"]   (slug: lowercase letters, digits, hyphens)');
	process.exit(1);
}
const kind = idea ? "Idea" : research ? "Research" : "Playground"; // tag, category and eyebrow
const section = idea ? "ideas" : research ? "research" : "playground";
const jsonPath = idea ? "src/data/ideas.json" : research ? "src/data/research.json" : "src/data/playground.json";
const hasPage = !idea || page; // a standalone page at public/<section>/<slug>/
const href = hasPage ? `/${section}/${slug}/` : `/posts/${slug}/`;
const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
const pagePath = path.join("public", section, slug, "index.html");
const postDir = path.join("src/content/posts", slug);
if ((hasPage && existsSync(pagePath)) || existsSync(postDir)) {
	console.error(`Refusing to overwrite: ${hasPage && existsSync(pagePath) ? pagePath : postDir} already exists.`);
	process.exit(1);
}

const fill = (s) =>
	s
		.replaceAll("{{TITLE}}", title)
		.replaceAll("{{DATE}}", today)
		.replaceAll("{{SUMMARY}}", summary)
		.replaceAll("{{SLUG}}", slug)
		.replaceAll("{{KIND}}", kind);
if (hasPage) {
	mkdirSync(path.dirname(pagePath), { recursive: true });
	writeFileSync(pagePath, fill(readFileSync("public/design-system/template.html", "utf8")));
}

const linkLabel = idea ? "Open the idea" : research ? "Open the report" : "Open the demo";
const todo = idea
	? "TODO: write this in your own voice. Say what the idea is, why it might be worth building or testing, and what would make you start."
	: 'TODO: write this in your own voice. Lead with what you saw, quote only numbers that are on the page, and end with "what I don\'t trust yet".';
const body = hasPage ? `${todo}\n\n[${linkLabel}](${href})` : todo;
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
const post = `/posts/${slug}/`;
const entry = { title, summary, href, ...(hasPage ? { post } : {}), started: today, updated: today, status: "Draft", tags: [kind] };
data.items.unshift(entry);
writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);

console.log(`Created:
  ${hasPage ? `${pagePath}                     (navbar + license are injected at build time)\n  ` : ""}${path.join(postDir, "index.md")}   (draft: true)
  ${jsonPath}                 (status "Draft": hidden from /${section}/ until you set it to "Live")
Next: ${hasPage ? "write the page and the post" : "write the post"}, then set its status to "Live" in ${jsonPath}; pnpm dev -> http://127.0.0.1:4321${href} (live reload); before the PR: pnpm build && pnpm check:standalone`);
