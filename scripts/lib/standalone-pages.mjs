// The standalone HTML pages shipped from public/ (reports, playground demos, ideas, design-system pages) — the single
// source of truth for "which pages exist." Consumers tailor the set:
//   - sections: which top-level folders to walk. Default (null) = every .html under public/. Pass SECTIONS for
//     reports/playground/ideas only, or ["design-system"] for the design-system pages.
//   - depth: when set, only pages at exactly that many path segments (e.g. 3 = "research/<slug>/index.html").
//   - exclude: filenames to skip (e.g. "template.html").
//   - drafts: include Draft pages (default false — they are not shipped, so most consumers leave them out).
// Returns public-relative paths ("research/<slug>/index.html"), sorted. Consumers convert to URLs as they need.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { draftHrefs, isDraftPage } from "./draft-pages.mjs";

export const SECTIONS = ["research", "playground", "ideas"];

export function standalonePages({ sections = null, depth = null, exclude = [], drafts = false } = {}) {
	const root = path.resolve("public");
	const want = sections ? new Set(sections) : null;
	const skip = new Set(exclude);
	const out = [];
	const walk = (dir, rel) => {
		let entries;
		try {
			entries = readdirSync(path.join(root, dir), { withFileTypes: true });
		} catch {
			return; // no such folder (e.g. public/ideas before the first idea page)
		}
		for (const e of entries) {
			const r = path.join(dir, e.name);
			if (e.isDirectory()) {
				// With sections set, only descend into the wanted top-level folders.
				if (want && rel === "" && !want.has(e.name)) continue;
				walk(r, e.name);
			} else if (e.name.endsWith(".html")) {
				if (skip.has(e.name)) continue;
				if (depth && r.split(path.sep).length !== depth) continue;
				if (!drafts && isDraftPage(r, draftHrefs())) continue;
				out.push(r);
			}
		}
	};
	walk("", "");
	return out.sort();
}

// Shell-rendered pages (src/standalone/<kind>/<slug>/, built by src/pages/<segment>/[slug].astro): no public/ file, but
// they ship at <segment>/<slug>/index.html like the public pages. Same relative shape, so checks that render pages
// cover them too. Their source contract is check:export; source-text rules stay on public/ pages.
const SHELL_SEGMENT = { research: "research", idea: "ideas", playground: "playground" };
export function shellPages({ drafts = false } = {}) {
	const root = path.resolve("src/standalone");
	const out = [];
	for (const kind of Object.keys(SHELL_SEGMENT)) {
		let slugs;
		try {
			slugs = readdirSync(path.join(root, kind), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(path.join(root, kind, e.name, "meta.json")));
		} catch {
			continue;
		}
		for (const e of slugs) {
			const r = path.join(SHELL_SEGMENT[kind], e.name, "index.html");
			if (!drafts && isDraftPage(r, draftHrefs())) continue;
			out.push(r);
		}
	}
	return out.sort();
}

// A page's HTML: the public/ source when there is one, else the built page in dist/ (shell-rendered pages).
export function pageSource(rel) {
	const pub = path.resolve("public", rel);
	return readFileSync(existsSync(pub) ? pub : path.resolve("dist", rel), "utf8");
}
