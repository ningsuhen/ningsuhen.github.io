// Render a Mermaid source to SVG or PNG with the research design-system theme.
// Usage: pnpm render:mermaid <in.mmd> <out.svg|out.png>
// Chrome: set MERMAID_CHROME (or CHROME_PATH) to a Chrome/Chromium binary if puppeteer has none of its own.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "@mermaid-js/mermaid-cli";

const [input, output] = process.argv.slice(2);
if (!input || !output || ![".svg", ".png"].includes(extname(output))) {
	console.error("usage: render-mermaid <in.mmd> <out.svg|out.png>");
	process.exit(2);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "design-system", "mermaid");
const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
const cwd = process.env.INIT_CWD || process.cwd(); // pnpm runs scripts from the package root; paths are relative to where you typed them
const format = extname(output).slice(1);
// Unique, CSS-safe id from the file name: inlined diagrams on one page never share #id rules.
const svgId = `mmd-${basename(output, extname(output)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
config.themeCSS = readFileSync(join(dir, "theme.css"), "utf8");

const chrome = process.env.MERMAID_CHROME || process.env.CHROME_PATH;
const puppeteerConfig = { args: ["--no-sandbox"], ...(chrome ? { executablePath: chrome } : {}) };

await run(resolve(cwd, input), resolve(cwd, output), {
	quiet: true,
	outputFormat: format,
	puppeteerConfig,
	parseMMDOptions: {
		mermaidConfig: config,
		svgId,
		fontEmbed: false,
		// PNGs have no page behind them: white, matching the light fallbacks. SVGs stay transparent.
		backgroundColor: format === "png" ? "white" : "transparent",
		...(format === "png" ? { viewport: { width: 1200, height: 800, deviceScaleFactor: 2 } } : {}),
	},
});

if (format === "svg") {
	let svg = readFileSync(resolve(cwd, output), "utf8");
	// Drop the XML prolog, Mermaid's fixed inline size and any hard-coded colour left outside var() fallbacks.
	svg = svg.replace(/^<\?xml[^>]*\?>\s*/, "").replace(/ style="max-width:[^"]*"/, "");
	svg = svg.replace(/ (fill|stroke)="(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|white|black)"/g, "");
	// Strip every colour declaration whose value is a literal (Mermaid's base-theme rules); ours use var(--rd-*, fallback).
	svg = svg.replace(
		/(fill|stroke|background-color|background|color|stop-color|flood-color):\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)(?![a-z(-])\s*(!important)?\s*;?/g,
		(m, prop, val) => (/^(none|transparent|inherit|currentcolor|context-fill|context-stroke)$/i.test(val) ? m : ""),
	);
	// Classic look only: drop the inert "neo" rules and the gradient/shadow defs they reference.
	svg = svg.replace(/[^{}]*\[data-look="neo"\][^{}]*\{[^{}]*\}/g, "").replace(/<defs>(?:(?!<\/defs>).)*?(?:feDropShadow|linearGradient)(?:(?!<\/defs>).)*?<\/defs>/gs, "");
	writeFileSync(resolve(cwd, output), svg);
}
