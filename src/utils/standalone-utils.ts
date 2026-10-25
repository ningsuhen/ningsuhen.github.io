import { standalonePages } from "../../scripts/lib/standalone-pages.mjs";

/** URL paths (with base, trailing slash) of standalone HTML documents shipped from public/ (reports, experiments). Draft pages are not shipped, so they are left out. */
export function getStandalonePaths(base = import.meta.env.BASE_URL): string[] {
	const prefix = base.replace(/\/$/, "");
	return standalonePages().map((rel) => {
		const urlPath = `${prefix}/${rel.split("/").join("/")}`;
		return urlPath.endsWith("/index.html") ? urlPath.slice(0, -"index.html".length) : urlPath;
	});
}
