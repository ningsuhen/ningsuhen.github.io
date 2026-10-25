/** One card on /research/ (src/data/research.json), /experiments/ (src/data/experiments.json) or /ideas/ (src/data/ideas.json). */
export type Entry = {
	title: string;
	summary: string;
	/** Standalone page or app, site-relative with trailing slash. An idea without a page links to its post (/posts/<slug>/). */
	href: string;
	/** Write-up post, site-relative. Optional for ideas: a companion post for a standalone idea page. */
	post?: string;
	started: string;
	updated?: string;
	/** "Live" | "Coming soon" | "Draft" (Draft is never shown). */
	status: string;
	tags: string[];
};
