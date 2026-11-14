import { draftHrefs } from "../../scripts/lib/draft-pages.mjs";
import { standalonePages } from "../../scripts/lib/standalone-pages.mjs";
import { allFragments } from "../standalone/loader";

// The URL segment (route directory) for a fragment kind. It equals the kind except for ideas, whose
// route is src/pages/ideas/ while the fragment kind is "idea".
const KIND_SEGMENT: Record<string, string> = { idea: "ideas" };

/**
 * URL paths (with base, trailing slash) of every standalone document: the pages shipped from public/
 * (reports, playground demos, ideas, design-system) plus the shell-rendered fragment routes
 * (src/standalone/<kind>/<slug>/). These are complete HTML documents, not Fuwari pages, so Swup must
 * never intercept links to them. Drafts only in dev, where they are served for review: the list is in every
 * page's HTML, so a build must not name unpublished pages.
 */
export function getStandalonePaths(base = import.meta.env.BASE_URL): string[] {
	const prefix = base.replace(/\/$/, "");
	const drafts = import.meta.env.DEV;
	const publicPaths = standalonePages({ drafts }).map((rel) => {
		const urlPath = `${prefix}/${rel.split("/").join("/")}`;
		return urlPath.endsWith("/index.html") ? urlPath.slice(0, -"index.html".length) : urlPath;
	});
	const hidden = drafts ? new Set<string>() : draftHrefs();
	const fragmentPaths = allFragments()
		.map(({ kind, slug }) => `/${KIND_SEGMENT[kind] ?? kind}/${slug}/`)
		.filter((href) => !hidden.has(href))
		.map((href) => `${prefix}${href}`);
	return [...publicPaths, ...fragmentPaths];
}
