// Unit tests for the design-system runtime's pure cores (the parts that don't need a DOM).
// Run: pnpm test:design-system. The DOM mounts (mountExpnav, mountRail, mountFullscreen) are covered
// by the real-browser checks (check:standalone, check:design-system) on the template and guide.
import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSectionIndex } from "../src/design-system/js/expnav.js";
import { activeRun } from "../src/design-system/js/rail.js";
import { fullscreenMethod } from "../src/design-system/js/fullscreen.js";
import { resolveTab } from "../src/design-system/js/tabs.js";

test("expnav: first section is current at the top", () => {
	// nav bottom at 100, sections at 200/400/600 → none under the bar yet, so the first is current.
	assert.equal(currentSectionIndex([200, 400, 600], 100, 900, 0, 2000), 0);
});

test("expnav: the last section whose top is under the bar wins", () => {
	// bar bottom 100 → line 124. tops 50 (under), 300 (not), 500 (not) → index 0.
	assert.equal(currentSectionIndex([50, 300, 500], 100, 900, 0, 2000), 0);
	// tops 50, 100 (under), 500 → index 1.
	assert.equal(currentSectionIndex([50, 100, 500], 100, 900, 0, 2000), 1);
});

test("expnav: at the very bottom of the page the last section wins", () => {
	// innerHeight + scrollY reaches scrollHeight → last, regardless of tops.
	assert.equal(currentSectionIndex([50, 100, 500], 100, 900, 1100, 2000), 2);
});

test("rail: activeRun finds the contiguous run adjacent to the tail", () => {
	assert.deepEqual(activeRun([false, true, true, false]), { min: 1, max: 2 });
	assert.deepEqual(activeRun([true, true, true]), { min: 0, max: 2 });
	assert.deepEqual(activeRun([false, false, true]), { min: 2, max: 2 });
});

test("rail: activeRun is null only when nothing is active", () => {
	assert.equal(activeRun([false, false, false]), null);
	// A lone active link with inactives after it is still a run (the first section in view).
	assert.deepEqual(activeRun([true, false, false]), { min: 0, max: 0 });
});

test("fullscreen: detects the Fullscreen API method", () => {
	assert.equal(fullscreenMethod({ requestFullscreen() {} }), "requestFullscreen");
	assert.equal(fullscreenMethod({ webkitRequestFullscreen() {} }), "webkitRequestFullscreen");
	assert.equal(fullscreenMethod({}), null);
	// Modern browsers expose both; the unprefixed one wins.
	assert.equal(fullscreenMethod({ requestFullscreen() {}, webkitRequestFullscreen() {} }), "requestFullscreen");
});

test("tabs: resolveTab — ?tab= wins, then a legacy #tab-id, else -1", () => {
	const ids = ["summary", "architecture", "sync"];
	// ?tab= that names a tab wins.
	assert.equal(resolveTab(ids, "sync", ""), 2);
	// ?tab= that names a tab beats a hash that names another tab.
	assert.equal(resolveTab(ids, "sync", "summary"), 2);
	// No ?tab=, but a hash that names a tab (legacy #architecture) maps to it.
	assert.equal(resolveTab(ids, null, "architecture"), 1);
	// A hash that names a section (not a tab) is not a tab: -1 (the caller resolves it against panels).
	assert.equal(resolveTab(ids, null, "in-30-seconds"), -1);
	// Nothing names a tab: -1.
	assert.equal(resolveTab(ids, null, ""), -1);
	assert.equal(resolveTab(ids, "nope", ""), -1);
});
