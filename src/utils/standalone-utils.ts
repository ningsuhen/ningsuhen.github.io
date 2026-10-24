import { readdirSync } from "node:fs";
import path from "node:path";

/** URL paths (with base, trailing slash) of standalone HTML documents shipped from public/ (reports, experiments). */
export function getStandalonePaths(base = import.meta.env.BASE_URL): string[] {
	const root = path.resolve("public");
	const prefix = base.replace(/\/$/, "");
	const walk = (dir: string): string[] =>
		readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
			const rel = path.join(dir, e.name);
			if (e.isDirectory()) return walk(rel);
			if (!e.name.endsWith(".html")) return [];
			const urlPath = `${prefix}/${rel.split(path.sep).join("/")}`;
			return [urlPath.endsWith("/index.html") ? urlPath.slice(0, -"index.html".length) : urlPath];
		});
	try {
		return walk("");
	} catch {
		return [];
	}
}
