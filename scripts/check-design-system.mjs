// Design-system conformance for standalone pages (public/research/**, public/playground/**, public/ideas/**), measured in a real browser
// over the built dist. Every page is held to the research design system (public/design-system/index.html, "Conformance")
// and to the main site's post page, which is rendered in the same run at 1280/1440/1920, light and dark.
// Run after `pnpm build`:  pnpm check:design-system  (CHROME_PATH, or `pnpm exec playwright-core install chromium`).
// Accepted violations live in scripts/design-system-baseline.json. New ones fail; an entry that stops firing fails too.
// `pnpm check:design-system --update-baseline` rewrites that file for local triage (then fill in the reasons by hand).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { checkFresh } from "./build-design-system.mjs";
import { standalonePages, SECTIONS } from "./lib/standalone-pages.mjs";

const DIST = path.resolve("dist");
const PUBLIC = path.resolve("public");
const BASELINE = path.resolve("scripts/design-system-baseline.json");
const UPDATE = process.argv.includes("--update-baseline");
const REF = "/posts/rust-learnings/";
const TEMPLATE = "/design-system/template.html";
const WIDTHS = [1280, 1440, 1920];
const THEMES = ["light", "dark"];
const MOBILE = { width: 375, height: 812 };
const DESKTOP_H = 900;
const OWNERS = ["EcoSimulation", "Brev", "site"];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const CSS_BUDGET = 80_000; // bytes of inline <style> per page; over this is a warning, not a failure
const RULES = {
	"head-order": "charset then viewport are the first two head elements",
	"title-stamp": "title and visible h1 end with · created YYYY-MM-DD · updated YYYY-MM-DD",
	"css-canonical": "research.css is linked, or inlined verbatim (whitespace-insensitive)",
	"bundle-fresh": "the shipped design-system bundle (rd.css, research.css alias, manifest.json) equals a fresh build of src/design-system/",
	"bundle-linked": "the page links the design-system bundle instead of inlining a frozen copy",
	"body-class": '<body class="rd-body">',
	"container-class": "main content uses rd-container, rd-container--wide or rd-tabbed",
	"container-width": "rd-container is 872px (54.5rem); wide/tabbed content is the navbar card width",
	density: "data-density, when set, is compact, comfortable or dense",
	"theme-owned": "theme comes from html[data-theme] only: no prefers-color-scheme, no page theme toggle",
	"container-comment": "a page using rd-container--wide documents why in a source comment",
	"icon-glyph": "no emoji or arrow glyphs used as UI icons",
	"icon-sprite": "icons are svg.rd-icon whose <use> target exists in the sprite (no hand-drawn icon SVGs)",
	"colour-tokens": "colours come from --rd-* tokens (no raw hex/rgb/oklch in page CSS or style attributes)",
	fonts: "no @font-face of its own (fonts come from the design system or the site)",
	iframe: "no iframes",
	"one-footer": "the license card is the only footer (no <footer> in the page itself)",
	"external-requests": "no requests outside the page origin (non-origin requests are blocked during the run)",
	"console-errors": "no console errors or uncaught exceptions during load",
	overflow: "no horizontal page overflow at 1440 and 375",
	"tap-target": "interactive controls are at least 24px at 375",
	"injected-once": "the site navbar and the license card are each present exactly once",
	breadcrumb: "the injected breadcrumb band is present exactly once and no breadcrumb is hand-written outside it (trail, links, geometry and band opacity: check:standalone)",
	"forbidden-strings": "no internal hostnames, /Users/ paths or IP addresses in the source",
	axe: "no axe WCAG 2.0/2.1 A and AA violations at 375 and 1440, light and dark, on every standalone page (research, playground, ideas and the design-system pages)",
	"scrollbar-gutter": "navbar x does not move when a vertical scrollbar appears or disappears",
	"tab-aria": "tablist/tab/tabpanel wiring: aria-controls, one aria-selected, rd-tabpanel",
	"tab-keys": "ArrowRight moves to the next tab",
	"tab-deeplink": "each tab sets its address (?tab= or a hash) that opens that tab on load",
	"tab-history": "each tab change adds exactly one history entry; Back restores the previous tab",
	"tab-rail": "every tab panel has the shared rd-toc",
	"tab-width": "in every tab from 768px up, the panel, its tab body and their sections span the navbar card's edges; a nested section spans its parent",
	"typography-scale": "h1/h2/h3/p/td font size, line height and weight match the template (compact)",
	"nav-card": "navbar card position and size equal the main site's",
	"nav-links": "navbar link positions equal the main site's",
	"nav-style": "navbar link font size, weight and family equal the main site's",
	"content-width": "content width equals the main post column (or the navbar card when wide)",
	"content-align": "content left edge equals the main post column (or the navbar card when wide)",
	"footer-box": "license card width, left edge and corner radius equal the site footer card",
	"footer-type": "license card text size and colour equal the site footer text",
	"footer-gap": "space between content and the footer card equals the main site's",
	surface: "page background and navbar card background equal the main site's (tokens)",
	"rail-presence": "the contents rail appears at the same widths as on the main post",
	"rail-geometry": "rail x offset from the navbar card, width and top offset equal the main site's",
	"rail-type": "rail link font size and colour equal the main site's",
	"rail-indicator": "active rail indicator has the same style as the main site's",
	"rail-highlight": "every heading in view is highlighted in the rail, as on the main post",
	"prose-type": "prose h2/h3/p/a/td size, line height, weight and colour equal the main post's",
	"button": "every .rd-btn is a keyboard-operable <button> (or role=button), never a div/span",
	"filter": "every .rd-filter is a keyboard-operable <button> (or role=button) with aria-pressed",
	"field": "every .rd-input / .rd-select is associated with a label (for=, aria-label, aria-labelledby, or a wrapping <label>)",
	"choice": "every .rd-choice wraps a native <input> (radio/checkbox), so it is keyboard-operable",
	"stepper": "every .rd-stepper has a minus and a plus <button> and a value region",
	"fullscreen-toggle": "every data-rd=fullscreen container has a [data-rd-fullscreen-toggle] button with aria-pressed and is focusable (wheel-only-after-focus)",
};

const pages = standalonePages({ sections: SECTIONS, depth: 3 });
// Accessibility (axe) runs on every standalone page — reports, playground, ideas and the design-system
// pages — at 375 and 1440, light and dark. Both sets come from the shared page registry, so a new page is
// covered without editing this file. template.html is a scaffold source (placeholder content, not a shipped
// page), so it is excluded.
const a11yPages = [...pages, ...standalonePages({ sections: ["design-system"], exclude: ["template.html"] })];
const urlOf = (rel) => `/${rel.replace(/index\.html$/, "").split(path.sep).join("/")}`;
const norm = (s) => s.replace(/\s+/g, "");
const CANON = norm(readFileSync(path.join(PUBLIC, "design-system/research.css"), "utf8"));
const CANON_HASH = createHash("sha256").update(CANON).digest("hex").slice(0, 12);
const ownerFor = (page) => (page.startsWith("/research/ai-economy") ? "EcoSimulation" : /\/brev-/.test(page) ? "Brev" : "site");

function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	try {
		const p = chromium.executablePath();
		if (existsSync(p)) return p;
	} catch {}
	const cache = path.join(homedir(), "Library/Caches/ms-playwright");
	if (existsSync(cache)) {
		for (const d of readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell")).sort().reverse()) {
			for (const sub of readdirSync(path.join(cache, d))) {
				const exe = path.join(cache, d, sub, "chrome-headless-shell");
				if (existsSync(exe)) return exe;
			}
		}
	}
	return undefined;
}

const server = createServer((req, res) => {
	let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
	if (p.endsWith("/")) p += "index.html";
	const file = path.join(DIST, path.normalize(p));
	if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
		res.statusCode = 404;
		return res.end("not found");
	}
	res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const origin = new URL(base).origin;

// ---- Baseline, escape hatches, source-level rules --------------------------------------------------------------------
const failures = [];
const warnings = [];
const baselineFile = JSON.parse(readFileSync(BASELINE, "utf8"));
const baseline = baselineFile.entries;
for (const e of baseline) {
	if (!RULES[e.rule]) failures.push(`baseline: unknown rule "${e.rule}" for ${e.page}`);
	if (!OWNERS.includes(e.owner)) failures.push(`baseline: ${e.page} ${e.rule} owner "${e.owner}" must be one of ${OWNERS.join(", ")}`);
	if (!e.reason || e.reason.length < 12 || /^triage:/i.test(e.reason)) failures.push(`baseline: ${e.page} ${e.rule} needs a real reason (not a triage placeholder)`);
}
const found = new Map(); // "page|rule" -> messages
const add = (page, rule, msg) => {
	const k = `${page}|${rule}`;
	if (!found.has(k)) found.set(k, []);
	found.get(k).push(msg);
};

// bundle-fresh (repo-level): the committed generated files must equal a fresh build of the sources.
// A stale bundle means someone edited src/design-system/ without running `pnpm build:design-system`.
for (const problem of (await checkFresh()).problems) failures.push(`bundle-fresh: ${problem}`);
const allowedBy = new Map();
const allowed = (rel) => {
	const src = readFileSync(path.join(PUBLIC, rel), "utf8");
	const set = new Set();
	for (const [, content] of src.matchAll(/<meta[^>]+name=["']ds-allow["'][^>]+content=["']([^"']+)["']/gi)) {
		const [rule, reason] = content.split(/:(.*)/s);
		if (!RULES[rule?.trim()]) failures.push(`${urlOf(rel)}: ds-allow names unknown rule "${rule}"`);
		else if (!reason?.trim()) failures.push(`${urlOf(rel)}: ds-allow "${rule}" needs a reason after the colon`);
		else set.add(rule.trim());
	}
	allowedBy.set(urlOf(rel), set);
	return set;
};
for (const rel of pages) {
	const page = urlOf(rel);
	const src = readFileSync(path.join(PUBLIC, rel), "utf8");
	const ok = allowed(rel);
	src.split("\n").forEach((line, i) => {
		if (/\bmac-mini|\/Users\/|\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(line) && !ok.has("forbidden-strings")) add(page, "forbidden-strings", `line ${i + 1}: ${line.trim().slice(0, 90)}`);
	});
	// Every class attribute that uses rd-container--wide needs a comment just before it, saying why.
	for (const m of src.matchAll(/class=["'][^"']*\brd-container--wide\b/g)) {
		const before = src.slice(Math.max(0, m.index - 400), m.index);
		if (!ok.has("container-comment") && !/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//.test(before)) {
			add(page, "container-comment", "rd-container--wide used with no comment within 400 chars before it (say why it needs the navbar width)");
		}
	}
	if (!/<meta[^>]+name=["']ds-contract["']/i.test(src)) warnings.push(`${page}: no <meta name="ds-contract"> version marker (optional for now)`);
	const cssBytes = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].reduce((n, m) => n + m[1].length, 0);
	if (cssBytes > CSS_BUDGET) warnings.push(`${page}: inline <style> is ${Math.round(cssBytes / 1000)} KB (budget ${CSS_BUDGET / 1000} KB)`);
	// bundle-linked (warning): a page that inlines the design system carries a frozen copy that goes
	// stale when the bundle changes. Link the bundle (/design-system/rd.css) instead of inlining it.
	// Signal: the token *definitions* (not just var() usage) appear in an inline <style>.
	const inlinesBundle = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].some((m) => /--rd-page-bg\s*:/.test(m[1]));
	if (inlinesBundle) warnings.push(`${page}: [bundle-linked] inlines the design system; link /design-system/rd.css instead so it stays current`);
}

// ---- Browser helpers ----------------------------------------------------------------------------------------------------
// Classic scrollbars: headless Chrome hides them by default, which would make the scrollbar-gutter rule blind.
const browser = await chromium.launch({ executablePath: findChrome(), ignoreDefaultArgs: ["--hide-scrollbars"] });
// One context per page visit: fixed viewport, stored theme, no animations, every non-origin request blocked and recorded.
const newCtx = async (vp, theme) => {
	const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce", colorScheme: "light" });
	const external = [];
	const errors = [];
	await ctx.addInitScript((t) => {
		try {
			localStorage.setItem("theme", t);
		} catch {}
	}, theme);
	await ctx.route("**/*", (route) => {
		const u = new URL(route.request().url());
		if (u.origin === origin || u.protocol === "data:" || u.protocol === "about:") return route.continue();
		external.push(route.request().url().slice(0, 100));
		return route.abort();
	});
	ctx.on("page", (p) => {
		p.on("console", (m) => {
			if (m.type() === "error") errors.push(m.text().slice(0, 120));
		});
		p.on("pageerror", (e) => errors.push(`uncaught: ${e.message.slice(0, 120)}`));
	});
	return { ctx, external, errors };
};
const open = async (ctx, urlPath) => {
	const page = await ctx.newPage();
	await page.goto(base + urlPath, { waitUntil: "load" });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForFunction(() => document.readyState === "complete" && (document.querySelector("#navbar") || document.querySelector("div[data-site-navbar]")?.shadowRoot?.querySelector("header")));
	await page.addStyleTag({ content: "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}" });
	await page.evaluate(() => document.getAnimations?.().forEach((a) => a.finish()));
	await page.waitForTimeout(150);
	return page;
};

// ---- Page-side probes (self-contained: serialised into the page) ----------------------------------------------------------
const probeStructure = (canon) => {
	const norm = (x) => x.replace(/\s+/g, "");
	const styles = [...document.querySelectorAll("style")].map((s) => s.textContent || "");
	const flat = norm(styles.join(""));
	const links = [...document.querySelectorAll('link[rel~="stylesheet"]')].map((l) => l.getAttribute("href") || "");
	const kids = [...document.head.children];
	const h1 = [...document.querySelectorAll("h1")].find((h) => h.getBoundingClientRect().width > 0);
	const stamp = /· created \d{4}-\d{2}-\d{2} · updated \d{4}-\d{2}-\d{2}$/;
	const main = document.querySelector("main");
	const navCard = document.querySelector("div[data-site-navbar]")?.shadowRoot?.querySelector("header");
	const scripts = [...document.scripts].filter((s) => !s.src && !s.hasAttribute("data-site-theme")).map((s) => s.textContent).join("");
	const themeButtons = [...document.querySelectorAll("button, [role=switch], input[type=checkbox]")]
		.filter((b) => /theme|dark|light mode|colou?r scheme/i.test(`${b.getAttribute("aria-label") || ""} ${b.textContent || ""}`))
		.map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 40));
	const emoji = [];
	const walker = document.createTreeWalker(main || document.body, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if (n.parentElement?.closest("code, pre, kbd, samp, math, svg, script, style, .katex")) continue;
		if (/\p{Emoji_Presentation}/u.test(n.textContent || "")) emoji.push(n.textContent.trim().slice(0, 40));
	}
	const arrows = [...document.querySelectorAll("a, button, summary, [role=tab]")]
		.filter((el) => /[←-⇿➡⬅-⬇▶◀]/.test(el.textContent || "") && !el.closest("code, pre"))
		.map((el) => (el.textContent || "").trim().slice(0, 30));
	const uses = [...document.querySelectorAll("svg use")].map((u) => ({
		href: u.getAttribute("href") || "",
		ok: !!document.getElementById((u.getAttribute("href") || "").slice(1)),
		rd: !!u.closest("svg")?.classList.contains("rd-icon"),
	}));
	// Hand-drawn icons: a small inline svg in <main> without a <use> from the sprite.
	const handIcons = [...(main || document).querySelectorAll("svg")].filter((s) => {
		const b = s.getBoundingClientRect();
		return b.width > 0 && b.width <= 32 && !s.querySelector("use") && !s.closest("[data-ds-allow~=icon-sprite]");
	}).length;
	const colourRe = /#[0-9a-f]{3,8}(?![0-9a-z])|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/i;
	const badDecl = (text) => {
		const hits = [];
		for (const piece of text.split(/[;{}]/)) {
			const i = piece.indexOf(":");
			if (i < 0) continue;
			const prop = piece.slice(0, i).trim().toLowerCase();
			const val = piece.slice(i + 1);
			if (!prop || prop.startsWith("--") || prop.startsWith("@") || /^(fill|stroke|stop-color|flood-color|lighting-color)/.test(prop)) continue;
			if (colourRe.test(val) && !val.includes("var(--rd-")) hits.push(`${prop}:${val.trim().slice(0, 40)}`);
		}
		return hits;
	};
	const colourHits = [];
	for (const s of document.querySelectorAll("style")) {
		const t = norm(s.textContent || "");
		colourHits.push(...badDecl(t.includes(canon) ? t.split(canon).join("") : t));
	}
	for (const el of document.querySelectorAll("[style]")) {
		if (el.closest("svg") || el.closest("[data-ds-allow~=colour-tokens]")) continue;
		colourHits.push(...badDecl(el.getAttribute("style") || ""));
	}
	const foreignFace = styles.filter((s) => s.includes("@font-face") && !s.includes("RobotoNav") && !norm(s).includes(canon)).length;
	const tpl = (sel) => {
		const el = document.querySelector(`main ${sel}`);
		if (!el) return null;
		const st = getComputedStyle(el);
		return { fs: parseFloat(st.fontSize), lh: parseFloat(st.lineHeight) || 0, fw: st.fontWeight };
	};
	return {
		headOrder: kids[0]?.matches("meta[charset]") && kids[1]?.matches('meta[name="viewport"]') ? "ok" : kids.slice(0, 2).map((k) => k.outerHTML.slice(0, 40)).join(" | "),
		titleOk: stamp.test(document.title) ? "ok" : document.title,
		h1Ok: h1 && stamp.test(h1.textContent.trim()) ? "ok" : (h1?.textContent || "no visible h1").trim(),
		cssInline: flat.includes(canon) || links.some((h) => /(^|\/)design-system\/(research|rd)\.css(\?|$)/.test(h)),
		bodyRd: document.body.classList.contains("rd-body"),
		mainClass: !!main && ["rd-container", "rd-container--wide", "rd-tabbed"].some((c) => main.classList.contains(c)),
		mainWide: !!main && main.classList.contains("rd-container") && !main.classList.contains("rd-container--wide"),
		mainW: main ? main.getBoundingClientRect().width : 0,
		mainMax: main ? getComputedStyle(main).maxWidth : "",
		navW: navCard ? navCard.getBoundingClientRect().width : 0,
		density: document.documentElement.getAttribute("data-density"),
		prefersScheme: /prefers-color-scheme/.test(flat) || /prefers-color-scheme/.test(scripts),
		themeButtons,
		emoji,
		arrows,
		uses,
		handIcons,
		colourHits: colourHits.slice(0, 6),
		colourCount: colourHits.length,
		foreignFace,
		iframes: document.querySelectorAll("iframe").length,
		lightFooters: document.querySelectorAll("footer").length,
		navCount: document.querySelectorAll("div[data-site-navbar]").length,
		licCount: document.querySelectorAll("div[data-site-license]").length,
		crumbBands: document.querySelectorAll("[data-site-breadcrumb]").length,
		strayCrumbs: [...document.querySelectorAll('.rd-breadcrumb, nav[aria-label="Breadcrumb"]')].filter((n) => !n.closest("[data-site-breadcrumb]")).length,
		// Buttons: every .rd-btn must be a real, keyboard-operable control (a <button>, or role=button).
		// A div/span styled as a button is not focusable and breaks keyboard use.
		btns: [...document.querySelectorAll(".rd-btn")].map((el) => ({
			operable: el.matches("button") || el.getAttribute("role") === "button",
		})),
		// Filters: every .rd-filter is a keyboard-operable toggle with an explicit aria-pressed state.
		filters: [...document.querySelectorAll(".rd-filter")].map((el) => ({
			operable: el.matches("button") || el.getAttribute("role") === "button",
			pressed: el.hasAttribute("aria-pressed"),
		})),
		// Fields: every .rd-input / .rd-select must be associated with a label — a <label for>,
		// aria-label, aria-labelledby, or a wrapping <label>. An unlabelled control is unusable by
		// screen readers and most users.
		fields: [...document.querySelectorAll(".rd-input, .rd-select")].map((el) => {
			const id = el.id;
			const labelledBy = el.getAttribute("aria-labelledby");
			const hasFor = id && !!document.querySelector(`label[for="${CSS.escape(id)}"]`);
			return {
				labelled:
					hasFor ||
					!!el.getAttribute("aria-label") ||
					!!labelledBy ||
					!!el.closest("label"),
			};
		}),
		// Choices: every .rd-choice wraps a native <input> (radio/checkbox). A div styled as a
		// choice without a real input is not keyboard-operable and breaks screen readers.
		choices: [...document.querySelectorAll(".rd-choice")].map((el) => ({
			hasInput: !!el.querySelector("input[type=radio], input[type=checkbox]"),
		})),
		// Steppers: every .rd-stepper has a minus and a plus button (two keyboard-operable
		// controls) and a value region. A stepper missing a button or its value is broken.
		steppers: [...document.querySelectorAll(".rd-stepper")].map((el) => ({
			buttons: el.querySelectorAll("button").length,
			hasValue: !!el.querySelector(".rd-stepper__value"),
		})),
		// Fields: every .rd-input / .rd-select must be associated with a label — a <label for>,
		// aria-label, aria-labelledby, or a wrapping <label>. An unlabelled control is unusable by
		// screen readers and most users.
		fields: [...document.querySelectorAll(".rd-input, .rd-select")].map((el) => {
			const id = el.id;
			const labelledBy = el.getAttribute("aria-labelledby");
			const hasFor = id && !!document.querySelector(`label[for="${CSS.escape(id)}"]`);
			return {
				labelled:
					hasFor ||
					!!el.getAttribute("aria-label") ||
					!!labelledBy ||
					!!el.closest("label"),
			};
		}),
		// Fullscreen: each data-rd=fullscreen container must carry an operable, accessible toggle
		// (a [data-rd-fullscreen-toggle] button with aria-pressed). The container's focusability
		// (tabindex=-1, for wheel-only-after-focus) is added by rd.js at mount, so it is not checked here.
		fullscreen: [...document.querySelectorAll('[data-rd="fullscreen"]')].map((el) => {
			const t = el.querySelector("[data-rd-fullscreen-toggle]");
			return {
				hasToggle: !!t,
				isButton: t?.matches("button") || t?.getAttribute("role") === "button",
				ariaPressed: t?.hasAttribute("aria-pressed"),
			};
		}),
		tpl: { h1: tpl("h1"), h2: tpl("h2"), h3: tpl("h3"), p: tpl("p"), td: tpl("td") },
	};
};

const probeOverflow = () => ({ sw: document.documentElement.scrollWidth - document.documentElement.clientWidth });

const probeTapTargets = () =>
	[...document.querySelectorAll("main a, main button, main summary, main input, main select, main textarea, main [role=tab]")]
		.filter((el) => {
			const b = el.getBoundingClientRect();
			return b.width > 0 && b.height > 0 && getComputedStyle(el).display !== "inline" && !el.closest("[data-ds-allow~=tap-target]");
		})
		.map((el) => {
			const b = el.getBoundingClientRect();
			return { t: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30), w: Math.round(b.width), h: Math.round(b.height) };
		})
		.filter((x) => x.w < 24 || x.h < 24)
		.slice(0, 4);

// Navbar x with and without a vertical scrollbar (overflow hidden removes it): must not move.
const probeScrollbar = () => {
	const card = document.querySelector("div[data-site-navbar]")?.shadowRoot?.querySelector("header") || document.querySelector("#navbar > div:nth-child(2)");
	const x = () => Math.round(card.getBoundingClientRect().left * 10) / 10;
	const scrollable = document.documentElement.scrollHeight > innerHeight + 1;
	const withBar = x();
	const prev = document.documentElement.style.overflow;
	document.documentElement.style.overflow = "hidden";
	const withoutBar = x();
	document.documentElement.style.overflow = prev;
	return { scrollable, withBar, withoutBar };
};

// Layout and chrome of the main post (ref) or a standalone page (cand). Same keys on both sides.
const probeChrome = (isRef) => {
	const rect = (el) => {
		if (!el) return null;
		const b = el.getBoundingClientRect();
		return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height, r: b.right + scrollX, b: b.bottom + scrollY };
	};
	const vis = (el) => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
	const cv = document.createElement("canvas");
	cv.width = cv.height = 1;
	const cx = cv.getContext("2d", { willReadFrequently: true });
	const rgb = (c) => {
		cx.clearRect(0, 0, 1, 1);
		cx.fillStyle = c;
		cx.fillRect(0, 0, 1, 1);
		const d = cx.getImageData(0, 0, 1, 1).data;
		return [d[0], d[1], d[2], Math.round((d[3] / 255) * 100) / 100];
	};
	const family = (s) => s.split(",")[0].trim().toLowerCase().replace("robotonav", "roboto");
	const typo = (el) => {
		if (!el) return null;
		const s = getComputedStyle(el);
		return { fs: parseFloat(s.fontSize), lh: parseFloat(s.lineHeight) || 0, fw: s.fontWeight, c: rgb(s.color) };
	};
	const bg = (() => {
		for (const el of [document.body, document.documentElement]) {
			const c = rgb(getComputedStyle(el).backgroundColor);
			if (c[3] > 0) return c;
		}
		return [255, 255, 255, 1];
	})();
	const mainNav = document.querySelector("#navbar");
	const shadowHeader = document.querySelector("div[data-site-navbar]")?.shadowRoot?.querySelector("header");
	const navCard = isRef ? mainNav?.querySelector(":scope > div:nth-child(2)") : shadowHeader;
	const navRect = rect(navCard);
	const inCard = (a) => {
		const b = a.getBoundingClientRect();
		return navRect && b.left >= navRect.x - 1 && b.right <= navRect.r + 1 && b.top >= navRect.y - 1 && b.bottom <= navRect.b + 1;
	};
	const navA = navCard ? [...navCard.querySelectorAll("a")].filter((a) => vis(a) && inCard(a)).slice(0, 7) : [];
	const navLinks = navA.map((a) => ({ x: Math.round(a.getBoundingClientRect().left - navRect.x), fs: parseFloat(getComputedStyle(a).fontSize), fw: getComputedStyle(a).fontWeight }));
	const navBg = navCard ? rgb(getComputedStyle(navCard).backgroundColor) : null;
	const content = isRef ? document.querySelector("#content-wrapper") : document.querySelector("main");
	const contentRect = rect(content);
	const siteFoot = isRef ? [...document.querySelectorAll(".footer")].find(vis)?.querySelector(".rounded-2xl") : null;
	const lic = document.querySelector("div[data-site-license]")?.shadowRoot?.querySelector("footer");
	const footEl = isRef ? siteFoot : lic;
	const footRect = rect(footEl);
	const footText = isRef ? footEl?.querySelector(".text-sm") : footEl?.querySelector("p");
	const footTypo = footText ? { fs: parseFloat(getComputedStyle(footText).fontSize), c: rgb(getComputedStyle(footText).color) } : null;
	const footRadius = footEl ? parseFloat(getComputedStyle(footEl).borderTopLeftRadius) : null;
	const footGap = footRect && contentRect ? Math.round(footRect.y - contentRect.b) : null;
	const rail = isRef ? [...document.querySelectorAll("table-of-contents")].find(vis) : [...document.querySelectorAll(".rd-toc")].find(vis);
	// Geometry box: the main post's fixed #toc-inner-wrapper and the standalone .rd-toc both pin their top to the
	// navbar bottom, so they compare. The inner table-of-contents sits 32px lower (a top spacer) and would not.
	const railBox = isRef ? document.querySelector("#toc-inner-wrapper") ?? rail : rail;
	const railEntries = rail ? [...rail.querySelectorAll(isRef ? ":scope > a" : "a")] : [];
	// The active-heading indicator is a dashed box on both sides (#active-indicator / .rd-toc__indicator), not a
	// border on the active link. Read its border-left style + width on each side so the two values have the same shape.
	const railIndicator = rail
		? isRef
			? (() => {
					const i = rail.querySelector("#active-indicator");
					return i ? `${getComputedStyle(i).borderLeftStyle} ${getComputedStyle(i).borderLeftWidth}` : "none";
				})()
			: (() => {
					const i = rail.querySelector(".rd-toc__indicator");
					return i ? `${getComputedStyle(i).borderLeftStyle} ${getComputedStyle(i).borderLeftWidth}` : "none";
				})()
		: null;
	const railText = railEntries[0] ? (isRef ? railEntries[0].querySelector("div") : railEntries[0]) : null;
	const railTypo = railText ? { fs: parseFloat(getComputedStyle(railText).fontSize), c: rgb(getComputedStyle(railText).color) } : null;
	const railRect = rect(railBox);
	const railOff = railRect && navRect ? { x: Math.round(railRect.x - navRect.r), w: Math.round(railRect.w), y: Math.round(railRect.y - navRect.b) } : null;
	const prose = isRef ? [...document.querySelectorAll(".prose")].find((e) => e.querySelector("h2")) : [...document.querySelectorAll(".rd-prose")].find((e) => e.querySelector("h2"));
	const proseTypo = prose
		? { h2: typo(prose.querySelector("h2")), h3: typo(prose.querySelector("h3")), p: typo(prose.querySelector("p")), a: typo(prose.querySelector("p a")), td: typo(prose.querySelector("td")) }
		: null;
	return {
		navRect,
		navLinks,
		navBg,
		navFamily: navA[0] ? family(getComputedStyle(navA[0]).fontFamily) : null,
		contentRect,
		footRect,
		footRadius,
		footTypo,
		footGap,
		bg,
		railPresent: !!rail,
		railOff,
		railTypo,
		railIndicator,
		proseTypo,
	};
};

// Scroll the page and report the rail's highlight at the position with the most headings in view (the main post's rule).
const probeHighlight = async (page, isRef) => {
	const steps = await page.evaluate(() => Math.max(1, Math.ceil((document.documentElement.scrollHeight - innerHeight) / 300)));
	let best = null;
	for (let s = 0; s <= Math.min(steps, 25); s++) {
		const res = await page.evaluate(
			async ([y, isRef]) => {
				scrollTo(0, y);
				await new Promise((r) => setTimeout(r, 120));
				const rail = isRef ? [...document.querySelectorAll("table-of-contents")].find((e) => e.getBoundingClientRect().width > 0) : [...document.querySelectorAll(".rd-toc")].find((e) => e.getBoundingClientRect().width > 0);
				if (!rail) return null;
				const entries = [...rail.querySelectorAll(isRef ? ":scope > a" : "a")];
				const inView = entries.filter((a) => {
					const h = document.getElementById(decodeURIComponent((a.getAttribute("href") || "").slice(1)));
					if (!h) return false;
					const b = h.getBoundingClientRect();
					return b.top >= 0 && b.top < innerHeight;
				});
				const lit = entries.filter((a) => (isRef ? a.classList.contains("visible") : a.getAttribute("aria-current") === "location"));
				return { inView: inView.map((a) => a.getAttribute("href")), lit: lit.map((a) => a.getAttribute("href")) };
			},
			[s * 300, isRef],
		);
		if (res && res.inView.length > (best?.inView ?? 0)) {
			best = { same: res.inView.length === res.lit.length && res.inView.every((h) => res.lit.includes(h)), inView: res.inView.length, lit: res.lit.length };
		}
	}
	return best;
};

// ---- Reference: the main post, per width x theme, in this same run -----------------------------------------------------------
const ref = {};
for (const w of WIDTHS) for (const t of THEMES) {
	const { ctx } = await newCtx({ width: w, height: DESKTOP_H }, t);
	const page = await open(ctx, REF);
	ref[`${w}-${t}`] = await page.evaluate(probeChrome, true);
	ref[`${w}-${t}`].hl = await probeHighlight(page, true);
	await ctx.close();
}
{
	const { ctx } = await newCtx({ width: 1440, height: DESKTOP_H }, "light");
	const page = await open(ctx, TEMPLATE);
	ref.template = (await page.evaluate(probeStructure, CANON)).tpl;
	await ctx.close();
}

// ---- Compare helpers -------------------------------------------------------------------------------------------------------
const TOL = { px: 1, rail: 2, fs: 0.5, lh: 1, rgb: 8, alpha: 0.1, surface: 3, gap: 8 };
const rgbDiff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const colourSame = (a, b) => rgbDiff(a, b) <= TOL.rgb && Math.abs(a[3] - b[3]) <= TOL.alpha;
const fmtC = (c) => (c ? `rgba(${c.join(",")})` : "none");
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;
const r1 = (v) => (v == null ? "missing" : `${Math.round(v * 10) / 10}px`);

function compareAt(page, w, t, c, r) {
	const bad = (rule, msg) => {
		if (!allowedBy.get(page)?.has(rule)) add(page, rule, `@${w} ${t}: ${msg}`); // a page's ds-allow covers the parity rules too
	};
	const cmp = (rule, label, a, b, tol) => {
		if (!near(a, b, tol)) bad(rule, `${label} ${r1(b)}, main post ${r1(a)}`);
	};
	// Navbar
	if (!c.navRect || !r.navRect) bad("nav-card", "navbar card not found");
	else {
		cmp("nav-card", "navbar left", r.navRect.x, c.navRect.x, TOL.px);
		cmp("nav-card", "navbar width", r.navRect.w, c.navRect.w, TOL.px);
		cmp("nav-card", "navbar height", r.navRect.h, c.navRect.h, TOL.px);
		const sameCount = c.navLinks.length === r.navLinks.length;
		const sameX = sameCount && r.navLinks.every((l, i) => near(l.x, c.navLinks[i].x, 2));
		if (!sameX) bad("nav-links", `link x-positions [${c.navLinks.map((l) => l.x).join(",")}], main post [${r.navLinks.map((l) => l.x).join(",")}]`);
		const rf = r.navLinks[1], cf = c.navLinks[1];
		if (rf && cf && (!near(rf.fs, cf.fs, TOL.fs) || rf.fw !== cf.fw)) bad("nav-style", `link font ${cf.fs}px/${cf.fw}, main post ${rf.fs}px/${rf.fw}`);
		if (r.navFamily && c.navFamily && r.navFamily !== c.navFamily) bad("nav-style", `navbar font ${c.navFamily}, main post ${r.navFamily}`);
		if (r.navBg && c.navBg && rgbDiff(r.navBg, c.navBg) > TOL.surface) bad("surface", `navbar card background ${fmtC(c.navBg)}, main post ${fmtC(r.navBg)}`);
	}
	if (c.scroll?.scrollable && Math.abs(c.scroll.withBar - c.scroll.withoutBar) > TOL.px) bad("scrollbar-gutter", `navbar left ${c.scroll.withBar}px with a scrollbar, ${c.scroll.withoutBar}px without`);
	// Content column
	const rc = r.contentRect, cc = c.contentRect;
	if (!cc) bad("content-width", "content column not found");
	else {
		const wide = near(cc.w, c.navRect?.w, TOL.px);
		if (!wide && !near(rc.w, cc.w, TOL.px)) bad("content-width", `content width ${r1(cc.w)}, main post column ${r1(rc.w)} (or the navbar card when wide)`);
		if (!(near(rc.x, cc.x, TOL.px) || (wide && near(c.navRect?.x, cc.x, TOL.px)))) bad("content-align", `content left ${r1(cc.x)}, main post column ${r1(rc.x)} (navbar card ${r1(c.navRect?.x)})`);
	}
	// Footer card
	if (!c.footRect || !r.footRect) bad("footer-box", "license card or site footer card not found");
	else {
		cmp("footer-box", "license card left", r.footRect.x, c.footRect.x, TOL.px);
		cmp("footer-box", "license card width", r.footRect.w, c.footRect.w, TOL.px);
		cmp("footer-box", "license card corner radius", r.footRadius, c.footRadius, TOL.px);
		if (r.footTypo && c.footTypo) {
			cmp("footer-type", "license text size", r.footTypo.fs, c.footTypo.fs, TOL.fs);
			if (!colourSame(c.footTypo.c, r.footTypo.c)) bad("footer-type", `license text colour ${fmtC(c.footTypo.c)}, main post ${fmtC(r.footTypo.c)}`);
		}
		if (!near(r.footGap, c.footGap, TOL.gap)) bad("footer-gap", `gap above footer ${c.footGap}px, main post ${r.footGap}px`);
	}
	if (rgbDiff(c.bg, r.bg) > TOL.surface) bad("surface", `page background ${fmtC(c.bg)}, main post ${fmtC(r.bg)}`);
	// Contents rail
	if (c.railPresent !== r.railPresent) bad("rail-presence", `contents rail ${c.railPresent ? "shown" : "hidden"}, main post ${r.railPresent ? "shown" : "hidden"}`);
	else if (r.railPresent) {
		if (r.railOff && c.railOff) {
			cmp("rail-geometry", "rail x offset from navbar card", r.railOff.x, c.railOff.x, TOL.rail);
			cmp("rail-geometry", "rail width", r.railOff.w, c.railOff.w, TOL.rail);
			cmp("rail-geometry", "rail top offset from navbar", r.railOff.y, c.railOff.y, 4);
		}
		if (r.railTypo && c.railTypo) {
			cmp("rail-type", "rail text size", r.railTypo.fs, c.railTypo.fs, TOL.fs);
			if (!colourSame(c.railTypo.c, r.railTypo.c)) bad("rail-type", `rail text colour ${fmtC(c.railTypo.c)}, main post ${fmtC(r.railTypo.c)}`);
		}
		if (r.railIndicator !== c.railIndicator) bad("rail-indicator", `active indicator "${c.railIndicator}", main post "${r.railIndicator}"`);
	}
	// Prose
	if (r.proseTypo && c.proseTypo) {
		for (const k of ["h2", "h3", "p", "a", "td"]) {
			const a = r.proseTypo[k], b = c.proseTypo[k];
			if (!a || !b) continue;
			if (!near(a.fs, b.fs, TOL.fs)) bad("prose-type", `${k} size ${b.fs}px, main post ${a.fs}px`);
			if (!near(a.lh, b.lh, TOL.lh)) bad("prose-type", `${k} line height ${b.lh}px, main post ${a.lh}px`);
			if (a.fw !== b.fw) bad("prose-type", `${k} weight ${b.fw}, main post ${a.fw}`);
			if (!colourSame(b.c, a.c)) bad("prose-type", `${k} colour ${fmtC(b.c)}, main post ${fmtC(a.c)}`);
		}
	}
	// Highlight: the same rule as the main TOC.
	if (c.railPresent && c.hl && r.hl && !c.hl.same) bad("rail-highlight", `${c.hl.lit} of ${c.hl.inView} headings in view are highlighted in the rail (main post: all of them)`);
	if (c.railPresent && r.railPresent && c.hl === null) bad("rail-highlight", "no heading of the contents rail is ever in view, so the highlight could not be checked");
}

// Tab content edges (tab-width): every tab panel's blocks against the navbar card. Top level (the panel, .rd-tab__body
// and their direct section children) must sit on the card's edges; a section nested in a stacking parent must span the
// parent's content box (catches a max-width cap like 72ch on a card). Below 768px the card is full-bleed and the content
// keeps a gutter, so only 768px and up are measured.
const TAB_WIDTHS = [1440, 1280, 1024, 768];
const probeTabEdges = () => {
	const nav = document.querySelector("div[data-site-navbar]")?.shadowRoot?.querySelector("header")?.getBoundingClientRect();
	const panel = [...document.querySelectorAll(".rd-tabpanel")].find((p) => p.getBoundingClientRect().width > 0);
	if (!nav || !panel) return { issues: [nav ? "no visible .rd-tabpanel" : "navbar card not found"] };
	const SEC = "section, .section, .rd-tabsec, .rd-tab__body";
	const shown = (el) => {
		const s = getComputedStyle(el);
		return el.getBoundingClientRect().width > 0 && s.position !== "fixed" && s.position !== "absolute";
	};
	const stacking = (el) => {
		const s = getComputedStyle(el);
		return s.display === "block" || (s.display.includes("grid") && s.gridTemplateColumns.trim().split(/\s+/).length === 1) || (s.display.includes("flex") && s.flexDirection.startsWith("column"));
	};
	const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).join(".")}` : ""}`;
	const r1 = (v) => Math.round(v * 10) / 10;
	const issues = [];
	const top = [panel, ...[...panel.children].filter((k) => k.matches(SEC))];
	for (const b of panel.querySelectorAll(":scope > .rd-tab__body")) top.push(...[...b.children].filter((k) => k.matches(SEC)));
	for (const el of top.filter(shown)) {
		const b = el.getBoundingClientRect();
		if (Math.abs(b.left - nav.left) > 1 || Math.abs(b.right - nav.right) > 1) issues.push(`${name(el)} ${r1(b.left)}..${r1(b.right)}, navbar card ${r1(nav.left)}..${r1(nav.right)}`);
	}
	for (const el of [...panel.querySelectorAll(SEC)].filter((e) => !top.includes(e) && !e.closest(".rd-toc") && shown(e))) {
		const par = el.parentElement;
		if (!stacking(par)) continue;
		const ps = getComputedStyle(par), pb = par.getBoundingClientRect(), b = el.getBoundingClientRect();
		const l = pb.left + parseFloat(ps.borderLeftWidth) + parseFloat(ps.paddingLeft);
		const r = pb.right - parseFloat(ps.borderRightWidth) - parseFloat(ps.paddingRight);
		if (Math.abs(b.left - l) > 1 || Math.abs(b.right - r) > 1) issues.push(`${name(el)} ${r1(b.left)}..${r1(b.right)}, its parent ${name(par)} ${r1(l)}..${r1(r)}`);
	}
	return { issues };
};
async function tabWidthChecks(page, ok) {
	if (ok.has("tab-width")) return;
	for (const [w, t] of [...TAB_WIDTHS.map((x) => [x, "light"]), [1440, "dark"]]) {
		const { ctx } = await newCtx({ width: w, height: DESKTOP_H }, t);
		const p = await open(ctx, page);
		const tabs = p.locator("[role=tablist] [role=tab]");
		const names = await tabs.allTextContents();
		for (let i = 0; i < names.length; i++) {
			await tabs.nth(i).click();
			await p.waitForLoadState("load");
			await p.waitForTimeout(100);
			for (const m of (await p.evaluate(probeTabEdges)).issues) add(page, "tab-width", `@${w} ${t} [${names[i].trim()}]: ${m}`);
		}
		await ctx.close();
	}
}

// ---- Per page -------------------------------------------------------------------------------------------------------------
async function tabChecks(page, ok) {
	const { ctx, external } = await newCtx({ width: 1440, height: DESKTOP_H }, "light");
	const p = await open(ctx, page);
	const tabs = await p.$$("[role=tablist] [role=tab]");
	if (tabs.length) {
		// Wait for a selected tab before reading it: the tab is selected pre-paint (statically, and by
		// rd.js synchronously), but a bare $eval throws on the instant a navigation re-sync has not
		// settled. Bounded wait + a clear finding, not a crash.
		const selected = async (what) => {
			try {
				await p.waitForSelector('[role=tablist] [role=tab][aria-selected="true"]', { timeout: 3000 });
				return await p.$eval('[role=tablist] [role=tab][aria-selected="true"]', (el) => el.textContent.trim());
			} catch {
				if (!ok.has("tab-aria")) add(page, "tab-aria", `no tab is selected ${what} (bounded 3s wait)`);
				return null;
			}
		};
		const aria = await p.evaluate(() => {
			const tabsEl = [...document.querySelectorAll("[role=tablist] [role=tab]")];
			const issues = [];
			for (const t of tabsEl) {
				const id = t.getAttribute("aria-controls");
				const panel = id && document.getElementById(id);
				if (!panel) issues.push(`tab "${t.textContent.trim()}" has no aria-controls panel`);
				else if (panel.getAttribute("role") !== "tabpanel" || !panel.classList.contains("rd-tabpanel")) issues.push(`panel ${id} lacks role=tabpanel or rd-tabpanel`);
			}
			if (tabsEl.filter((t) => t.getAttribute("aria-selected") === "true").length !== 1) issues.push("not exactly one aria-selected tab");
			const panels = [...document.querySelectorAll("[role=tabpanel]:not([hidden])")];
			return { issues, noRail: panels.filter((pn) => !pn.querySelector(".rd-toc")).length };
		});
		for (const i of aria.issues) if (!ok.has("tab-aria")) add(page, "tab-aria", i);
		if (aria.noRail && !ok.has("tab-rail")) add(page, "tab-rail", `${aria.noRail} visible panel(s) without the shared rd-toc`);
		await tabs[0].focus();
		await p.keyboard.press("ArrowRight");
		await p.waitForTimeout(100);
		const movedFocus = await p.evaluate(() => document.activeElement?.getAttribute("role") === "tab" && document.activeElement !== document.querySelector("[role=tab]"));
		if (!movedFocus && !ok.has("tab-keys")) add(page, "tab-keys", "ArrowRight from the first tab did not move focus to the next tab");
		// History: click a tab that is not selected: one entry; Back restores the previous tab.
		const flags = await p.$$eval("[role=tablist] [role=tab]", (els) => els.map((e) => e.getAttribute("aria-selected") === "true"));
		const k = flags.findIndex((f) => !f);
		const before = await selected("after load");
		const h0 = await p.evaluate(() => history.length);
		await tabs[k].click();
		await p.waitForTimeout(150);
		const h1 = await p.evaluate(() => history.length);
		const hash = await p.evaluate(() => location.search + location.hash);
		if (h1 !== h0 + 1 && !ok.has("tab-history")) add(page, "tab-history", `tab click added ${h1 - h0} history entries (expected 1)`);
		if (!/[?&]tab=|#./.test(hash) && !ok.has("tab-deeplink")) add(page, "tab-deeplink", "tab click sets neither ?tab= nor a hash");
		await p.goBack();
		await p.waitForTimeout(150);
		const back = await selected("after Back");
		if (back !== before && !ok.has("tab-history")) add(page, "tab-history", `Back did not restore the previous tab ("${back}", expected "${before}")`);
		if (hash && !ok.has("tab-deeplink")) {
			const d = await newCtx({ width: 1440, height: DESKTOP_H }, "light");
			const dp = await open(d.ctx, `${page}${hash}`);
			const idx = await dp.$$eval("[role=tablist] [role=tab]", (els) => els.findIndex((e) => e.getAttribute("aria-selected") === "true"));
			if (idx !== k) add(page, "tab-deeplink", `opening ${hash} selected tab ${idx + 1}, expected ${k + 1}`);
			await d.ctx.close();
		}
	}
	await ctx.close();
	return external;
}

// Pages run in parallel: each one has its own browser contexts and only writes to `found` (synchronous).
await Promise.all(pages.map(async (rel) => {
	const page = urlOf(rel);
	const ok = allowedBy.get(page);
	// Each width x theme: chrome against the live reference. At 1440 also the structure and typography. (axe runs
	// separately, on every standalone page, at 375 and 1440 — see the accessibility pass below.)
	for (const w of WIDTHS) for (const t of THEMES) {
		const { ctx, external, errors } = await newCtx({ width: w, height: DESKTOP_H }, t);
		const p = await open(ctx, page);
		const c = await p.evaluate(probeChrome, false);
		c.hl = c.railPresent ? await probeHighlight(p, false) : null;
		c.scroll = await p.evaluate(probeScrollbar);
		compareAt(page, w, t, c, ref[`${w}-${t}`]);
		if (w === 1440) {
			const s = await p.evaluate(probeStructure, CANON);
			const checks = [
				[s.headOrder !== "ok", "head-order", `first head elements ${s.headOrder}`],
				[s.titleOk !== "ok", "title-stamp", `title "${s.titleOk}"`],
				[s.h1Ok !== "ok", "title-stamp", `visible h1 "${s.h1Ok}"`],
				[!s.cssInline, "css-canonical", `research.css not linked or inlined (expected sha ${CANON_HASH})`],
				[!s.bodyRd, "body-class", 'body lacks class "rd-body"'],
				[!s.mainClass, "container-class", "<main> has none of rd-container / rd-container--wide / rd-tabbed"],
				[s.mainClass && s.mainWide && Math.abs(s.mainW - 872) > 1, "container-width", `rd-container is ${Math.round(s.mainW)}px, expected 872px`],
				[s.mainClass && !s.mainWide && s.navW && Math.abs(s.mainW - s.navW) > 1 && s.mainMax !== "none", "container-width", `wide container ${Math.round(s.mainW)}px, navbar card ${Math.round(s.navW)}px`],
				[s.density != null && !["compact", "comfortable", "dense"].includes(s.density), "density", `data-density="${s.density}"`],
				[s.prefersScheme, "theme-owned", "prefers-color-scheme used in page CSS or script"],
				[s.themeButtons.length > 0, "theme-owned", `page has its own theme control: ${s.themeButtons.join(", ")}`],
				[s.emoji.length > 0, "icon-glyph", `emoji in text: ${s.emoji.slice(0, 3).join(" | ")}`],
				[s.arrows.length > 0, "icon-glyph", `arrow glyph used as a control: ${s.arrows.slice(0, 3).join(" | ")}`],
				[s.uses.some((u) => !u.ok), "icon-sprite", `icon <use> target missing from the sprite: ${s.uses.filter((u) => !u.ok).map((u) => u.href).slice(0, 3).join(", ")}`],
				[s.uses.some((u) => !u.rd), "icon-sprite", "svg icon without class rd-icon"],
				[s.handIcons > 0, "icon-sprite", `${s.handIcons} hand-drawn icon svg(s) in <main> (use the sprite)`],
				[s.colourCount > 0, "colour-tokens", `${s.colourCount} raw colour(s), e.g. ${s.colourHits.slice(0, 3).join(" | ")}`],
				[s.foreignFace > 0, "fonts", `${s.foreignFace} @font-face block(s) of its own`],
				[s.iframes > 0, "iframe", `${s.iframes} iframe(s)`],
				[s.lightFooters > 0, "one-footer", `${s.lightFooters} <footer> element(s) in the page (the license card is the footer)`],
				[external.length > 0, "external-requests", `${external.length} blocked request(s): ${[...new Set(external)].slice(0, 3).join(", ")}`],
				[errors.length > 0, "console-errors", errors.slice(0, 2).join(" | ")],
				[s.navCount !== 1, "injected-once", `site navbar present ${s.navCount} time(s)`],
				[s.licCount !== 1, "injected-once", `license card present ${s.licCount} time(s)`],
				[s.crumbBands !== 1, "breadcrumb", `breadcrumb band present ${s.crumbBands} time(s)`],
				[s.strayCrumbs > 0, "breadcrumb", `${s.strayCrumbs} hand-written breadcrumb(s) outside the injected band`],
				[s.btns.some((b) => !b.operable), "button", "a .rd-btn is not a keyboard-operable <button> (or role=button)"],
				[s.filters.some((f) => !f.operable), "filter", "a .rd-filter is not a keyboard-operable <button> (or role=button)"],
				[s.filters.some((f) => f.operable && !f.pressed), "filter", "a .rd-filter lacks aria-pressed"],
				[s.fields.some((f) => !f.labelled), "field", "a .rd-input / .rd-select has no associated label (for=, aria-label, aria-labelledby, or a wrapping <label>)"],
				[s.choices.some((c) => !c.hasInput), "choice", "a .rd-choice does not wrap a native <input> (radio/checkbox)"],
				[s.steppers.some((s) => s.buttons < 2), "stepper", "a .rd-stepper has fewer than two <button> controls (minus and plus)"],
				[s.steppers.some((s) => !s.hasValue), "stepper", "a .rd-stepper has no .rd-stepper__value region"],
				[s.fullscreen.some((f) => !f.hasToggle), "fullscreen-toggle", `a data-rd=fullscreen container has no [data-rd-fullscreen-toggle]`],
				[s.fullscreen.some((f) => f.hasToggle && !f.isButton), "fullscreen-toggle", "a fullscreen toggle is not a button (use <button> or role=button)"],
				[s.fullscreen.some((f) => f.hasToggle && !f.ariaPressed), "fullscreen-toggle", "a fullscreen toggle lacks aria-pressed"],
			];
			for (const [hit, rule, msg] of checks) if (hit && !ok.has(rule)) add(page, rule, msg);
			if (!ok.has("typography-scale")) {
				for (const k of ["h1", "h2", "h3", "p", "td"]) {
					const a = ref.template[k], b = s.tpl[k];
					if (a && b && (!near(a.fs, b.fs, TOL.fs) || !near(a.lh, b.lh, TOL.lh) || a.fw !== b.fw)) {
						add(page, "typography-scale", `@1440 ${t}: ${k} ${b.fs}px/${b.lh}px ${b.fw}, template ${a.fs}px/${a.lh}px ${a.fw}`);
					}
				}
			}
		}
		await ctx.close();
	}
	// Mobile: overflow and tap targets.
	{
		const { ctx } = await newCtx(MOBILE, "light");
		const p = await open(ctx, page);
		const o = await p.evaluate(probeOverflow);
		if (o.sw > 1 && !ok.has("overflow")) add(page, "overflow", `@375: scrolls horizontally by ${o.sw}px`);
		const taps = await p.evaluate(probeTapTargets);
		if (taps.length && !ok.has("tap-target")) add(page, "tap-target", `@375: ${taps.map((x) => `"${x.t}" ${x.w}x${x.h}`).join(", ")}`);
		await ctx.close();
	}
	await tabChecks(page, ok);
	await tabWidthChecks(page, ok);
}));

// ---- Accessibility: axe on every standalone page at 375 and 1440, light and dark ------------------------------------
// The conformance loop above only reaches the report/experiment/idea pages and only ran axe at 1440. This pass
// closes the two blind spots: it also runs axe at 375, and it covers the design-system guide page too. Pages are
// discovered from the shared page registry (a11yPages), not a hardcoded list, so a new page is covered without editing this file.
await Promise.all(a11yPages.map(async (rel) => {
	const page = urlOf(rel);
	const ok = allowedBy.get(page) ?? new Set();
	for (const w of [375, 1440]) for (const t of THEMES) {
		const { ctx } = await newCtx({ width: w, height: DESKTOP_H }, t);
		const p = await open(ctx, page);
		if (!ok.has("axe")) {
			await p.addScriptTag({ path: path.resolve("node_modules/axe-core/axe.min.js") });
			const v = await p.evaluate(async () => {
				const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, resultTypes: ["violations"] });
				return r.violations.map((x) => `${x.id} (${x.impact}) on ${x.nodes.length} node(s)`);
			});
			for (const x of v) add(page, "axe", `@${w} ${t}: ${x}`);
		}
		await ctx.close();
	}
}));
await browser.close();
server.close();

// ---- Baseline reconciliation ------------------------------------------------------------------------------------------------
if (UPDATE) {
	const keep = baseline.filter((e) => found.has(`${e.page}|${e.rule}`));
	const added = [];
	for (const key of found.keys()) {
		const [page, rule] = key.split("|");
		if (!keep.some((e) => e.page === page && e.rule === rule)) {
			keep.push({ page, rule, owner: ownerFor(page), reason: "triage: describe why this is accepted" });
			added.push(`${page} [${rule}]`);
		}
	}
	keep.sort((a, b) => (a.owner + a.page + a.rule).localeCompare(b.owner + b.page + b.rule));
	writeFileSync(BASELINE, `${JSON.stringify({ ...baselineFile, entries: keep }, null, "\t")}\n`);
	console.log(`baseline updated: ${keep.length} entries, ${added.length} added (fill in their reasons), ${baseline.length - (keep.length - added.length)} removed.`);
	if (added.length) console.log(added.map((a) => ` + ${a}`).join("\n"));
	process.exit(0);
}
const used = new Set();
for (const [key, msgs] of found) {
	const [page, rule] = key.split("|");
	if (baseline.some((e) => e.page === page && e.rule === rule)) {
		used.add(key);
		continue;
	}
	failures.push(`${page} [${rule}] ${msgs.length} violation(s): ${msgs.slice(0, 2).join("; ")}${msgs.length > 2 ? " ..." : ""}`);
}
for (const e of baseline) {
	if (!used.has(`${e.page}|${e.rule}`)) failures.push(`baseline entry no longer fires, remove it: ${e.page} [${e.rule}] (${e.owner})`);
}
for (const w of warnings) console.log(`warn: ${w}`);
if (failures.length) {
	console.error(`design-system check FAILED (${failures.length}):\n - ${failures.join("\n - ")}`);
	process.exit(1);
}
console.log(`design-system check passed: ${pages.length} page(s), ${WIDTHS.length} widths x ${THEMES.length} themes + mobile; ${used.size} baselined finding(s).`);
