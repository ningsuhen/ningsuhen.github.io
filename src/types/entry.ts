/** One card on /research/ (src/data/research.json), /experiments/ (src/data/experiments.json) or /ideas/ (src/data/ideas.json). */
export type Entry = {
	title: string;
	summary: string;
	/** Standalone page or app, site-relative with trailing slash. Ideas have no standalone page: href is the idea post. */
	href: string;
	/** Write-up post, site-relative. */
	post?: string;
	started: string;
	updated?: string;
	/** "Live" | "Coming soon" | "Draft" (Draft is never shown). */
	status: string;
	tags: string[];
};
