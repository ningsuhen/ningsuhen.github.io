// Real-browser check of the Kokoro neural voice (public/tts/kokoro.js). Not part of `pnpm check`: it needs
// internet (the model comes from Hugging Face, ~105-355 MB) and a browser that can run it.
//
// Run: pnpm check:kokoro                      (WebGPU if this browser has it, else CPU)
//      KOKORO_MODE=cpu pnpm check:kokoro      (force the CPU variant, for CI runners without a GPU)
// Browser: CHROME_PATH, or `pnpm exec playwright-core install chromium`.
//
// Checks: the engine loads; two sentences speak; audio is non-silent (RMS > 0.01), finite, 1-8 s per
// sentence; no request leaves the site except to Hugging Face. Prints the measured timings.
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const MODE = process.env.KOKORO_MODE === "cpu" ? "cpu" : "auto";
/** Same pinned revision as the player (src/scripts/tts/listen-player.ts). */
const MODEL_BASE = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/";
const SENTENCES = [
	"Realtime audio is generated on your device.",
	"The GPU ran at one point five teraflops with sixteen gigabytes of memory.",
];
/** Hosts a run may contact. The site itself, Hugging Face (the consented model fetch), and nothing else. */
const ALLOWED_HOST = /^(127\.0\.0\.1|localhost|(?:[\w-]+\.)*huggingface\.co|(?:[\w-]+\.)*hf\.co)$/;

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".txt": "text/plain", ".json": "application/json", ".gz": "application/gzip", ".bin": "application/octet-stream", ".html": "text/html" };
const TEST_PAGE = `<!doctype html><meta charset="utf-8"><title>kokoro check</title><body>kokoro check</body>`;

function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
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
	const p = decodeURIComponent((req.url ?? "/").split("?")[0]);
	if (p === "/__kokoro-check.html") {
		res.setHeader("Content-Type", "text/html");
		return res.end(TEST_PAGE);
	}
	const file = path.join(PUBLIC, path.normalize(p));
	if (!file.startsWith(PUBLIC) || !existsSync(file) || !statSync(file).isFile()) {
		res.statusCode = 404;
		return res.end("not found");
	}
	res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const executablePath = findChrome();
// Real scrollbars, as in check-listen: Playwright's default --hide-scrollbars hides layout paths visitors take.
const browser = await chromium.launch({
	executablePath,
	ignoreDefaultArgs: ["--hide-scrollbars"],
	args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const failures = [];
const hosts = new Map();
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	await page.addInitScript(() => {
		window.__beacons = [];
		const send = navigator.sendBeacon?.bind(navigator);
		navigator.sendBeacon = (url, data) => {
			window.__beacons.push(String(url));
			return send ? send(url, data) : false;
		};
		if (new URLSearchParams(location.search).get("mode") === "cpu") {
			Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
		}
	});
	page.on("request", (req) => {
		const url = new URL(req.url());
		if (url.protocol === "blob:" || url.protocol === "data:") return; // in-page object URLs, not network
		const host = url.hostname;
		hosts.set(host, (hosts.get(host) ?? 0) + 1);
		if (!ALLOWED_HOST.test(host)) failures.push(`request to ${host} (${req.url().slice(0, 80)})`);
	});
	page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
	// ONNX Runtime's node-assignment note is noise (sessions run with logSeverityLevel 3); any copy is a regression.
	page.on("console", (m) => {
		if ((m.type() === "warning" || m.type() === "error") && /VerifyEachNodeIsAssignedToAnEp/.test(m.text()))
			failures.push(`ORT console line: ${m.text().slice(0, 120)}`);
	});
	await page.goto(`${base}/__kokoro-check.html${MODE === "cpu" ? "?mode=cpu" : ""}`);

	const result = await page.evaluate(
		async ({ sentences, mode, modelBase }) => {
			// The verified ONNX Runtime binary (pinned host, size and SHA-256) must be in place before the engine's init().
			const runtime = await import("/tts/ort-runtime.js");
			await runtime.ensureOrtRuntime({});
			const { createEngine } = await import("/tts/kokoro.js");
			const engine = await createEngine();
			const t0 = performance.now();
			await engine.init({ variant: mode === "cpu" ? "q8f16" : undefined, baseUrl: modelBase, ortBase: new URL("/tts/vendor/ort/", location.href).href });
			const initMs = performance.now() - t0;
			const runs = [];
			for (const text of sentences) {
				const start = performance.now();
				let firstMs = null;
				const parts = [];
				for await (const chunk of engine.speak(text, { rate: 1, voice: null })) {
					if (firstMs === null) firstMs = performance.now() - start;
					parts.push(chunk.samples);
				}
				const genMs = performance.now() - start;
				const total = parts.reduce((n, p) => n + p.length, 0);
				const samples = new Float32Array(total);
				let at = 0;
				for (const p of parts) {
					samples.set(p, at);
					at += p.length;
				}
				runs.push({ text, firstMs, genMs, samples });
			}
			const beacons = window.__beacons;
			engine.dispose();
			return { accelerator: engine.accelerator, initMs, beacons, runs, voices: engine.voices().map((v) => v.id) };
		},
		{ sentences: SENTENCES, mode: MODE, modelBase: MODEL_BASE },
	);
	const metrics = { mode: MODE, browserWebGpu: result.accelerator === "webgpu", accelerator: result.accelerator, initMs: Math.round(result.initMs) };
	if (result.beacons.length) failures.push(`telemetry beacon sent: ${result.beacons.join(", ")}`);
	metrics.runs = [];
	for (const run of result.runs) {
		const s = run.samples;
		let sum = 0;
		let nan = 0;
		let peak = 0;
		for (const v of s) {
			if (!Number.isFinite(v)) nan++;
			else {
				sum += v * v;
				peak = Math.max(peak, Math.abs(v));
			}
		}
		const seconds = s.length / 24000;
		const rms = Math.sqrt(sum / Math.max(s.length, 1));
		metrics.runs.push({ text: run.text, seconds: +seconds.toFixed(2), rms: +rms.toFixed(4), peak: +peak.toFixed(3), firstAudioMs: Math.round(run.firstMs ?? 0), rtf: +(run.genMs / 1000 / seconds).toFixed(3) });
		if (nan) failures.push(`${nan} non-finite samples for "${run.text}"`);
		if (rms <= 0.01) failures.push(`silent audio (RMS ${rms.toFixed(4)}) for "${run.text}"`);
		if (seconds < 1 || seconds > 8) failures.push(`implausible duration ${seconds.toFixed(2)} s for "${run.text}"`);
	}
	metrics.hosts = Object.fromEntries(hosts);
	// The player's default neural voice is Heart (af_heart).
	if (result.voices[0] !== "af_heart") failures.push(`default voice is ${result.voices[0]}, expected af_heart`);
	console.log(JSON.stringify(metrics, null, 2));
} finally {
	await browser.close();
	server.close();
}
if (failures.length) {
	console.error(`check:kokoro: ${failures.length} problem(s)\n${failures.map((f) => `  - ${f}`).join("\n")}`);
	process.exit(1);
}
console.log("check:kokoro: ok (measured on this machine; not a listening test)");
