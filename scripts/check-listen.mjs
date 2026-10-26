// Real-browser check of the Listen player on built post pages. Run after `pnpm build`:  pnpm check:listen
// speechSynthesis is replaced by a stub, so the test needs no audio device. Optional screenshots:
// LISTEN_SHOTS=<dir> pnpm check:listen
// Browser: set CHROME_PATH, or `pnpm exec playwright-core install chromium` (CI does this).
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const DIST = path.resolve("dist");
const PLAYER_POST = "/posts/brev-tree-benchmark/";
const OTHER_POST = "/posts/ai-boom-trajectories/";
const SHOTS = process.env.LISTEN_SHOTS;
const TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css",
	".js": "text/javascript",
	".json": "application/json",
	".webp": "image/webp",
	".png": "image/png",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
};

// Stub: records every utterance and every cancel. Each utterance ends after 120 ms.
const SPEECH_STUB = `
(() => {
  const log = { spoken: [], cancels: 0 };
  window.__tts = log;
  let current = null;
  const voices = [{ name: "Test Voice", lang: "en-US", voiceURI: "test-voice", localService: true, default: true }];
  const synth = {
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    getVoices() { return voices; },
    speak(u) {
      log.spoken.push(u.text);
      current = u; synth.speaking = true;
      setTimeout(() => {
        if (current !== u) return;
        u.onstart && u.onstart({});
        setTimeout(() => {
          if (current !== u) return;
          current = null; synth.speaking = false;
          u.onend && u.onend({});
        }, 120);
      }, 0);
    },
    cancel() {
      log.cancels++;
      const u = current; current = null; synth.speaking = false;
      if (u && u.onerror) u.onerror({ error: "canceled" });
    },
    pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.rate = 1; };
})();
`;

// Stub: a WebGPU adapter exists (the neural voice is offered and is the default).
const GPU_STUB = `Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => ({}) }, configurable: true });`;

function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	const cache = path.join(homedir(), "Library/Caches/ms-playwright");
	if (existsSync(cache)) {
		for (const d of readdirSync(cache)
			.filter((n) => n.startsWith("chromium_headless_shell"))
			.sort()
			.reverse()) {
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
	res.setHeader(
		"Content-Type",
		TYPES[path.extname(file)] ?? "application/octet-stream",
	);
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// Real scrollbars: Playwright's default --hide-scrollbars makes OverlayScrollbars cancel itself, and that hid the
// double-connect bug (OverlayScrollbars moves every body child, so <listen-player> connects twice on a hard load).
// Without the flag the headless shell draws classic scrollbars, like Windows, Linux and a Mac with a mouse.
const browser = await chromium.launch({
	executablePath: findChrome(),
	ignoreDefaultArgs: ["--hide-scrollbars"],
});
// No live giscus in this check: its widget (or its outage error) swaps the 372px comments skeleton for a
// different height at an arbitrary moment, which made layout probes depend on a third-party service.
// Every context blocks it, so the comments host settles the same way on every run.
const newContext = browser.newContext.bind(browser);
browser.newContext = async (options) => {
	const ctx = await newContext(options);
	await ctx.route("https://giscus.app/**", (route) => route.abort());
	return ctx;
};
const failures = [];
const expect = (ok, message) => {
	if (!ok) failures.push(message);
};
/** Runs one section. A thrown error (a click that times out) fails that section and the run goes on. */
async function step(name, run) {
	try {
		await run();
	} catch (err) {
		failures.push(`${name}: ${String(err?.message ?? err).split("\n")[0]}`);
	}
}

async function openPage(
	viewport,
	{ theme = "light", javaScriptEnabled = true } = {},
) {
	const ctx = await browser.newContext({
		viewport,
		javaScriptEnabled,
		reducedMotion: "reduce",
	});
	ctx.setDefaultTimeout(10000);
	await ctx.addInitScript(
		`${SPEECH_STUB}; try { localStorage.setItem("theme", ${JSON.stringify(theme)}); } catch {}`,
	);
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	return { ctx, page };
}

// 1. Progressive enhancement: without JavaScript the player never appears.
await step("1. no-JS", async () => {
	const { ctx, page } = await openPage(
		{ width: 1440, height: 900 },
		{ javaScriptEnabled: false },
	);
	const visible = await page
		.$eval("listen-player", (el) => getComputedStyle(el).display !== "none")
		.catch(() => true);
	expect(!visible, "no-JS: listen-player is visible");
	await ctx.close();
});

// 2. Desktop light: renders, plays through the stub, highlight moves, pause stops speech.
await step("2. desktop play", async () => {
	const { ctx, page } = await openPage({ width: 1440, height: 900 });
	await page
		.waitForFunction(
			() => {
				const el = document.querySelector("listen-player");
				return (
					el &&
					!el.hasAttribute("hidden") &&
					document.querySelector("[data-position]")?.textContent !== "0 / 0"
				);
			},
			null,
			{ timeout: 8000 },
		)
		.catch(() => expect(false, "desktop: player did not render"));
	expect(
		await page.$eval("[data-accel]", (el) => el.hidden),
		"web speech: GPU/CPU superscript shown",
	);
	expect(
		await page.$eval("[data-note-local]", (el) => !el.hidden),
		"local note hidden for local voice",
	);

	await page.click("[data-action=play]");
	await page
		.waitForFunction(() => window.__tts.spoken.length >= 1, null, {
			timeout: 5000,
		})
		.catch(() => expect(false, "play: no utterance started"));
	const first = await page.evaluate(() => window.__tts.spoken[0]);
	expect(
		typeof first === "string" && first.length > 0,
		"play: first utterance empty",
	);
	const firstId = await page
		.$eval("[data-listen-current]", (el) =>
			el.getAttribute("data-listen-current"),
		)
		.catch(() => null);
	expect(firstId === "s0", `highlight: expected s0 at start, got ${firstId}`);
	await page
		.waitForFunction(
			() =>
				document
					.querySelector("[data-listen-current]")
					?.getAttribute("data-listen-current") !== "s0",
			null,
			{ timeout: 5000 },
		)
		.catch(() => expect(false, "highlight did not move past s0"));
	const hl = await page.evaluate(() =>
		typeof CSS !== "undefined" && CSS.highlights
			? CSS.highlights.has("listen-current")
			: "n/a",
	);
	expect(hl !== false, "highlight: CSS Highlight not registered");
	expect(
		(await page.$eval("[data-action=play]", (el) =>
			el.getAttribute("aria-label"),
		)) === "Pause",
		"play button label not Pause while playing",
	);

	if (SHOTS) {
		mkdirSync(SHOTS, { recursive: true });
		await page.screenshot({
			path: path.join(SHOTS, "desktop-1440-light-playing.png"),
		});
	}
	await page.click("[data-action=play]");
	await page
		.waitForFunction(
			() => document.querySelector("listen-player")?.dataset.state === "paused",
			null,
			{ timeout: 3000 },
		)
		.catch(() => expect(false, "pause: state not paused"));
	const cancelled = await page.evaluate(() => window.__tts.cancels > 0);
	await page.evaluate(() => window.scrollTo(0, 0));
	expect(cancelled, "pause: speech not cancelled");
	await ctx.close();
});

// 2b. Docking: inline at the top of the post, then pinned flush to the viewport top as one slim row.
const RAIL = "#toc-inner-wrapper";
for (const [name, viewport, theme] of [
	["desktop-1440-light", { width: 1440, height: 900 }, "light"],
	["desktop-1440-dark", { width: 1440, height: 900 }, "dark"],
	["wide-1536-light", { width: 1536, height: 864 }, "light"],
	["wide-1920-light", { width: 1920, height: 1080 }, "light"],
	["wide-1920-dark", { width: 1920, height: 1080 }, "dark"],
	["mobile-375-light", { width: 375, height: 800 }, "light"],
	["mobile-375-dark", { width: 375, height: 800 }, "dark"],
]) {
	const { ctx, page } = await openPage(viewport, { theme });
	await page
		.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 })
		.catch(() => expect(false, `${name}: player missing`));
	await page.waitForTimeout(300);
	const inline = await page.evaluate(() => {
		const el = document.querySelector("listen-player");
		return {
			top: el.getBoundingClientRect().top,
			docked: el.hasAttribute("data-docked"),
			// Document offset of the first rendered element after the player: docking must not move it. Not the page
			// height: the giscus host at the bottom shrinks from its skeleton when giscus loads (372 -> 150px), which
			// can land between the two reads and made this check flaky.
			after: (() => {
				let n = el.nextElementSibling;
				while (n && n.getBoundingClientRect().height === 0) n = n.nextElementSibling;
				return n ? n.getBoundingClientRect().top + window.scrollY : Number.NaN;
			})(),
		};
	});
	expect(
		!inline.docked && inline.top > 0,
		`${name}: not inline at the top (top ${inline.top})`,
	);
	if (SHOTS) {
		mkdirSync(SHOTS, { recursive: true });
		await page.screenshot({ path: path.join(SHOTS, `${name}-1-inline.png`) });
	}

	await page.evaluate(() => window.scrollTo(0, 1500));
	await page.waitForTimeout(400);
	const docked = await page.evaluate((rail) => {
		const el = document.querySelector("listen-player");
		const r = el.getBoundingClientRect();
		let covered = true;
		for (let y = 0; y < r.height; y += 1) {
			for (const x of [r.left + 4, r.left + r.width / 2, r.right - 4]) {
				// The overlay scrollbar (OverlayScrollbars, classic-scrollbar systems) is page chrome, not content.
				const hit = document.elementFromPoint(x, y);
				if (!hit?.closest("listen-player, .os-scrollbar")) {
					covered = false;
				}
			}
		}
		const bar = el.querySelector(".listen-bar");
		const railEl = document.querySelector(rail);
		const railBox = railEl?.getBoundingClientRect();
		const railShown =
			!!railBox &&
			railBox.width > 0 &&
			getComputedStyle(railEl).display !== "none";
		const overlapsRail =
			railShown &&
			!(
				railBox.left >= r.right ||
				railBox.right <= r.left ||
				railBox.bottom <= r.top ||
				railBox.top >= r.bottom
			);
		return {
			top: r.top,
			height: r.height,
			docked: el.hasAttribute("data-docked"),
			covered,
			// Same probe as the inline read above.
			after: (() => {
				let n = el.nextElementSibling;
				while (n && n.getBoundingClientRect().height === 0) n = n.nextElementSibling;
				return n ? n.getBoundingClientRect().top + window.scrollY : Number.NaN;
			})(),
			barOverflow: bar.scrollWidth - bar.clientWidth,
			railShown,
			overlapsRail,
		};
	}, RAIL);
	expect(docked.docked, `${name}: not docked after scrolling 1500px`);
	expect(
		Math.abs(docked.top) <= 0.5,
		`${name}: docked top ${docked.top}px, expected 0`,
	);
	expect(
		docked.height <= 48,
		`${name}: docked height ${docked.height}px, expected <= 48`,
	);
	expect(docked.covered, `${name}: page content visible above the player`);
	expect(
		Math.abs(docked.after - inline.after) <= 1,
		`${name}: layout shift ${docked.after - inline.after}px on docking (content after the player)`,
	);
	expect(!docked.overlapsRail, `${name}: docked player overlaps the TOC rail`);
	expect(
		docked.barOverflow <= 1,
		`${name}: docked row overflows ${docked.barOverflow}px`,
	);
	if (SHOTS) {
		await page.screenshot({ path: path.join(SHOTS, `${name}-2-docked.png`) });
	}

	// Follow: a sentence scrolled away is brought back below the docked row, never under it.
	await page.click("[data-action=play]");
	await page
		.waitForFunction(() => window.__tts.spoken.length >= 2, null, {
			timeout: 5000,
		})
		.catch(() => expect(false, `${name}: speech did not start`));
	await page.click("[data-action=play]");
	await page.evaluate(() => window.scrollTo(0, 1500));
	await page.waitForTimeout(300);
	await page
		.click("[data-follow]", { timeout: 3000 })
		.catch(() =>
			expect(
				false,
				`${name}: follow button not shown for a sentence scrolled away`,
			),
		);
	await page.waitForTimeout(600);
	const follow = await page.evaluate(() => {
		const bar = document.querySelector("listen-player").getBoundingClientRect();
		const hl = document
			.querySelector("[data-listen-current]")
			.getBoundingClientRect();
		return { bottom: bar.bottom, top: hl.top };
	});
	expect(
		follow.top >= follow.bottom,
		`${name}: highlighted sentence top ${follow.top} above the docked player bottom ${follow.bottom}`,
	);
	await page.evaluate(() =>
		document
			.querySelector("[data-listen-current]")
			.scrollIntoView({ block: "start" }),
	);
	await page.waitForTimeout(200);
	const atStart = await page.evaluate(() => ({
		bottom: document.querySelector("listen-player").getBoundingClientRect()
			.bottom,
		top: document.querySelector("[data-listen-current]").getBoundingClientRect()
			.top,
	}));
	expect(
		atStart.top >= atStart.bottom,
		`${name}: block-start scroll hides the sentence under the docked player (sentence top ${atStart.top}, player bottom ${atStart.bottom}, scroll padding ${await page.evaluate(() => document.documentElement.style.scrollPaddingTop)})`,
	);
	if (SHOTS) {
		await page.screenshot({
			path: path.join(SHOTS, `${name}-3-docked-highlight.png`),
		});
	}

	// Dropdown: the slider and voice open below the row; the speed stays in the row.
	// el.click(): Playwright's actionability scroll fights the sticky row here; the handler is what is under test.
	await page.$eval("[data-toggle]", (el) => el.click());
	const rowHasSpeed = await page.$eval(".listen-rate", (el) =>
		el.parentElement?.classList.contains("listen-bar"),
	);
	const panelHasSlider = await page.$eval(
		"[data-progress]",
		(el) => el.closest("#listen-panel") !== null,
	);
	expect(rowHasSpeed, `${name}: speed not in the docked row`);
	expect(panelHasSlider, `${name}: slider not in the docked dropdown`);
	await page.$eval("[data-toggle]", (el) => el.click());
	await ctx.close();
}

// 2c. Docked player cleans up on a Swup visit: no docked state and no scroll padding left on the next post.
await step("2c. swup while docked", async () => {
	const { ctx, page } = await openPage({ width: 1440, height: 900 });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	await page.evaluate(() => window.scrollTo(0, 1500));
	await page.waitForTimeout(300);
	await page.evaluate((href) => window.swup.navigate(href), OTHER_POST);
	await page.waitForURL(`**${OTHER_POST}`, { timeout: 8000 }).catch(() => {});
	await page
		.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 })
		.catch(() => expect(false, "swup while docked: player missing"));
	await page.waitForTimeout(400);
	const after = await page.evaluate(() => ({
		docked:
			document.querySelector("listen-player")?.hasAttribute("data-docked") ??
			null,
		pad: document.documentElement.style.scrollPaddingTop,
	}));
	expect(after.docked === false, "swup while docked: new player is docked");
	expect(
		after.pad === "",
		`swup while docked: scroll padding left as ${after.pad}`,
	);
	await ctx.close();
});

// 3. Desktop dark + mobile: collapsed by default, expands on toggle, no horizontal overflow.
for (const [name, viewport, theme] of [
	["desktop-1440-dark", { width: 1440, height: 900 }, "dark"],
	["mobile-375-light", { width: 375, height: 800 }, "light"],
	["mobile-375-dark", { width: 375, height: 800 }, "dark"],
]) {
	const { ctx, page } = await openPage(viewport, { theme });
	await page
		.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 })
		.catch(() => expect(false, `${name}: player missing`));
	await page.waitForTimeout(300);
	const isMobile = viewport.width < 768;
	const panelVisible = () =>
		page.$eval(
			"#listen-panel",
			(el) => getComputedStyle(el).display !== "none",
		);
	if (isMobile) {
		expect(
			!(await panelVisible()),
			`${name}: panel should be collapsed by default`,
		);
		await page.click("[data-toggle]");
		expect(await panelVisible(), `${name}: panel did not expand`);
		await page.click("[data-toggle]");
	} else {
		expect(await panelVisible(), `${name}: panel should be visible on desktop`);
	}
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
	expect(overflow <= 1, `${name}: horizontal overflow ${overflow}px`);
	if (SHOTS) {
		if (isMobile) await page.click("[data-toggle]");
		await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
	}
	await ctx.close();
}

// 4. Swup navigation: speech stops, the player is rebuilt for the new post.
await step("4. swup navigation", async () => {
	const { ctx, page } = await openPage({ width: 1440, height: 900 });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	await page.click("[data-action=play]");
	await page
		.waitForFunction(() => window.__tts.spoken.length >= 2, null, {
			timeout: 5000,
		})
		.catch(() => expect(false, "nav: speech never started"));
	const before = await page.evaluate(() => ({
		cancels: window.__tts.cancels,
		spoken: window.__tts.spoken.length,
	}));
	await page.evaluate((href) => {
		const a = document.createElement("a");
		a.href = href;
		a.id = "listen-test-link";
		a.textContent = "next";
		document.querySelector("#swup-container").append(a);
	}, OTHER_POST);
	await Promise.all([
		page.waitForURL(`**${OTHER_POST}`, { timeout: 8000 }),
		page.click("#listen-test-link"),
	]);
	// The old player keeps speaking until Swup swaps the page, so count again after the swap settles.
	await page.waitForTimeout(400);
	const after = await page.evaluate(() => ({
		cancels: window.__tts.cancels,
		spoken: window.__tts.spoken.length,
		speaking: window.speechSynthesis.speaking,
	}));
	await page.waitForTimeout(800);
	const settled = await page.evaluate(() => window.__tts.spoken.length);
	expect(
		after.cancels > before.cancels,
		"nav: speech was not cancelled on navigation",
	);
	expect(after.speaking === false, "nav: still speaking after navigation");
	expect(settled === after.spoken, "nav: new utterances after navigation");
	await page
		.waitForFunction(
			() =>
				document.querySelector("listen-player") &&
				!document.querySelector("listen-player").hasAttribute("hidden"),
			null,
			{ timeout: 8000 },
		)
		.catch(() => expect(false, "nav: player missing on the new post"));
	await ctx.close();
});

// 5. Neural slot: offered only when window.__KOKORO_READY is set. Choosing it asks first; cancel keeps the built-in voice.
await step("5. neural slot", async () => {
	const ctx = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	});
	ctx.setDefaultTimeout(10000);
	// The GPU stub: the consent dialog is only offered with a WebGPU adapter, and CI runners have none.
	await ctx.addInitScript(`${SPEECH_STUB}; ${GPU_STUB}; window.__KOKORO_READY = true;`);
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	expect(
		await page.$eval("[data-engine-wrap]", (el) => !el.hidden),
		"kokoro ready: engine select hidden",
	);
	await page.selectOption("[data-engine]", "kokoro");
	await page
		.waitForSelector("[data-consent][open]", { timeout: 3000 })
		.catch(() => expect(false, "kokoro: consent dialog did not open"));
	await page.click("[data-consent] button[value=cancel]");
	await page
		.waitForFunction(
			() => document.querySelector("[data-engine]").value === "web-speech",
			null,
			{ timeout: 3000 },
		)
		.catch(() =>
			expect(false, "kokoro: cancel did not return to built-in voice"),
		);
	await ctx.close();
});

// Stubs for the neural engine: no model download, so the checks run in seconds. The module is served
// through a route, so the real player code runs against it. Like the real engine, speak() before init() fails.
// window.__stubEngines and window.__stubInits count createEngine() and init() calls.
// Fake model files: the real ones are hundreds of MB. The manifest holds their real sizes and SHA-256 values,
// and the Hugging Face host is routed to these bodies, so the download, checksum and cache path runs for real.
const FAKE_FILES = {
	"onnx/model.onnx": Buffer.alloc(4000, 109),
	"voices/af_heart.bin": Buffer.alloc(1000, 97),
	"voices/am_michael.bin": Buffer.alloc(1000, 98),
};
const FAKE_MANIFEST = {
	base: "https://huggingface.co/fake/resolve/test/",
	files: Object.fromEntries(
		Object.entries(FAKE_FILES).map(([key, body]) => [key, { bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") }]),
	),
	local: { "lexicon-en-us.txt": { bytes: 4592212, sha256: "7d33f53aed4e1d6946ab726cda27cef897bbeb17911cbf70e01b63d5b581206b" } },
};
const stubEngine = (delayMs, initMs = 0) => `export function createEngine() {
	window.__stubEngines = (window.__stubEngines || 0) + 1;
	let ready = false;
	return {
	id: "kokoro", label: "Neural voice (Kokoro)", accelerator: "webgpu", requiresDownloadMB: 355, notice: "Stub engine for check:listen.",
	async init(opts) {
		window.__stubInits = (window.__stubInits || 0) + 1;
		await new Promise((r) => setTimeout(r, ${initMs}));
		ready = true;
		opts && opts.onProgress && opts.onProgress(1);
	},
	voices() { return [{ id: "af_heart", name: "Heart", lang: "en-US", local: true }, { id: "am_michael", name: "Michael", lang: "en-US", local: true }]; },
	speak() { if (!ready) throw new Error("kokoro: call init() first"); return (async function* () {
		await new Promise((r) => setTimeout(r, ${delayMs}));
		yield { samples: new Float32Array(24000).fill(0.1), sampleRate: 24000 };
	})(); },
	cancel() {}, dispose() {},
}; }`;
const routeKokoro = (ctx, body, status = 200) =>
	ctx.route("**/tts/kokoro.js", (route) =>
		route.fulfill({ status, contentType: "text/javascript", body }),
	);
// The pinned ONNX Runtime binary. The real bytes are fetched once (checked by size and SHA-256) into the gitignored
// .tmp/, then served to the page by route, so the real download, check and cache path runs.
const ORT_URL = "https://huggingface.co/ningsuhen/onnxruntime-web-1.27.0/resolve/c25145ab811e50c175798b09cd6da3fc272d9411/ort-wasm-simd-threaded.asyncify.wasm";
const ORT_BYTES = 24254953;
const ORT_SHA = "7e83cd6cee77e478bc96a7e91b198144fb5e4126287daf1f9b54bb195ebcd55a";
const ORT_CACHE = path.resolve(".tmp/check-listen/ort-wasm.bin");
async function realOrtRuntime() {
	const digest = (b) => createHash("sha256").update(b).digest("hex");
	if (existsSync(ORT_CACHE)) {
		const kept = readFileSync(ORT_CACHE);
		if (kept.length === ORT_BYTES && digest(kept) === ORT_SHA) return kept;
	}
	const response = await fetch(ORT_URL).catch(() => null);
	if (!response?.ok) throw new Error("check:listen needs internet once to fetch the pinned ONNX Runtime binary");
	const body = Buffer.from(await response.arrayBuffer());
	if (body.length !== ORT_BYTES || digest(body) !== ORT_SHA) throw new Error("the pinned ONNX Runtime binary does not match its size and hash");
	mkdirSync(path.dirname(ORT_CACHE), { recursive: true });
	writeFileSync(ORT_CACHE, body);
	return body;
}
const REAL_ORT = await realOrtRuntime();

const routeModelFiles = async (ctx, counter, runtime = {}, bodies = {}) => {
	await ctx.route("**/tts/manifest.json", (route) =>
		route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FAKE_MANIFEST) }),
	);
	await ctx.route("https://huggingface.co/**", (route) => {
		counter.hf += 1;
		const key = new URL(route.request().url()).pathname.split("/").slice(-2).join("/");
		const body = bodies[key] ?? FAKE_FILES[key];
		return route.fulfill({
			status: body ? 200 : 404,
			contentType: "application/octet-stream",
			headers: { "access-control-allow-origin": "*" },
			body: body ?? "missing",
		});
	});
	// Registered after the general route, so it matches first.
	await ctx.route(ORT_URL, (route) => {
		counter.hf += 1;
		return route.fulfill({
			status: runtime.status ?? 200,
			contentType: "application/wasm",
			headers: { "access-control-allow-origin": "*" },
			body: runtime.body ?? REAL_ORT,
		});
	});
};
const neuralContext = async (browser, { delayMs, initMs, status, body, gpu = true, counter = { hf: 0 }, runtime = {}, bodies = {}, init = "" }) => {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	ctx.setDefaultTimeout(10000);
	await ctx.addInitScript(`${SPEECH_STUB}; ${gpu ? GPU_STUB : ""}; window.__KOKORO_READY = true; ${init}`);
	await routeKokoro(ctx, body ?? stubEngine(delayMs ?? 50, initMs ?? 0), status);
	await routeModelFiles(ctx, counter, runtime, bodies);
	return ctx;
};
const engineValue = (page) => page.$eval("[data-engine]", (el) => el.value);

// 7. Browser voice is always a visible choice. Choosing it downloads nothing; the choice can be changed at any time.
await step("7. browser voice choice", async () => {
	const ctx = await neuralContext(browser, {});
	const page = await ctx.newPage();
	const requests = [];
	page.on("request", (req) => requests.push(req.url()));
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	expect(await page.$eval("[data-engine-wrap]", (el) => !el.hidden), "voice choice hidden");
	await page.selectOption("[data-engine]", "kokoro");
	await page.waitForSelector("[data-consent][open]", { timeout: 3000 });
	expect(
		await page.$eval("[data-choice=web]", (el) => el.offsetParent !== null || el.getClientRects().length > 0),
		"consent: 'Use browser voice' not visible",
	);
	await page.click("[data-choice=web]");
	await page.waitForFunction(() => document.querySelector("[data-engine]").value === "web-speech", null, { timeout: 3000 })
		.catch(() => expect(false, "browser choice did not select the browser voice"));
	expect(
		requests.filter((u) => /vendor\/ort|huggingface|\.hf\.co/.test(u)).length === 0,
		`browser choice requested neural files: ${requests.filter((u) => /vendor\/ort|huggingface|\.hf\.co/.test(u)).join(", ")}`,
	);
	// Back and forth: neural (consent once, then no prompt), browser, neural again.
	await page.selectOption("[data-engine]", "kokoro");
	await page.waitForSelector("[data-consent][open]", { timeout: 3000 });
	// Each step waits for the engine the player saved after a successful switch, so no step races a load in flight.
	const savedEngine = (id) =>
		page.waitForFunction((want) => JSON.parse(localStorage.getItem("listen-prefs") || "{}").engine === want, id, { timeout: 8000 })
			.catch(() => expect(false, `engine ${id} was not activated`));
	await page.click("[data-variant=fp32]");
	await savedEngine("kokoro");
	await page.selectOption("[data-engine]", "web-speech");
	await savedEngine("web-speech");
	await page.selectOption("[data-engine]", "kokoro");
	await savedEngine("kokoro");
	expect(await page.$$eval("[data-consent][open]", (els) => els.length) === 0, "consent asked again after consent was given");
	await ctx.close();
});

// 8. Forced init failure (the module does not load): the player stays usable on the browser voice and says why.
await step("8. init failure", async () => {
	const ctx = await neuralContext(browser, { status: 500, body: "missing" });
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	await page.selectOption("[data-engine]", "kokoro");
	await page.waitForSelector("[data-consent][open]", { timeout: 3000 });
	await page.click("[data-variant=fp32]");
	// Wait for the state change itself: the status text can already be there from the failed start on page load.
	await page.waitForFunction(() => document.querySelector("[data-engine]").value === "web-speech", null, { timeout: 8000 })
		.catch(() => expect(false, "init failure: engine not back on the browser voice"));
	expect(await page.$eval("[data-status]", (el) => /not available here/.test(el.textContent ?? "")), "init failure: no fallback notice");
	await ctx.close();
});

// 9. Too slow: a neural engine slower than real time (1 s of audio every 2 s, RTF 2) never pauses playback.
// The notice and its button show while audio plays, gaps are bridged without any click, the post does not shift,
// and only the pause button pauses. Switching to the browser voice is remembered for the next visit.
await step("9. too slow", async () => {
	const ctx = await neuralContext(browser, { delayMs: 2000 });
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	await page.selectOption("[data-engine]", "kokoro");
	await page.waitForSelector("[data-consent][open]", { timeout: 3000 });
	await page.click("[data-variant=fp32]");
	await page.waitForFunction(() => /Neural voice: downloaded/.test(document.querySelector("[data-download-state]")?.textContent ?? ""), null, { timeout: 15000 })
		.catch(() => expect(false, "slow engine: download did not complete before Play"));
	// Every state the player enters from here on, and the post's document offset (layout shift probe).
	const postTop = () => page.evaluate(() => {
		const next = document.querySelector("listen-player").nextElementSibling;
		return Math.round(next.getBoundingClientRect().top + scrollY);
	});
	const topBefore = await postTop();
	await page.evaluate(() => {
		const player = document.querySelector("listen-player");
		window.__states = [];
		new MutationObserver(() => window.__states.push(player.dataset.state)).observe(player, { attributeFilter: ["data-state"] });
	});
	const position = () => page.$eval("[data-position]", (el) => Number.parseInt(el.textContent ?? "0", 10));
	const state = () => page.$eval("listen-player", (el) => el.dataset.state);
	await page.click("[data-action=play]");
	await page.waitForSelector("[data-slow]:not([hidden])", { timeout: 25000 })
		.catch(() => expect(false, "slow engine: slow notice did not appear"));
	expect(await state() === "playing", `slow engine: state is ${await state()} when the notice shows, want playing`);
	expect(await page.isVisible("[data-slow-browser]"), "slow engine: 'Switch to browser voice' not visible");
	expect(await postTop() === topBefore, "slow engine: the notice shifted the post");
	expect(
		await page.evaluate(() => localStorage.getItem("listen-neural-slow") === "true"),
		"slow engine: device not remembered",
	);
	// Gaps (synthesis is twice as slow as playback) are bridged by waiting: position advances with no click.
	const atNotice = await position();
	await page.waitForFunction((from) => Number.parseInt(document.querySelector("[data-position]").textContent ?? "0", 10) >= from + 2, atNotice, { timeout: 15000 })
		.catch(() => expect(false, "slow engine: playback did not continue on its own after a gap"));
	expect(await state() === "playing", `slow engine: state is ${await state()} after gaps, want playing`);
	// Keeping the neural voice only hides the notice: no restart, still playing.
	await page.click("[data-slow-keep]");
	expect(await page.$eval("[data-slow]", (el) => el.hidden), "slow engine: notice still visible after 'Keep neural voice'");
	expect(await state() === "playing", "slow engine: 'Keep neural voice' changed the play state");
	const states = await page.evaluate(() => window.__states);
	expect(states.every((s) => s === "playing"), `slow engine: player left 'playing' without a pause click: ${states.join(", ")}`);
	// Pause happens only via the pause button, and then position holds.
	await page.click("[data-action=play]");
	expect(await state() === "paused", `slow engine: pause button gave state ${await state()}`);
	const held = await position();
	await page.waitForTimeout(3000);
	expect(await position() === held, "slow engine: position moved while paused");
	await page.click("[data-action=play]");
	expect(await state() === "playing", "slow engine: play after pause did not resume");
	// The switch still works mid-playback (the notice is shown again on a fresh page below).
	await page.evaluate(() => { document.querySelector("[data-slow]").hidden = false; });
	await page.click("[data-slow-browser]");
	await page.waitForFunction(() => document.querySelector("[data-engine]").value === "web-speech", null, { timeout: 5000 })
		.catch(() => expect(false, "slow engine: switch to browser voice failed"));
	expect(await page.$eval("[data-slow]", (el) => el.hidden), "slow engine: notice still visible after switching");
	// Next visit on this device starts on the browser voice, and neural stays selectable.
	const again = await ctx.newPage();
	await again.goto(base + PLAYER_POST, { waitUntil: "load" });
	await again.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	expect(await engineValue(again) === "web-speech", "slow device: next visit did not default to the browser voice");
	expect(
		await again.$eval("[data-engine] option[value=kokoro]", (el) => !el.disabled),
		"slow device: neural voice no longer selectable",
	);
	await ctx.close();
});

// 10. Connect once. On a hard load OverlayScrollbars moves every body child into its viewport, which disconnects
// and reconnects <listen-player>. Each connection must leave exactly one set of handlers: one sentinel, one Next
// click moves one sentence, one Play click plays (a second handler would pause it again within milliseconds).
// Clicks are real mouse events (page.click), never el.click().
const position = (page) =>
	page.$eval("[data-position]", (el) => Number.parseInt(el.textContent, 10));
const playerState = (page) =>
	page.$eval("listen-player", (el) => el.dataset.state);
async function expectOneConnection(page, label) {
	await page
		.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 })
		.catch(() => expect(false, `${label}: player missing`));
	// Give a second (stale) init time to finish, as it would on a slow load.
	await page.waitForTimeout(400);
	const shape = await page.evaluate(() => ({
		overlay: !!document.querySelector("body > .os-scrollbar"),
		sentinels: document.querySelectorAll(".listen-sentinel").length,
	}));
	expect(
		shape.overlay,
		`${label}: OverlayScrollbars did not start on the body (scrollbars hidden?), so this check proves nothing`,
	);
	expect(shape.sentinels === 1, `${label}: ${shape.sentinels} .listen-sentinel, expected 1`);
	const start = await position(page);
	await page.click("listen-player [data-action=next]");
	await page.waitForTimeout(100);
	const afterNext = await position(page);
	expect(afterNext === start + 1, `${label}: one Next click moved ${start} -> ${afterNext}, expected ${start + 1}`);
	await page.click("listen-player [data-action=prev]");
	await page.waitForTimeout(100);
	const afterPrev = await position(page);
	expect(afterPrev === start, `${label}: one Prev click moved ${afterNext} -> ${afterPrev}, expected ${start}`);
	await page.click("listen-player [data-action=play]");
	await page.waitForTimeout(500);
	const playing = await playerState(page);
	expect(playing === "playing", `${label}: state ${playing} 500 ms after one Play click, expected playing`);
	await page.click("listen-player [data-action=play]");
	await page.waitForTimeout(300);
	const paused = await playerState(page);
	expect(paused === "paused", `${label}: state ${paused} after one Pause click, expected paused`);
}

// 10a. Browser voice (Web Speech stub): hard load, reload, and a reconnect of the element.
await step("10a. connect once, web speech", async () => {
	const { ctx, page } = await openPage({ width: 1440, height: 900 });
	await expectOneConnection(page, "web speech, hard load");
	await page.reload({ waitUntil: "load" });
	await expectOneConnection(page, "web speech, after reload");
	// Reconnect: remove, append to the body, then put it back where it was. Still one set of handlers.
	await page.evaluate(async () => {
		const el = document.querySelector("listen-player");
		const parent = el.parentNode;
		const next = el.nextSibling;
		el.remove();
		document.body.append(el);
		await new Promise((r) => requestAnimationFrame(r));
		parent.insertBefore(el, next);
	});
	await expectOneConnection(page, "web speech, after reconnect");
	await ctx.close();
});

// 10b. Neural voice (stub engine, consented and stored): hard load and reload. One engine, one init, and two rapid
// Play clicks while the engine initialises never create a second engine or a second init.
await step("10b. connect once, neural", async () => {
	const ctx = await neuralContext(browser, { delayMs: 30, initMs: 300 });
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	// Store the stub files and the consent, as a visitor who downloaded the voice earlier would have them.
	await page.evaluate(async ({ ortUrl, sha }) => {
		// The verified runtime is stored under its cache key (ort-runtime.js), with the real bytes.
		const runtimeBytes = await (await fetch(ortUrl, { mode: "cors" })).arrayBuffer();
		const runtimeCache = await caches.open("ort-runtime-v1");
		await runtimeCache.put(new URL(`/ort-wasm@1.27.0/${sha}`, location.origin).href, new Response(runtimeBytes, { headers: { "content-length": String(runtimeBytes.byteLength) } }));
		const manifest = await (await fetch("/tts/manifest.json")).json();
		const cache = await caches.open("kokoro-tts-v1");
		// A stored file counts by its recorded size (kokoro-cache.ts), so each entry carries the manifest size.
		const entries = [
			...Object.entries(manifest.files).map(([key, file]) => [manifest.base + key, file.bytes]),
			...Object.entries(manifest.local).map(([key, file]) => [new URL(`/tts/${key}`, location.href).href, file.bytes]),
		];
		for (const [url, bytes] of entries)
			await cache.put(url, new Response("stub", { headers: { "content-length": String(bytes) } }));
		localStorage.setItem("listen-prefs", JSON.stringify({ engine: "kokoro", rate: 1 }));
		localStorage.setItem("listen-kokoro-consent", JSON.stringify("fp32"));
	}, { ortUrl: ORT_URL, sha: ORT_SHA });
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	for (const label of ["neural, hard load", "neural, after reload"]) {
		await page.reload({ waitUntil: "load" });
		await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
		await page.waitForTimeout(400);
		expect((await engineValue(page)) === "kokoro", `${label}: stored neural voice not selected`);
		const playButton = await page.$("listen-player [data-action=play]");
		await playButton.scrollIntoViewIfNeeded();
		const box = await playButton.boundingBox();
		const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
		await page.mouse.click(x, y);
		await page.mouse.click(x, y);
		await page.waitForTimeout(800);
		const run = await page.evaluate(() => ({
			engines: window.__stubEngines ?? 0,
			inits: window.__stubInits ?? 0,
			sentinels: document.querySelectorAll(".listen-sentinel").length,
			state: document.querySelector("listen-player").dataset.state,
			status: document.querySelector("[data-status]").textContent,
		}));
		expect(run.engines === 1, `${label}: ${run.engines} neural engines created, expected 1`);
		expect(run.inits === 1, `${label}: ${run.inits} neural inits, expected 1`);
		expect(run.sentinels === 1, `${label}: ${run.sentinels} .listen-sentinel, expected 1`);
		expect(run.state === "playing", `${label}: state ${run.state} after two rapid Play clicks, expected playing (status "${run.status}")`);
		expect(!/call init\(\) first/.test(run.status), `${label}: playback used an engine that was never initialised`);
		expect(errors.length === 0, `${label}: page errors: ${errors.join("; ")}`);
		await page.click("listen-player [data-action=play]");
		await page.waitForTimeout(300);
		const paused = await playerState(page);
		expect(paused === "paused", `${label}: state ${paused} after one Pause click, expected paused`);
	}
	await ctx.close();
});

// 11. Defaults: the neural voice (Heart) when WebGPU exists, the browser voice otherwise, a stored choice wins, and a
// cached model plays with no prompt and no network.
{
	const counter = { hf: 0 };
	const ctx = await neuralContext(browser, { counter });
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	expect(await engineValue(page) === "kokoro", `default with WebGPU: engine is ${await engineValue(page)}, not neural`);
	expect(await page.$eval("[data-voice]", (el) => el.value) === "af_heart", "default neural voice is not Heart (af_heart)");
	expect(await page.$$eval("[data-consent][open]", (els) => els.length) === 0, "default: a prompt opened at page load");
	await page.click("[data-action=play]");
	await page.waitForSelector("[data-consent][open]", { timeout: 4000 })
		.catch(() => expect(false, "default neural: first Play did not ask for consent"));
	await page.click("[data-variant=fp32]");
	await page.waitForFunction(() => /Neural voice: downloaded/.test(document.querySelector("[data-download-state]")?.textContent ?? ""), null, { timeout: 15000 })
		.catch(() => expect(false, "default neural: download did not complete"));
	const before = counter.hf;
	const again = await ctx.newPage();
	await again.goto(base + PLAYER_POST, { waitUntil: "load" });
	await again.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	expect(await engineValue(again) === "kokoro", "cached: default engine is not neural on the next visit");
	await again.click("[data-action=play]");
	await again.waitForFunction(() => document.querySelector("[data-status]")?.textContent !== undefined, null, { timeout: 2000 }).catch(() => {});
	expect(await again.$$eval("[data-consent][open]", (els) => els.length) === 0, "cached: Play asked for consent again");
	expect(counter.hf === before, `cached: ${counter.hf - before} model request(s) on the next visit`);
	await ctx.close();
}
{
	const ctx = await neuralContext(browser, { gpu: false });
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	expect(await engineValue(page) === "web-speech", "no WebGPU: default is not the browser voice");
	await ctx.close();
}
{
	const ctx = await neuralContext(browser, {});
	await ctx.addInitScript(() => localStorage.setItem("listen-engine-choice", JSON.stringify("web-speech")));
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	expect(await engineValue(page) === "web-speech", "stored browser choice did not win over the neural default");
	await ctx.close();
}

// 12. Choices: only an explicit pick persists. A cancelled prompt keeps the neural default for the next visit; an
// explicit "Use browser voice" sticks; two failed starts in a row pause the default (cool-down).
{
	const ctx = await neuralContext(browser, {});
	const first = await ctx.newPage();
	await first.goto(base + PLAYER_POST, { waitUntil: "load" });
	await first.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	await first.click("[data-action=play]");
	await first.waitForSelector("[data-consent][open]", { timeout: 4000 })
		.catch(() => expect(false, "choices: first Play did not ask"));
	await first.click("[data-consent] button[value=cancel]");
	const second = await ctx.newPage();
	await second.goto(base + PLAYER_POST, { waitUntil: "load" });
	await second.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	expect(await engineValue(second) === "kokoro", "cancelled prompt: next visit did not default to neural");
	await ctx.close();
}
{
	const ctx = await neuralContext(browser, {});
	const first = await ctx.newPage();
	await first.goto(base + PLAYER_POST, { waitUntil: "load" });
	await first.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	await first.selectOption("[data-engine]", "web-speech");
	await first.waitForFunction(() => JSON.parse(localStorage.getItem("listen-engine-choice") || "null") === "web-speech", null, { timeout: 4000 })
		.catch(() => expect(false, "explicit browser pick was not stored"));
	const second = await ctx.newPage();
	await second.goto(base + PLAYER_POST, { waitUntil: "load" });
	await second.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	expect(await engineValue(second) === "web-speech", "explicit browser pick did not stick on the next visit");
	await ctx.close();
}
{
	const ctx = await neuralContext(browser, { status: 500, body: "missing" });
	for (let visit = 0; visit < 2; visit += 1) {
		const page = await ctx.newPage();
		await page.goto(base + PLAYER_POST, { waitUntil: "load" });
		await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
		await page.close();
	}
	const third = await ctx.newPage();
	await third.goto(base + PLAYER_POST, { waitUntil: "load" });
	await third.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	expect(await engineValue(third) === "web-speech", "two failed starts: the default was not paused");
	await ctx.close();
}

// 13. ONNX Runtime binary: bytes that do not match the pin are never used (integrity error, browser voice for this
// session); an unreachable host is reported as "host unavailable" after retries, with no automatic second host.
for (const [label, runtime, expected] of [
	["integrity", { body: Buffer.alloc(ORT_BYTES, 0) }, /integrity check/],
	["host", { status: 500 }, /host unavailable/],
]) {
	const ctx = await neuralContext(browser, { runtime });
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player:not([hidden])", { timeout: 8000 });
	await page.click("[data-action=play]");
	await page.waitForSelector("[data-consent][open]", { timeout: 4000 })
		.catch(() => expect(false, `${label}: no consent prompt`));
	await page.click("[data-variant=fp32]");
	await page.waitForFunction((source) => new RegExp(source).test(document.querySelector("[data-status]")?.textContent ?? ""), expected.source, { timeout: 20000 })
		.catch(() => expect(false, `${label}: no runtime error shown`));
	expect(await engineValue(page) === "web-speech", `${label}: the browser voice did not take over`);
	expect(!(await page.evaluate(() => /stored/.test(document.querySelector("[data-runtime-state]")?.textContent ?? ""))), `${label}: runtime reported as stored after a failed check`);
	await ctx.close();
}

// 14. Memory: a download never reads a stored file whole on each progress update. The runtime's "stored" probe used
// to read and hash the 24 MB binary per network chunk, thousands of buffers in flight during the 325 MB model
// download, and the tab crashed (Aw, Snap). Every whole-body read (Response/Blob arrayBuffer, blob, text) is counted.
await step("14. download memory", async () => {
	const WHOLE_READS = `(() => { window.__wholeBytes = 0; for (const proto of [Response.prototype, Blob.prototype]) for (const name of ["arrayBuffer", "blob", "text"]) { const orig = proto[name]; if (!orig) continue; proto[name] = async function (...args) { const out = await orig.apply(this, args); window.__wholeBytes += out.byteLength ?? out.size ?? out.length ?? 0; return out; }; } })();`;
	const ctx = await neuralContext(browser, { init: WHOLE_READS });
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	await page.evaluate(() => (window.__wholeBytes = 0));
	await page.click("[data-action=play]");
	await page.waitForSelector("[data-consent][open]", { timeout: 4000 });
	await page.click("[data-variant=fp32]");
	await page.waitForFunction(() => window.__stubInits > 0, null, { timeout: 20000 })
		.catch(() => expect(false, "download memory: the engine was not initialised"));
	await page.waitForTimeout(500);
	const whole = await page.evaluate(() => window.__wholeBytes);
	expect(whole < 2 * ORT_BYTES, `download memory: ${Math.round(whole / 1e6)} MB read whole during one download (the runtime probe must not read the body)`);
	// Stored under the real keys only: no staging copy is left behind.
	const keys = await page.evaluate(async () => (await (await caches.open("kokoro-tts-v1")).keys()).map((r) => r.url));
	expect(keys.some((u) => u.endsWith("onnx/model.onnx")), "download memory: the model was not stored");
	expect(!keys.some((u) => u.includes("kokoro-staging")), `download memory: staging copies left: ${keys.join(", ")}`);
	await ctx.close();
});

// 15. A model file whose bytes do not match the pinned SHA-256 is never stored (not under its key, not as a staging
// copy); the listener gets the browser voice and the reason.
await step("15. model checksum", async () => {
	const bad = Buffer.alloc(FAKE_FILES["onnx/model.onnx"].length, 1);
	const ctx = await neuralContext(browser, { bodies: { "onnx/model.onnx": bad } });
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player[data-settled]:not([hidden])", { timeout: 8000 });
	await page.click("[data-action=play]");
	await page.waitForSelector("[data-consent][open]", { timeout: 4000 });
	await page.click("[data-variant=fp32]");
	await page.waitForFunction(() => /checksum does not match/.test(document.querySelector("[data-status]")?.textContent ?? ""), null, { timeout: 20000 })
		.catch(() => expect(false, "model checksum: no checksum error shown"));
	expect(await engineValue(page) === "web-speech", "model checksum: the browser voice did not take over");
	const keys = await page.evaluate(async () => (await (await caches.open("kokoro-tts-v1")).keys()).map((r) => r.url));
	expect(!keys.some((u) => /onnx\/model\.onnx/.test(u)), `model checksum: a bad model was stored: ${keys.join(", ")}`);
	await ctx.close();
});

// 11. Pronunciation fixes reach the engine; the highlight still covers the written words.
// A fixture paragraph (independent of the post's prose) exercises the global lexicon (src/data/pronunciations.json:
// Wikipedia), post front matter (data-pronounce, set here) and an inline :say span (data-say); a reconnect re-extracts.
await step("11. pronunciations", async () => {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
	ctx.setDefaultTimeout(10000);
	await ctx.addInitScript(SPEECH_STUB);
	const page = await ctx.newPage();
	await page.goto(`${base}/posts/wikipedia-ai-age/`, { waitUntil: "load" });
	await page.waitForSelector("listen-player:not([hidden])", { timeout: 8000 });
	await page.evaluate(async () => {
		const el = document.querySelector("listen-player");
		el.dataset.pronounce = JSON.stringify({ citation: "sigh tation" });
		const p = document.createElement("p");
		p.innerHTML = 'A plain first sentence. On Wikipedia a citation is a <span data-say="foot note">footnote</span> at the end, not for us.';
		document.querySelector("#post-article .markdown-content")?.prepend(p);
		const parent = el.parentNode;
		const next = el.nextSibling;
		el.remove();
		await new Promise((r) => requestAnimationFrame(r));
		parent.insertBefore(el, next);
	});
	await page.waitForSelector("listen-player:not([hidden])", { timeout: 8000 });
	await page.click("[data-action=play]");
	// Read the highlight in the same frame the second sentence becomes current (stub utterances last 120 ms).
	const highlighted = await page
		.waitForFunction(
			() => {
				if (document.querySelector("[data-listen-current]")?.getAttribute("data-listen-current") !== "s1") return null;
				const hl = CSS.highlights?.get("listen-current");
				return hl ? ([...hl][0]?.toString() ?? "") : "n/a";
			},
			null,
			{ timeout: 5000, polling: 5 },
		)
		.then((h) => h.jsonValue())
		.catch(() => null);
	await page.waitForFunction(() => window.__tts.spoken.length >= 5, null, { timeout: 5000 }).catch(() => {});
	const spoken = await page.evaluate(() => window.__tts.spoken);
	const s1 = spoken[1] ?? "";
	expect(/wicky pedia/.test(s1), `pronounce: global lexicon not applied: "${s1}"`);
	expect(/sigh tation/.test(s1), `pronounce: front matter not applied: "${s1}"`);
	expect(/foot note/.test(s1) && !/footnote/.test(s1), `pronounce: data-say not applied: "${s1}"`);
	expect(/not for us\.$/.test(s1), `pronounce: the pronoun "us" changed: "${s1}"`);
	const raw = spoken.find((t) => /Wikipedia/.test(t));
	expect(!raw, `pronounce: the post's prose reached the engine unfixed: "${raw}"`);
	expect(
		highlighted === "n/a" ||
			highlighted === "On Wikipedia a citation is a footnote at the end, not for us.",
		`pronounce: highlight does not cover the written sentence: "${highlighted}"`,
	);
	await ctx.close();
});

// 6. The player is not on a post that opts out. Opt-out is a front-matter flag, so this checks a standalone page is untouched.
await step("6. opt-out", async () => {
	const ctx = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	});
	const page = await ctx.newPage();
	await page.goto(`${base}/about/`, { waitUntil: "load" });
	expect(
		(await page.$$("listen-player")).length === 0,
		"about page: listen-player present on a non-post page",
	);
	await ctx.close();
});

// 12. Comments: a giscus error other than "Discussion not found" shows the notice in the skeleton's space (no shift,
// widget hidden, retry and discussions link); a retry that gets the normal empty-discussion answer shows the widget.
// giscus is stubbed: client.js and the widget are served for https://giscus.app, so its messages carry that origin.
await step("12. comments: giscus error", async () => {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
	let mode = "error";
	await ctx.route("https://giscus.app/client.js", (route) =>
		route.fulfill({
			contentType: "text/javascript",
			body: `(() => {
				const me = document.currentScript;
				const box = document.createElement("div");
				box.className = "giscus";
				const f = document.createElement("iframe");
				f.className = "giscus-frame";
				f.src = "https://giscus.app/widget?stub=" + Date.now();
				box.append(f);
				me.after(box);
				addEventListener("message", (e) => {
					if (e.origin === "https://giscus.app" && e.data?.giscus?.resizeHeight) f.style.height = e.data.giscus.resizeHeight + "px";
				});
			})();`,
		}),
	);
	await ctx.route("https://giscus.app/widget**", (route) => {
		const msgs =
			mode === "error"
				? [{ resizeHeight: 84 }, { error: "Unable to fetch token from Valkey." }, { resizeHeight: 24 }]
				: [{ resizeHeight: 84 }, { error: "Discussion not found" }, { resizeHeight: 372 }];
		route.fulfill({
			contentType: "text/html",
			body: `<script>${JSON.stringify(msgs)}.forEach((m, i) => setTimeout(() => parent.postMessage({ giscus: m }, "*"), 50 * (i + 1)))</script>`,
		});
	});
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	const below = () =>
		page.evaluate(() => {
			const host = document.getElementById("giscus-comments");
			// First rendered element after the host in document order (the host can be its parent's last child).
			let n = null;
			for (let a = host; a && !n; a = a.parentElement) {
				for (let s = a.nextElementSibling; s && !n; s = s.nextElementSibling) if (s.getBoundingClientRect().height > 0) n = s;
			}
			const g = host.querySelector(".giscus");
			return {
				height: host.getBoundingClientRect().height,
				below: n ? n.getBoundingClientRect().top + window.scrollY : Number.NaN,
				failed: host.hasAttribute("data-failed"),
				loaded: host.hasAttribute("data-loaded"),
				notice: !host.querySelector(".giscus-unavailable").hidden,
				widget: !!g && getComputedStyle(g).display !== "none",
				link: host.querySelector(".giscus-unavailable a")?.getAttribute("href") ?? "",
			};
		});
	const before = await below();
	await page
		.waitForFunction(() => document.getElementById("giscus-comments")?.hasAttribute("data-failed"), null, { timeout: 5000 })
		.catch(() => expect(false, "comments: a giscus error did not show the failure notice"));
	await page.waitForTimeout(400);
	const failed = await below();
	expect(failed.notice && !failed.widget, `comments: on error the notice shows (${failed.notice}) and the widget is hidden (${!failed.widget})`);
	expect(Math.abs(failed.height - before.height) <= 1, `comments: host ${before.height}px -> ${failed.height}px on error, expected no change`);
	expect(Math.abs(failed.below - before.below) <= 1, `comments: content below moved ${failed.below - before.below}px on error`);
	expect(/^https:\/\/github\.com\/[^/]+\/[^/]+\/discussions$/.test(failed.link), `comments: discussions link is ${failed.link}`);
	mode = "notfound";
	await page.click(".giscus-retry");
	await page
		.waitForFunction(() => document.getElementById("giscus-comments")?.hasAttribute("data-loaded"), null, { timeout: 5000 })
		.catch(() => expect(false, "comments: retry did not load the widget"));
	await page.waitForTimeout(600);
	const ok = await below();
	expect(ok.widget && !ok.notice && !ok.failed, `comments: after retry the widget shows (${ok.widget}) and the notice is gone (${!ok.notice})`);
	expect(Math.abs(ok.height - before.height) <= 1, `comments: host ${before.height}px -> ${ok.height}px after retry, expected the empty widget's height`);
	await ctx.close();
});

await browser.close();
server.close();

if (failures.length) {
	console.error("Listen player check failed:");
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
console.log("Listen player check passed.");
