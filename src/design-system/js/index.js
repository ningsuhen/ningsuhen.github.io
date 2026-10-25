// rd.js: the design-system runtime. Bundled from src/design-system/js/ to public/design-system/rd.js
// by scripts/build-design-system.mjs (esbuild, minified, banner). The site build injects
// <script type="module" src="/design-system/rd.js?v=<hash>"> into every standalone page, so this runs
// everywhere. It is opt-in and additive: it only acts on elements that ask for it with a data-rd
// attribute, so pages that keep their own inline scripts (or none) are untouched.
//
// Opt-in attributes:
//   data-rd="expnav"     on <nav class="rd-expnav">   → section-bar scroll-spy
//   data-rd="rail"       on <nav class="rd-toc">       → "On this page" rail
//   data-rd="fullscreen" on the container (+ a [data-rd-fullscreen-toggle] button)
//   data-rd="tabs"       on <nav class="rd-expnav" role="tablist"> → ?tab= tabs + history
//
// Exposes window.rd with the module functions and a small event bus. Pages that adopt the fragment
// contract call init({ root, data, rd }); rd.on('tabshow', cb) is how a chart in a hidden tab learns
// to render (fired by the tabs module).

import { mountExpnav } from "./expnav.js";
import { mountRail } from "./rail.js";
import { mountFullscreen } from "./fullscreen.js";
import { mountTabs } from "./tabs.js";

// Minimal event bus: rd.on(type, cb) registers; rd.emit(type, detail) fires. T4's tabs module emits
// 'tabshow' when a panel becomes visible. Kept dependency-free and synchronous.
const listeners = new Map();
function on(type, cb) {
	if (!listeners.has(type)) listeners.set(type, new Set());
	listeners.get(type).add(cb);
	return () => listeners.get(type)?.delete(cb);
}
function emit(type, detail) {
	listeners.get(type)?.forEach((cb) => cb(detail));
}

function mount(root = document) {
	root.querySelectorAll('[data-rd="expnav"]').forEach((el) => mountExpnav(el));
	root.querySelectorAll('[data-rd="rail"]').forEach((el) => mountRail(el));
	root.querySelectorAll('[data-rd="fullscreen"]').forEach((el) => mountFullscreen(el));
	// Tabs last: their initial activation flips [hidden] on the panels, and the rails (mounted above) watch
	// that attribute, so the observers are live before the first show().
	root.querySelectorAll('[data-rd="tabs"]').forEach((el) => mountTabs(el, { emit }));
}

const rd = {
	on,
	off: (type, cb) => listeners.get(type)?.delete(cb),
	emit,
	// Direct access for pages that want to drive a behaviour on a specific element.
	expnav: mountExpnav,
	rail: mountRail,
	fullscreen: mountFullscreen,
	tabs: mountTabs,
	// Fragment-contract entry point: init({ root, data, rd }). Mounts the opt-in behaviours in root, including
	// ?tab= tabs + history (data-rd="tabs").
	init({ root, data, rd: self } = {}) {
		mount(root || document);
		return self;
	},
};

window.rd = rd;
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => mount());
else mount();
