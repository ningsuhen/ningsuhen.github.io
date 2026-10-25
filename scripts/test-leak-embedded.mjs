// Unit tests for the embedded-payload leak decoder (scripts/check-public-leaks.mjs). Run: pnpm test:leaks-embedded.
// A page can hide a build artifact in a base64 blob (data URI, `const WASM_B64 = "..."`, a JSON bundle) that
// decodes to gzip/deflate and then to wasm or text; the builder's home and toolchain paths live in the decoded
// bytes, invisible to a plain text scan. These tests prove the decoder finds them and redacts the values.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync, gzipSync } from "node:zlib";
import { decodePayload, scanEmbedded } from "./check-public-leaks.mjs";

// A fake build path. "alice" is a stand-in, never the owner's real username.
const FAKE_HOME = "/Users/alice/git/secret-project";
const FAKE_RUSTC = "/rustc/0123456789abcdef0123456789abcdef/library/core";
const FAKE_CARGO = ".cargo/registry/src/github.com-1";

// A minimal wasm module (magic + version) with the fake paths embedded in its "data".
const fakeWasm = () => Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), Buffer.from(`${FAKE_HOME}\n${FAKE_RUSTC}\n${FAKE_CARGO}\n`)]);
// A base64 blob the way the page carries it: `const WASM_B64 = "..."`.
const embed = (b64) => `<script>\nconst WASM_B64 = "${b64}";\n</script>`;

test("decodePayload: base64 -> gzip -> wasm is decoded to the wasm bytes", () => {
	const b64 = gzipSync(fakeWasm()).toString("base64");
	const out = decodePayload(b64);
	assert.ok(out, "a gzip'd wasm payload must decode");
	assert.deepEqual([...out.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d], "decodes to the wasm magic");
});

test("decodePayload: base64 -> deflate -> text is decoded", () => {
	const b64 = deflateSync(Buffer.from(`plain text ${FAKE_HOME}\n`)).toString("base64");
	const out = decodePayload(b64);
	assert.ok(out && out.toString("latin1").includes(FAKE_HOME));
});

test("decodePayload: plain base64 text (no container) is decoded", () => {
	const b64 = Buffer.from(`plain text ${FAKE_HOME}\n`).toString("base64");
	const out = decodePayload(b64);
	assert.ok(out && out.toString("latin1").includes(FAKE_HOME));
});

test("decodePayload: opaque binary (not gzip/deflate/wasm/text) is skipped", () => {
	// Random bytes: not a gzip/deflate container, and not text-like once read.
	const b64 = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 37) & 0xff)).toString("base64");
	assert.equal(decodePayload(b64), null, "opaque binary must not be treated as a scannable payload");
});

test("scanEmbedded: a base64+gzip wasm carrying a home path is flagged, and the value is redacted", () => {
	const b64 = gzipSync(fakeWasm()).toString("base64");
	const problems = scanEmbedded(embed(b64), "fixture.html", { docs: false });
	assert.ok(problems.length, "the embedded leak must be found");
	assert.ok(problems.some((p) => p.rule === "home-path"), "home-path rule fires on the decoded payload");
	assert.ok(problems.some((p) => p.rule === "build-path"), "build-path rule fires on the decoded payload");
	for (const p of problems) {
		assert.ok(p.embedded, "findings are tagged embedded");
		assert.ok(!p.match.includes("alice") && !p.match.includes("secret-project"), "the decoded value is never echoed, only a redaction marker");
	}
});

test("scanEmbedded: a clean embedded payload produces no findings", () => {
	const b64 = gzipSync(Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])).toString("base64");
	assert.equal(scanEmbedded(embed(b64), "fixture.html", { docs: false }).length, 0);
});

test("scanEmbedded: a short base64 run (below the blob threshold) is ignored", () => {
	// Under 32 chars it is not a payload blob, so nothing is decoded or scanned.
	assert.equal(scanEmbedded(`<script>const X = "${Buffer.from("hi").toString("base64")}";</script>`, "fixture.html", { docs: false }).length, 0);
});

test("scanEmbedded: an opaque data URI (font) is not decoded, even if it could hide a path", () => {
	// A font data URI is opaque binary media: it is skipped outright, so a megabyte of font bytes is never decoded.
	const blob = Buffer.from(`font ${FAKE_HOME}\n`.padEnd(4096, "x")).toString("base64");
	const html = `<style>@font-face{src:url(data:font/woff2;base64,${blob})}</style>`;
	assert.equal(scanEmbedded(html, "fixture.html", { docs: false }).length, 0, "opaque media types are not treated as payloads");
});
