import { standalonePages } from "../../scripts/lib/standalone-pages.mjs";
import { allFragments } from "../standalone/loader";

// The URL segment (route directory) for a fragment kind. It equals the kind except for ideas, whose
// route is src/pages/ideas/ while the fragment kind is "idea".
const KIND_SEGMENT: Record<string, string> = { idea: "ideas" };

/**
 * URL paths (with base, trailing slash) of every standalone document: the pages shipped from public/
 * (reports, playground demos, ideas, design-system) plus the shell-rendered fragment routes
 * (src/standalone/<kind>/<slug>/). These are complete HTML documents, not Fuwari pages, so Swup must
 * never intercept links to them. Draft pages are not shipped, so they are left out.
 */
export function getStandalonePaths(base = import.meta.env.BASE_URL): string[] {
	const prefix = base.replace(/\/$/, "");
	const publicPaths = standalonePages().map((rel) => {
		const urlPath = `${prefix}/${rel.split("/").join("/")}`;
		return urlPath.endsWith("/index.html") ? urlPath.slice(0, -"index.html".length) : urlPath;
	});
	const fragmentPaths = allFragments().map(({ kind, slug }) => `${prefix}/${KIND_SEGMENT[kind] ?? kind}/${slug}/`);
	return [...publicPaths, ...fragmentPaths];
}
