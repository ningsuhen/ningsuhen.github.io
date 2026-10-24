import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AstroIntegration } from "astro";

const MARKER = "data-site-home-bar";
const OPT_OUT = /<meta[^>]+name=["']site-home-bar["'][^>]+content=["']off["']/i;

/**
 * Adds a "back to main site" bar to every standalone HTML file shipped from public/
 * (reports, demos, exported artifacts) so they don't need to know about the site.
 * Opt out per page with: <meta name="site-home-bar" content="off">
 */
export default function standaloneHeader(options: { label: string }): AstroIntegration {
	let publicDir = "";
	let base = "/";

	return {
		name: "standalone-header",
		hooks: {
			"astro:config:done": ({ config }) => {
				publicDir = fileURLToPath(config.publicDir);
				base = config.base;
			},
			"astro:build:done": async ({ dir }) => {
				const outDir = fileURLToPath(dir);
				const barScript = buildScript(options.label, base);
				for (const rel of await htmlFiles(publicDir)) {
					const target = path.join(outDir, rel);
					const html = await readFile(target, "utf8");
					if (html.includes(MARKER) || OPT_OUT.test(html)) continue;
					const at = html.lastIndexOf("</body>");
					const out = at === -1 ? html + barScript : html.slice(0, at) + barScript + html.slice(at);
					await writeFile(target, out);
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

// Script (not markup) so it works for HTML fragments without <body>; shadow DOM isolates it from page CSS.
function buildScript(label: string, href: string): string {
	const css =
		":host{all:initial;display:block}" +
		"a{display:flex;align-items:center;gap:.5rem;box-sizing:border-box;height:40px;padding:0 16px;" +
		"font:500 14px/1 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;background:#15212b;text-decoration:none}" +
		"a:hover{background:#1f5f8b}";
	return (
		`<script ${MARKER}>(function(){var h=document.createElement("div");` +
		`h.setAttribute("${MARKER}","");var s=h.attachShadow({mode:"open"});` +
		`s.innerHTML=${JSON.stringify(`<style>${css}</style><a href="${href}">← ${label}</a>`)};` +
		`document.body.insertBefore(h,document.body.firstChild)})()</script>`
	);
}
