// Draft standalone pages: the browser checks skip them (isDraftPage), check:leaks still scans their source.
// Run: pnpm test:drafts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { draftHrefs, isDraftPage } from "./lib/draft-pages.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEAK = '<a href="file:///Users/alice/git/private-project">draft notes</a>';

function fixture() {
	mkdirSync(path.join(ROOT, ".tmp"), { recursive: true });
	const root = mkdtempSync(path.join(ROOT, ".tmp", "draft-pages-"));
	const data = path.join(root, "data");
	const pub = path.join(root, "public");
	mkdirSync(data);
	const page = (rel, body) => {
		mkdirSync(path.dirname(path.join(pub, rel)), { recursive: true });
		writeFileSync(path.join(pub, rel), `<!doctype html><title>x</title>${body}`);
	};
	writeFileSync(path.join(data, "experiments.json"), JSON.stringify({ items: [{ href: "/experiments/live-one/", status: "Live" }, { href: "/experiments/ecosimulation/", status: "Draft" }] }));
	writeFileSync(path.join(data, "research.json"), JSON.stringify({ items: [{ href: "/research/report/", status: "Live" }] }));
	writeFileSync(path.join(data, "ideas.json"), JSON.stringify({ items: [{ href: "/ideas/idea/", status: "draft" }] }));
	page("experiments/ecosimulation/index.html", LEAK);
	page("experiments/live-one/index.html", "<p>clean</p>");
	return { root, data, pub };
}

test("draftHrefs collects Draft entries from all three data files", () => {
	const { root, data } = fixture();
	try {
		assert.deepEqual([...draftHrefs(data)].sort(), ["/experiments/ecosimulation/", "/ideas/idea/"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a Draft page is skipped by the browser checks but still scanned by leaks", () => {
	const { root, data, pub } = fixture();
	try {
		const drafts = draftHrefs(data);
		const pages = ["experiments/ecosimulation/index.html", "experiments/live-one/index.html", "research/report/index.html"];
		// The browser checks (check-standalone-pages, check-design-system) walk only these pages.
		assert.deepEqual(pages.filter((rel) => !isDraftPage(rel, drafts)), ["experiments/live-one/index.html", "research/report/index.html"]);
		// check:leaks walks the whole public/ tree, Draft pages included.
		const leaks = spawnSync(process.execPath, [path.join(ROOT, "scripts/check-public-leaks.mjs"), pub], { encoding: "utf8" });
		assert.equal(leaks.status, 1, leaks.stdout + leaks.stderr);
		assert.match(leaks.stdout, /FAIL \[home-path\].*experiments\/ecosimulation\/index\.html/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
