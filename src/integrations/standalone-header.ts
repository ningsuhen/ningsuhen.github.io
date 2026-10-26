import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AstroIntegration } from "astro";
import { draftHrefs, isDraftPage } from "../../scripts/lib/draft-pages.mjs";
import { buildScript } from "../chrome/navbar";
import { buildLicenseScript } from "../chrome/license";
import { applyChrome } from "../chrome/apply";

/**
 * Adds the site's navbar (same links as navBarConfig, plus the light/dark toggle) to every
 * standalone HTML file shipped from public/ (reports, demos, exported artifacts), so those
 * pages don't need to know about the site. The toggle shares localStorage "theme" with the
 * site and sets <html data-theme> on the page, which standalone pages can style against.
 * Opt out per page with: <meta name="site-navbar" content="off">
 */
export default function standaloneHeader(): AstroIntegration {
	let publicDir = "";
	let base = "/";
	let site = "";

	return {
		name: "standalone-header",
		hooks: {
			"astro:config:done": ({ config }) => {
				publicDir = fileURLToPath(config.publicDir);
				base = config.base;
				site = config.site ?? "";
			},
			// Dev: Astro's dev server doesn't map public/<dir>/ to <dir>/index.html and skips the build hook, so
			// standalone pages were 404 locally and had no navbar. Serve them transformed, with Vite's client
			// injected so editing a public/*.html file live-reloads the open page.
			"astro:server:setup": ({ server }) => {
				const script = buildScript(base);
				server.watcher.add(publicDir);
				server.watcher.on("change", (file) => {
					if (file.startsWith(publicDir) && file.endsWith(".html")) server.ws.send({ type: "full-reload" });
				});
				server.middlewares.use(async (req, res, next) => {
					const pathname = decodeURIComponent((req.url ?? "/").split("?")[0]);
					const rel = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
					const file = path.join(publicDir, path.normalize(rel));
					if (!rel.endsWith(".html") || !file.startsWith(publicDir)) return next();
					try {
						const html = await readFile(file, "utf8");
						const client = '<script type="module" src="/@vite/client"></script>';
						res.setHeader("Content-Type", "text/html; charset=utf-8");
						res.end(applyChrome(html, script, client, buildLicenseScript(base), pathname, base, site));
					} catch {
						next();
					}
				});
			},
			"astro:build:done": async ({ dir }) => {
				const outDir = fileURLToPath(dir);
				const script = buildScript(base);
				const licenseScript = buildLicenseScript(base);
				// Draft pages (src/data Draft entries) are not shipped. Astro already copied public/ into dist/, so their
				// folders (page and data) are removed here, before pagefind indexes the output.
				const drafts = draftHrefs();
				for (const href of drafts) {
					if (!/^\/(research|playground|ideas)\/[^/]+\/$/.test(href)) throw new Error(`Draft href is not a standalone page folder: ${href}`);
					await rm(path.join(outDir, href), { recursive: true, force: true });
				}
				for (const rel of await htmlFiles(publicDir)) {
					if (isDraftPage(rel, drafts)) continue;
					const target = path.join(outDir, rel);
					const html = await readFile(target, "utf8");
					const urlPath = `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
					await writeFile(target, applyChrome(html, script, "", licenseScript, urlPath, base, site));
				}
			},
		},
	};
}

async function htmlFiles(root: string, dir = ""): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
		const rel = path.join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await htmlFiles(root, rel)));
		else if (entry.name.endsWith(".html")) found.push(rel);
	}
	return found;
}
