// Build-time loader for standalone fragments (the Astro-shell path, option E). A fragment is a folder
// src/standalone/<kind>/<slug>/ holding meta.json, body.html, page.css and page.js. The shell
// (src/layouts/StandaloneShell.astro) renders the chrome; the fragment supplies content only.
//
// This loader is kind-agnostic: <kind> is a plain string (research, experiment, idea, …) read from the
// folder name, so renaming a kind (e.g. experiment → playground) is a folder move, not a code change.
// Nothing here hardcodes a list of kinds — the kinds that exist are whatever folders are present.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// Fragment contract v1 (see the design-system guide, "Fragment contract"). The shell renders the
// "· created · updated" stamp from created/updated; the title carries no date stamp of its own.
export const metaSchema = z.object({
	contract: z.literal(1),
	kind: z.string().min(1),
	slug: z.string().min(1),
	title: z.string().min(1),
	created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	summary: z.string(),
	eyebrow: z.string().optional(),
	width: z.enum(["post", "wide"]).default("post"),
	layout: z.enum(["tabbed", "scroll"]).default("scroll"),
	comments: z.boolean().default(true),
	search: z.boolean().default(true),
	source: z.object({ project: z.string(), build: z.string() }).optional(),
	// Lucide icon names the page creates in page.js (not referenced in the body markup), so the shell
	// can include them in the sprite. The sprite is built from `#i-…` refs in the body; an icon only
	// ever created in JS would otherwise be missing and render empty.
	icons: z.array(z.string().regex(/^[a-z0-9-]+$/)).optional(),
});
export type Meta = z.infer<typeof metaSchema>;

export type Tab = { id: string; label: string; icon: string | null };
export type Rail = { id: string; text: string; level: 2 | 3 }[];

const ROOT = path.resolve("src/standalone");

/** The kinds that have at least one fragment folder (top-level dirs under src/standalone/). */
export function kinds(): string[] {
	if (!existsSync(ROOT)) return [];
	return readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

/** Fragment slugs for one kind (dirs under src/standalone/<kind>/). */
export function slugs(kind: string): string[] {
	const dir = path.join(ROOT, kind);
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

/** Every fragment as { kind, slug } (the set the [slug] routes and the page registry enumerate). */
export function allFragments(): { kind: string; slug: string }[] {
	return kinds().flatMap((kind) => slugs(kind).map((slug) => ({ kind, slug })));
}

export type Fragment = { meta: Meta; body: string; css: string; js: string; tabs: Tab[]; rails: Record<string, Rail> };

/** Read and validate one fragment, deriving tabs and rails from the body markup (contract: markup is the source of truth). */
export function load(kind: string, slug: string): Fragment {
	const dir = path.join(ROOT, kind, slug);
	const meta = metaSchema.parse(JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")));
	if (meta.kind !== kind || meta.slug !== slug) throw new Error(`Fragment meta mismatch at ${kind}/${slug}: kind/slug must match the folder`);
	const body = readFileSync(path.join(dir, "body.html"), "utf8");
	const css = existsSync(path.join(dir, "page.css")) ? readFileSync(path.join(dir, "page.css"), "utf8") : "";
	const js = existsSync(path.join(dir, "page.js")) ? readFileSync(path.join(dir, "page.js"), "utf8") : "";
	const { tabs, rails, body: withRails } = derive(body);
	return { meta, body: withRails, css, js, tabs, rails };
}

// Tabs come from the markup: top-level <section data-rd-tab="id" data-rd-label data-rd-icon>. The id is the
// ?tab= value. Rails are the h2/h3 with an id inside each tab, rendered server-side as a .rd-toc right after
// the tab's start tag (works without JS).
const TAB_RE = /<section\b[^>]*\bdata-rd-tab="([^"]+)"[^>]*>/g;
const LABEL_RE = /\bdata-rd-label="([^"]+)"/;
const ICON_RE = /\bdata-rd-icon="([^"]+)"/;

function derive(body: string): { tabs: Tab[]; rails: Record<string, Rail>; body: string } {
	const starts = [...body.matchAll(TAB_RE)].map((m) => ({ id: m[1], at: m.index!, end: m.index! + m[0].length, tag: m[0] }));
	const tabs: Tab[] = starts.map((s) => ({
		id: s.id,
		label: s.tag.match(LABEL_RE)?.[1] ?? s.id,
		icon: s.tag.match(ICON_RE)?.[1] ?? null,
	}));
	const rails: Record<string, Rail> = {};
	let out = body;
	// Insert from the last tab to the first so earlier offsets stay valid.
	for (let i = starts.length - 1; i >= 0; i--) {
		const s = starts[i];
		const chunk = out.slice(s.end, starts[i + 1]?.at ?? out.length);
		const rail: Rail = [...chunk.matchAll(/<h([23])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({
			level: +m[1] as 2 | 3,
			id: m[2],
			text: m[3].replace(/<[^>]+>/g, "").trim(),
		}));
		rails[s.id] = rail;
		if (rail.length) {
			const nav = `<nav class="rd-toc" aria-label="On this page"><ol>${rail
				.map((r, n) => `<li class="rd-toc__l${r.level}"><a href="#${r.id}"><span class="rd-toc__badge">${n + 1}</span><span class="rd-toc__text">${r.text}</span></a></li>`)
				.join("")}</ol></nav>`;
			out = out.slice(0, s.end) + nav + out.slice(s.end);
		}
	}
	return { tabs, rails, body: out };
}
