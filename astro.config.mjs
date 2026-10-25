import sitemap from "@astrojs/sitemap";
import { fileURLToPath } from "node:url";
import svelte from "@astrojs/svelte";
import tailwind from "@astrojs/tailwind";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import swup from "@swup/astro";
import expressiveCode from "astro-expressive-code";
import icon from "astro-icon";
import { unified } from "@astrojs/markdown-remark";
import { defineConfig } from "astro/config";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeComponents from "rehype-components"; /* Render the custom directive content */
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkDirective from "remark-directive"; /* Handle directives */
import remarkGithubAdmonitionsToDirectives from "remark-github-admonitions-to-directives";
import remarkMath from "remark-math";
import remarkSectionize from "remark-sectionize";
import { expressiveCodeConfig } from "./src/config.ts";
import { pluginLanguageBadge } from "./src/plugins/expressive-code/language-badge.ts";
import { AdmonitionComponent } from "./src/plugins/rehype-component-admonition.mjs";
import { GithubCardComponent } from "./src/plugins/rehype-component-github-card.mjs";
import { parseDirectiveNode } from "./src/plugins/remark-directive-rehype.js";
import { remarkExcerpt } from "./src/plugins/remark-excerpt.js";
import standaloneHeader from "./src/integrations/standalone-header.ts";
import { standalonePages } from "./scripts/lib/standalone-pages.mjs";
import { remarkOwnerMarkers } from "./src/plugins/owner-markers.mjs";
import { remarkReadingTime } from "./src/plugins/remark-reading-time.mjs";
import { remarkSourceMap } from "./src/plugins/remark-source-map.mjs";
import { pluginCustomCopyButton } from "./src/plugins/expressive-code/custom-copy-button.js";

const SITE = "https://ningsuhen.github.io/";
const ROOT = fileURLToPath(new URL(".", import.meta.url));

/** Standalone pages in public/ (reports, apps) are not Astro routes, so the sitemap needs them listed by hand. */
function standaloneSitemapPages() {
	return standalonePages({ exclude: ["template.html"] }).map((rel) => new URL(`/${rel.replace(/index\.html$/, "")}`, SITE).href);
}

// https://astro.build/config
export default defineConfig({
	site: SITE,
	// Dev port is 4321 and fails loudly if taken (vite strictPort below). `pnpm dev:agent` overrides it to 4400+.
	server: {
		host: "127.0.0.1",
		port: 4321,
	},
	base: "/",
	trailingSlash: "always",
	// Astro 7 defaults to JSX whitespace rules; keep the Astro 5 HTML output.
	compressHTML: true,
	// Keeps src/content/config.ts (slug, entry.render()) working; migrate to src/content.config.ts with loaders later.
	legacy: { collectionsBackwardsCompat: true },
	redirects: {
		"/ai-economy/": "/research/ai-economy/",
		"/brev-tree-benchmark/": "/research/brev-tree-benchmark/",
		// Experiments was renamed to Playground. ecosimulation is a Draft (not shipped), so it lands on the list until it goes Live.
		"/experiments/": "/playground/",
		"/experiments/brev-tree-traversal/": "/playground/brev-tree-traversal/",
		"/experiments/ecosimulation/": "/playground/",
		"/web-development/2015/03/31/project-6/": "/",
		"/mobile-app-development/2014/12/10/project-5/": "/",
		"/web-development/mobile-app-development/2014/05/09/project-4/": "/",
		"/web-development/2014/03/05/project-3/": "/",
		"/web-development/2013/07/07/project-2/": "/",
		"/web-development/2007/12/15/project-1/": "/",
	},
	integrations: [
		standaloneHeader(),
		tailwind({
			nesting: true,
		}),
		swup({
			theme: false,
			animationClass: "transition-swup-", // see https://swup.js.org/options/#animationselector
			// the default value `transition-` cause transition delay
			// when the Tailwind class `transition-all` is used
			containers: ["main", "#toc"],
			smoothScrolling: true,
			cache: true,
			preload: true,
			accessibility: true,
			updateHead: true,
			updateBodyClass: false,
			globalInstance: true,
		}),
		icon({
			include: {
				lucide: ["*"],
				"fa6-brands": ["medium"],
			},
		}),
		expressiveCode({
			themes: [expressiveCodeConfig.theme, expressiveCodeConfig.theme],
			plugins: [
				pluginCollapsibleSections(),
				pluginLineNumbers(),
				pluginLanguageBadge(),
				pluginCustomCopyButton()
			],
			defaultProps: {
				wrap: true,
				overridesByLang: {
					'shellsession': {
						showLineNumbers: false,
					},
				},
			},
			styleOverrides: {
				codeBackground: "var(--codeblock-bg)",
				borderRadius: "0.75rem",
				borderColor: "none",
				codeFontSize: "0.875rem",
				codeFontFamily: "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
				codeLineHeight: "1.5rem",
				frames: {
					editorBackground: "var(--codeblock-bg)",
					terminalBackground: "var(--codeblock-bg)",
					terminalTitlebarBackground: "var(--codeblock-topbar-bg)",
					editorTabBarBackground: "var(--codeblock-topbar-bg)",
					editorActiveTabBackground: "none",
					editorActiveTabIndicatorBottomColor: "var(--primary)",
					editorActiveTabIndicatorTopColor: "none",
					editorTabBarBorderBottomColor: "var(--codeblock-topbar-bg)",
					terminalTitlebarBorderBottomColor: "none"
				},
				textMarkers: {
					delHue: 0,
					insHue: 180,
					markHue: 250
				}
			},
			frames: {
				showCopyToClipboardButton: false,
			}
		}),
        svelte(),
		sitemap({ customPages: standaloneSitemapPages() }),
	],
	markdown: {
		// Astro 7 default processor is Satteri; keep the unified (remark/rehype) pipeline the site was built on.
		processor: unified({
		remarkPlugins: [
			remarkOwnerMarkers, // first: hidden owner markers never reach the HTML, excerpt or reading time
			remarkMath,
			remarkReadingTime,
			remarkExcerpt,
			remarkGithubAdmonitionsToDirectives,
			remarkDirective,
			remarkSectionize,
			parseDirectiveNode,
			[remarkSourceMap, { root: ROOT }],
		],
		rehypePlugins: [
			rehypeKatex,
			rehypeSlug,
			[
				rehypeComponents,
				{
					components: {
						github: GithubCardComponent,
						note: (x, y) => AdmonitionComponent(x, y, "note"),
						tip: (x, y) => AdmonitionComponent(x, y, "tip"),
						important: (x, y) => AdmonitionComponent(x, y, "important"),
						caution: (x, y) => AdmonitionComponent(x, y, "caution"),
						warning: (x, y) => AdmonitionComponent(x, y, "warning"),
					},
				},
			],
			[
				rehypeAutolinkHeadings,
				{
					behavior: "append",
					properties: {
						className: ["anchor"],
					},
					content: {
						type: "element",
						tagName: "span",
						properties: {
							className: ["anchor-icon"],
							"data-pagefind-ignore": true,
						},
						children: [
							{
								type: "text",
								value: "#",
							},
						],
					},
				},
			],
		],
		}),
	},
	vite: {
		// Source maps would publish build-machine source paths; keep them off in every build.
		build: { sourcemap: false },
		server: {
			// Only `pnpm dev:agent` (npm_lifecycle_event) may fall back to the next free port.
			strictPort: process.env.npm_lifecycle_event !== "dev:agent",
			// Astro restarts the whole dev server on any astro.config.* change it sees, so a worktree's
			// config or churn under .worktrees/ used to restart the LaunchAgent server again and again.
			// Absolute globs: a relative "**/.worktrees/**" would also match this checkout when it lives under .worktrees/.
			watch: {
				ignored: [".worktrees", ".tmp", "dist"].map((dir) => `${ROOT}${dir}/**`),
			},
		},
		build: {
			rollupOptions: {
				onwarn(warning, warn) {
					// temporarily suppress this warning
					if (
						warning.message.includes("is dynamically imported by") &&
						warning.message.includes("but also statically imported by")
					) {
						return;
					}
					warn(warning);
				},
			},
		},
	},
});
