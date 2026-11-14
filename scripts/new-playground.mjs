// Scaffold a draft post plus a Draft entry. Kinds:
// Default: a live demo at /playground/<slug>/ (src/data/playground.json, tag Playground), plus its standalone page.
// --research: a report at /research/<slug>/ (src/data/research.json, tag Research), plus its standalone page.
// --idea: a short write-up (src/data/ideas.json, tag Idea). The entry links to the post. Add --page for a standalone
//   page at /ideas/<slug>/ (the entry links to the page, the post is its companion write-up).
// The standalone page is a fragment (src/standalone/<kind>/<slug>/: meta.json + body.html, contract in
// src/standalone/contract.json); the shell renders the navbar, hero, tabs, comments and footer around it.
// Usage: pnpm new-playground [--research | --idea [--page]] <slug> "<Title>" ["<one-sentence summary>"]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { POST_SOURCES } from "./lib/posts.mjs";

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
const hasPage = !idea || page; // a standalone page at /<section>/<slug>/
const href = hasPage ? `/${section}/${slug}/` : `/posts/${slug}/`;
const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
const fragmentKind = idea ? "idea" : section; // the fragment folder kind ("idea" is served at /ideas/)
const pageDir = path.join("src/standalone", fragmentKind, slug);
const legacyPage = path.join("public", section, slug, "index.html"); // the old injection path: the slug must stay free
const postDir = path.join("src/content/posts", slug);
const postFile = path.join(postDir, POST_SOURCES[0]); // new posts are MDX
const taken = [hasPage && pageDir, hasPage && legacyPage, postDir].find((p) => p && existsSync(p));
if (taken) {
	console.error(`Refusing to overwrite: ${taken} already exists.`);
	process.exit(1);
}

if (hasPage) {
	mkdirSync(pageDir, { recursive: true });
	const meta = { contract: 1, kind: fragmentKind, slug, title, created: today, updated: today, summary, eyebrow: kind, width: "wide", layout: "tabbed" };
	writeFileSync(path.join(pageDir, "meta.json"), `${JSON.stringify(meta, null, "\t")}\n`);
	// One tab; each top-level <section data-rd-tab> is a tab, and its h2/h3 with an id form the "On this page" rail.
	writeFileSync(
		path.join(pageDir, "body.html"),
		`<section class="rd-tabpanel rd-with-toc" id="summary" data-rd-tab="summary" data-rd-group="Overview" data-rd-label="Summary" data-rd-icon="file-text">
<div class="rd-tab__body">
  <section class="rd-tabsec">
    <header class="rd-section__head"><span class="rd-section__icon"><svg class="rd-icon" aria-hidden="true"><use href="#i-file-text"/></svg></span><h2 id="what-this-is">What this is</h2></header>
    <p>TODO: the page content, built from the design system's rd-* components. Content only: the shell adds the navbar, hero, tabs, comments and footer.</p>
  </section>
</div>
</section>
`,
	);
}

const linkLabel = idea ? "Open the idea" : research ? "Open the report" : "Open the demo";
const todo = idea
	? "TODO: write this in your own voice. Say what the idea is, why it might be worth building or testing, and what would make you start."
	: 'TODO: write this in your own voice. Lead with what you saw, quote only numbers that are on the page, and end with "what I don\'t trust yet".';
const body = hasPage ? `${todo}\n\n[${linkLabel}](${href})` : todo;
mkdirSync(postDir, { recursive: true });
writeFileSync(
	postFile,
	`---
title: ${JSON.stringify(title)}
published: ${today}
description: ${JSON.stringify(summary)}
tags: [${kind}]
category: ${kind}
draft: true
---

${body}

Remember: escape every literal dollar sign as \\$ or the math renderer mangles the line. This is MDX: escape a literal \`{\` or \`<\` in prose as \`\\{\` or \`\\<\`, and write comments (owner markers too) as HTML comments.
`,
);

const data = JSON.parse(readFileSync(jsonPath, "utf8"));
const post = `/posts/${slug}/`;
const entry = { title, summary, href, ...(hasPage ? { post } : {}), started: today, updated: today, status: "Draft", tags: [kind] };
data.items.unshift(entry);
writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);

console.log(`Created:
  ${hasPage ? `${pageDir}/meta.json, body.html   (a fragment: the shell adds the chrome; check with pnpm check:export)\n  ` : ""}${postFile}   (draft: true)
  ${jsonPath}                 (status "Draft": hidden from /${section}/ until you set it to "Live")
Next: ${hasPage ? "write the page and the post" : "write the post"}, then set its status to "Live" in ${jsonPath}; pnpm dev -> http://127.0.0.1:8050${href} (live reload); before the PR: pnpm check:export && pnpm build && pnpm check:standalone`);
