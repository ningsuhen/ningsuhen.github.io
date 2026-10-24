/** One card on /research/ (src/data/research.json) or /experiments/ (src/data/experiments.json). */
export type Entry = {
	title: string;
	summary: string;
	/** Standalone page or app, site-relative with trailing slash. */
	href: string;
	/** Write-up post, site-relative. */
	post?: string;
	started: string;
	updated?: string;
	/** "Live" | "Coming soon" | "Draft" (Draft is never shown). */
	status: string;
	tags: string[];
};
