// check:syntax — parse-check every plain-JS script the site runs directly, so a syntax error fails in
// seconds with a clear message instead of surfacing later as a confusing runtime crash (a non-parsing
// check script used to break the whole design-system leg).
//
// Scope: the .mjs/.js files node runs directly — scripts/, src/plugins/, .github/scripts/ and
// astro.config.mjs. The .ts files are type-checked by `astro check` (already in the static leg), and the
// .astro files by the same, so they are not parsed here.
//
// Run: pnpm check:syntax

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JS_EXT = new Set([".mjs", ".js"]);

function* walk(dir) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(full);
		else if (e.isFile() && JS_EXT.has(path.extname(e.name))) yield full;
	}
}

const files = [
	...walk(path.join(ROOT, "scripts")),
	...walk(path.join(ROOT, "src/plugins")),
	...walk(path.join(ROOT, ".github/scripts")),
	path.join(ROOT, "astro.config.mjs"),
].filter((f) => existsSync(f));

const bad = [];
for (const file of files) {
	const r = spawnSync(process.execPath, ["--check", file], {
		encoding: "utf8",
	});
	if (r.status !== 0) {
		const detail = (r.stderr || r.stdout || "")
			.trim()
			.split("\n")
			.slice(0, 4)
			.join(" ");
		bad.push(`${path.relative(ROOT, file)}: ${detail}`);
	}
}

if (bad.length) {
	console.error(
		`check:syntax FAILED (${bad.length}):\n - ${bad.join("\n - ")}`,
	);
	process.exit(1);
}
console.log(`check:syntax passed: ${files.length} script(s) parse.`);
