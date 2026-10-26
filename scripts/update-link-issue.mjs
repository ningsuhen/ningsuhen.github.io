// update-link-issue — open or update one GitHub issue with the broken external links found by
// check-external-links. Run by the weekly "External link check" workflow (needs GITHUB_TOKEN).
//
//   node scripts/update-link-issue.mjs <report.json>
//
// The issue title is stable ("Broken external links") so the workflow finds and updates the same
// issue every run instead of opening a new one. The body lists broken + unreachable links (with the
// page each lives on) and the count of bot-blocked ones. If there are no broken links the issue is
// closed.
import { readFileSync } from "node:fs";

const REPORT = process.argv[2];
if (!REPORT) {
	console.error("usage: node scripts/update-link-issue.mjs <report.json>");
	process.exit(2);
}
const report = JSON.parse(readFileSync(REPORT, "utf8"));
const links = report.links;
const broken = links?.broken ?? [];
const unreachable = links?.unreachable ?? [];
const blocked = links?.blocked ?? [];
const hasProblems = broken.length + unreachable.length > 0;

const token = process.env.GITHUB_TOKEN;
const owner = process.env.GITHUB_REPOSITORY_OWNER ?? "ningsuhen";
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "ningsuhen.github.io";
if (!token) {
	console.error("GITHUB_TOKEN is not set");
	process.exit(1);
}

const api = (path, init = {}) =>
	fetch(`https://api.github.com${path}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			"User-Agent": "external-link-check",
			Accept: "application/vnd.github+json",
			...init.headers,
		},
		...init,
	}).then(async (res) => {
		if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
		return res.status === 204 ? null : res.json();
	});

const line = (r) => `- [${r.url}](${r.url}) — ${r.kind === "broken" ? `HTTP ${r.status}` : r.error} on ${r.pages.join(", ")}`;

const body = [
	`Broken external links found by the weekly check (${report.checkedAt}).`,
	``,
	hasProblems ? `## Broken (${broken.length})` : `## Broken (0)`,
	...(broken.length ? broken.map(line) : ["_(none)_"]),
	``,
	`## Unreachable (${unreachable.length})`,
	...(unreachable.length ? unreachable.map(line) : ["_(none)_"]),
	``,
	`_Bot-blocked (${blocked.length}) — these return 403/429 to the checker and are not necessarily dead: ${blocked
		.map((r) => r.url)
		.join(", ") || "none"}._`,
	``,
	`---`,
	`<sub>Ning›🤖›</sub>`,
].join("\n");

// Find the existing issue by title.
const issues = await api(`/repos/${owner}/${repo}/issues?state=all&per_page=100`);
const existing = issues.find((i) => i.title === "Broken external links" && !i.pull_request);

if (hasProblems) {
	if (existing) {
		await api(`/repos/${owner}/${repo}/issues/${existing.number}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ body, state: "open" }),
		});
		console.log(`updated issue #${existing.number} (${broken.length + unreachable.length} problem(s))`);
	} else {
		const created = await api(`/repos/${owner}/${repo}/issues`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Broken external links", body }),
		});
		console.log(`opened issue #${created.number} (${broken.length + unreachable.length} problem(s))`);
	}
} else if (existing && existing.state === "open") {
	await api(`/repos/${owner}/${repo}/issues/${existing.number}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ state: "closed", body }),
	});
	console.log(`closed issue #${existing.number} (no broken links)`);
} else {
	console.log("no broken links, nothing to do");
}
