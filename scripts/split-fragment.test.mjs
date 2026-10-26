// split-fragment: a clean page passes check:export; a dirty page writes the fragment and reports the
// non-convertible parts (inline styles, executable scripts, emoji). Run: pnpm test:split-fragment
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { split } from "./split-fragment.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// A clean tabbed page: chrome (hero, tab bar, rails, sprite) + two tabs, no dirty elements.
const CLEAN = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<title>A clean fixture page · created 2026-10-20 · updated 2026-10-21</title>
<meta name="description" content="A minimal clean page.">
<link rel="stylesheet" href="/design-system/research.css">
<script type="module" src="/design-system/rd.js"></script>
<style>
.clean-fig { margin: var(--rd-gap-block) 0; }
.clean-note { color: var(--rd-text-muted); }
</style>
</head>
<body class="rd-body">
<!-- lucide-sprite:start -->
<svg style="display:none" aria-hidden="true"><symbol id="i-file-text" viewBox="0 0 24 24"><path d="M6 22"/></symbol></svg>
<!-- lucide-sprite:end -->
<nav class="rd-expnav" role="tablist" data-rd="tabs">
<a role="tab" id="tab-overview" href="?tab=overview"><svg class="rd-icon"><use href="#i-file-text"/></svg>Overview</a>
</nav>
<main class="rd-tabbed rd-container rd-prose">
<header class="rd-hero">
  <p class="rd-eyebrow">Idea</p>
  <h1>A clean fixture page <span class="rd-stamp">· created 2026-10-20 · updated 2026-10-21</span></h1>
  <p class="rd-hero__lede">A minimal page.</p>
</header>
<div class="rd-tabpanel rd-with-toc" id="overview" role="tabpanel">
  <nav class="rd-toc" aria-label="On this page" data-rd="rail"><ol><li><a href="#intro">Intro</a></li></ol></nav>
  <div class="rd-tab__body">
  <section class="rd-tabsec" id="intro"><h2 id="intro-h">Intro</h2><p>Body text.</p></section>
  </div>
</div>
</main>
</body>
</html>`;

// A dirty page: same chrome, plus an inline style, an executable script and an emoji icon.
const DIRTY = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<title>A dirty fixture page · created 2026-10-20 · updated 2026-10-21</title>
<meta name="description" content="A page with dirty elements.">
<link rel="stylesheet" href="/design-system/research.css">
<script type="module" src="/design-system/rd.js"></script>
<style>
.dirty-note { color: var(--rd-text-muted); }
</style>
</head>
<body class="rd-body">
<nav class="rd-expnav" role="tablist" data-rd="tabs">
<a role="tab" id="tab-overview" href="?tab=overview">Overview</a>
</nav>
<main class="rd-tabbed rd-container rd-prose">
<header class="rd-hero">
  <h1>A dirty fixture page <span class="rd-stamp">· created 2026-10-20 · updated 2026-10-21</span></h1>
</header>
<div class="rd-tabpanel rd-with-toc" id="overview" role="tabpanel">
  <div class="rd-tab__body">
  <section class="rd-tabsec" id="intro"><h2>Intro</h2>
    <svg viewBox="0 0 10 10"><rect style="fill:currentColor" width="10" height="10"/></svg>
    <p>Done ✅</p>
  </section>
  </div>
</div>
<script>
// The app logic.
(function () { document.querySelector('.dirty-note').addEventListener('click', function () {}); })();
</script>
</main>
</body>
</html>`;

function fixture(html, name) {
	const root = mkdtempSync(path.join(os.tmpdir(), `split-fragment-${name}-`));
	const page = path.join(root, "public", "ideas", name, "index.html");
	mkdirSync(path.dirname(page), { recursive: true });
	writeFileSync(page, html);
	return { root, page };
}

test("a clean page passes check:export", () => {
	const { root, page } = fixture(CLEAN, "clean");
	try {
		const { report, fragDir } = split(page, { root });
		assert.equal(report.kind, "idea");
		assert.equal(report.meta.layout, "tabbed");
		assert.equal(report.meta.title, "A clean fixture page");
		assert.equal(report.meta.created, "2026-10-20");
		assert.equal(report.inlineStyles.length, 0);
		assert.equal(report.executableScripts.length, 0);
		assert.equal(report.emoji.length, 0);
		// The fragment files exist and the chrome is gone.
		assert.ok(existsSync(path.join(fragDir, "meta.json")));
		const body = readFileSync(path.join(fragDir, "body.html"), "utf8");
		// The tab panel is a <section> that keeps its rd-tabpanel/rd-with-toc classes (the hiding
		// mechanism and the rail anchor) plus the data-rd-tab attrs.
		assert.match(body, /<section class="rd-tabpanel rd-with-toc" data-rd-tab="overview" data-rd-label="Overview"/);
		assert.doesNotMatch(body, /rd-hero|rd-expnav|rd-toc|lucide-sprite/);
		// The real gate passes.
		const r = spawnCheck(fragDir);
		assert.equal(r.status, 0, r.stdout + r.stderr);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a dirty page writes the fragment and reports what it could not convert", () => {
	const { root, page } = fixture(DIRTY, "dirty");
	try {
		const { report, fragDir } = split(page, { root });
		// The report flags the three non-convertible things.
		assert.ok(report.inlineStyles.includes("fill:currentColor"), "inline style reported");
		assert.equal(report.executableScripts.length, 1, "executable script reported");
		assert.ok(report.emoji.includes("✅"), "emoji reported");
		// The fragment is still written (the migration is partial by design).
		assert.ok(existsSync(path.join(fragDir, "meta.json")));
		assert.ok(existsSync(path.join(fragDir, "body.html")));
		// The real gate fails on the dirty fragment.
		const r = spawnCheck(fragDir);
		assert.notEqual(r.status, 0, "check:export should fail on a dirty fragment");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// check:export is the gate the tool defers to; run it on the generated fragment.
function spawnCheck(fragDir) {
	return spawnSync(process.execPath, [path.join(HERE, "check-export.mjs"), fragDir], { encoding: "utf8" });
}
