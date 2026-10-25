// The standalone HTML pages shipped from public/ (reports, live experiments, ideas, design-system pages) — the single
// source of truth for "which pages exist." Consumers tailor the set:
//   - sections: which top-level folders to walk. Default (null) = every .html under public/. Pass SECTIONS for
//     reports/experiments/ideas only, or ["design-system"] for the design-system pages.
//   - depth: when set, only pages at exactly that many path segments (e.g. 3 = "research/<slug>/index.html").
//   - exclude: filenames to skip (e.g. "template.html").
//   - drafts: include Draft pages (default false — they are not shipped, so most consumers leave them out).
// Returns public-relative paths ("research/<slug>/index.html"), sorted. Consumers convert to URLs as they need.
import { readdirSync } from "node:fs";
import path from "node:path";
import { draftHrefs, isDraftPage } from "./draft-pages.mjs";

export const SECTIONS = ["research", "experiments", "ideas"];

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
