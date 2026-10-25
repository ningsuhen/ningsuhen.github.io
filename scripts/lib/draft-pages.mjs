// Draft standalone pages. A `Draft` entry in src/data/{research,experiments,ideas}.json is work in progress: its page
// source stays in public/ (check:leaks still scans it), but the build never ships it (the integration drops its folder
// from dist/, and the sitemap skips it). The browser checks walk only the pages a Draft does not own. The dev server
// still serves it, for the owner's own review.
import { readFileSync } from "node:fs";
import path from "node:path";

const SECTIONS = ["research", "experiments", "ideas"];

/** Hrefs ("/experiments/<slug>/") of every Draft entry in the three data files. */
export function draftHrefs(dataDir = path.resolve("src/data")) {
	const drafts = new Set();
	for (const section of SECTIONS) {
		const data = JSON.parse(readFileSync(path.join(dataDir, `${section}.json`), "utf8"));
		for (const item of data.items ?? []) if (item.href && item.status?.toLowerCase() === "draft") drafts.add(item.href);
	}
	return drafts;
}

/** True when a public-relative page path (e.g. "experiments/<slug>/index.html") belongs to a Draft entry. */
export function isDraftPage(relPath, drafts) {
	const href = `/${relPath.split(path.sep).join("/").replace(/index\.html$/, "")}`;
	return drafts.has(href);
}
