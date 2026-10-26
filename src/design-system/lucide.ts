// Lucide icon lookup shared by the Astro shell (build time) and the sprite builder.
// A page's icons are every `#i-<name>` it references. The shell inlines a per-page sprite
// (self-contained, no request) so shell-rendered fragments get their icons the same way the
// old public/ pages do. scripts/build-lucide-sprite.mjs keeps its own copy of this for the
// public/ pages it rewrites and the sprite-fresh check.
import { readFileSync } from "node:fs";
import path from "node:path";

const ICONS = path.resolve("node_modules/@iconify-json/lucide/icons.json");
let cache: { icons: Record<string, any>; aliases?: Record<string, any>; width?: number; height?: number } | null = null;
function lucide() {
	if (!cache) cache = JSON.parse(readFileSync(ICONS, "utf8"));
	return cache;
}

/** The sorted Lucide icon names a piece of markup references (`#i-<name>`). */
export function iconNames(markup: string): string[] {
	return [...new Set([...markup.matchAll(/#i-([a-z0-9-]+)/g)].map((m) => m[1]))].sort();
}

/** The <symbol> for one icon (throws if the name is not in the Lucide set). */
export function symbol(name: string): string {
	const l = lucide();
	const icon = l.icons[name] ?? (l.aliases?.[name] && { ...l.icons[l.aliases[name].parent], ...l.aliases[name] });
	if (!icon) throw new Error(`Lucide icon "${name}" not found in @iconify-json/lucide`);
	const w = icon.width ?? l.width ?? 24;
	const h = icon.height ?? l.height ?? 24;
	return `<symbol id="i-${name}" viewBox="0 0 ${w} ${h}">${icon.body}</symbol>`;
}

/** An inline sprite <svg> holding the given icons, for inlining into a page body. */
export function spriteBlock(names: string[]): string {
	if (!names.length) return "";
	return `<svg style="display:none" aria-hidden="true">\n${names.map(symbol).join("\n")}\n</svg>`;
}
