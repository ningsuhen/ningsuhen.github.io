import { readFileSync } from "node:fs";
import path from "node:path";
import { siteConfig } from "../config";
import { esc } from "./util";

// The /research/ and /playground/ cards carry a one-line summary; use it as the social description when the
// exported page has no <meta name="description"> of its own.
function entrySummaries(): Map<string, string> {
	const out = new Map<string, string>();
	for (const file of ["research.json", "playground.json"]) {
		try {
			const data = JSON.parse(readFileSync(path.resolve(`src/data/${file}`), "utf8")) as { items?: { href?: string; summary?: string }[] };
			for (const item of data.items ?? []) if (item.href && item.summary) out.set(item.href, item.summary);
		} catch {
			/* no data file: fall back to the page/site description */
		}
	}
	return out;
}

// Open Graph / Twitter cards for a standalone page: the visible title (minus the created/updated stamp) and the
// page's own description when it has one, so a share is not a blank card. Head-only: it lands in the "late" group
// (after the charset/viewport metas), so the design-system head-order rule — charset then viewport first — holds.
export function buildSocialMeta(html: string, canonical: string, site: string): string {
	if (/<meta[^>]+property=["']og:title["']/i.test(html)) return ""; // the page already declares OG
	let title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? siteConfig.title).trim();
	title = title.replace(/\s*[·•]\s*created \d{4}-\d{2}-\d{2}\s*[·•]\s*updated \d{4}-\d{2}-\d{2}\s*$/i, "").trim();
	const descTag = html.match(/<meta[^>]+name=["']description["'][^>]*>/i)?.[0] ?? "";
	const ownDescription = descTag.match(/content=["']([^"']*)["']/i)?.[1]?.trim() ?? "";
	const urlPath = new URL(canonical, site).pathname;
	const description = ownDescription || entrySummaries().get(urlPath) || siteConfig.subtitle || "";
	const image = new URL("/images/default-thumbnail.webp", site).href;
	const og = (k: string, v: string) => `<meta property="${k}" content="${esc(v)}">`;
	const tw = (k: string, v: string) => `<meta name="twitter:${k}" content="${esc(v)}">`;
	return [
		og("og:type", "website"),
		og("og:site_name", siteConfig.title),
		og("og:title", title),
		og("og:description", description),
		og("og:url", canonical),
		og("og:image", image),
		tw("card", "summary_large_image"),
		tw("title", title),
		tw("description", description),
		tw("image", image),
	].join("");
}
