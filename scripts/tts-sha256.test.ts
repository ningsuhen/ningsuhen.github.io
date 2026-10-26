// Unit tests for the incremental SHA-256 that checks the neural voice files as they stream. Run: pnpm test:tts
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { Sha256 } from "../src/scripts/tts/sha256.ts";

const reference = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

test("known vectors", () => {
	assert.equal(new Sha256().hex(), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	assert.equal(new Sha256().update(new TextEncoder().encode("abc")).hex(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("every length around the block and padding edges", () => {
	const data = randomBytes(300);
	for (let n = 0; n <= 300; n++) assert.equal(new Sha256().update(data.subarray(0, n)).hex(), reference(data.subarray(0, n)), `length ${n}`);
});

test("chunked input matches one pass, whatever the chunk sizes", () => {
	const data = randomBytes(1 << 20);
	for (const size of [1, 7, 63, 64, 65, 4096, 65537]) {
		const hash = new Sha256();
		for (let at = 0; at < data.length; at += size) hash.update(data.subarray(at, at + size));
		assert.equal(hash.hex(), reference(data), `chunk ${size}`);
	}
});

test("update after digest throws; digest is stable", () => {
	const hash = new Sha256().update(new Uint8Array([1, 2, 3]));
	const first = hash.hex();
	assert.equal(hash.hex(), first);
	assert.throws(() => hash.update(new Uint8Array(1)));
});
