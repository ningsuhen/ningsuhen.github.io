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
} from "node:fs";
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

const browser = await chromium.launch({ executablePath: findChrome() });
const failures = [];
const expect = (ok, message) => {
	if (!ok) failures.push(message);
};

async function openPage(
	viewport,
	{ theme = "light", javaScriptEnabled = true } = {},
) {
	const ctx = await browser.newContext({
		viewport,
		javaScriptEnabled,
		reducedMotion: "reduce",
	});
	await ctx.addInitScript(
		`${SPEECH_STUB}; try { localStorage.setItem("theme", ${JSON.stringify(theme)}); } catch {}`,
	);
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	return { ctx, page };
}

// 1. Progressive enhancement: without JavaScript the player never appears.
{
	const { ctx, page } = await openPage(
		{ width: 1440, height: 900 },
		{ javaScriptEnabled: false },
	);
	const visible = await page
		.$eval("listen-player", (el) => getComputedStyle(el).display !== "none")
		.catch(() => true);
	expect(!visible, "no-JS: listen-player is visible");
	await ctx.close();
}

// 2. Desktop light: renders, plays through the stub, highlight moves, pause stops speech.
{
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
}

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
		.waitForSelector("listen-player:not([hidden])", { timeout: 8000 })
		.catch(() => expect(false, `${name}: player missing`));
	await page.waitForTimeout(300);
	const inline = await page.evaluate(() => {
		const el = document.querySelector("listen-player");
		return {
			top: el.getBoundingClientRect().top,
			docked: el.hasAttribute("data-docked"),
			docHeight: document.documentElement.scrollHeight,
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
				if (!document.elementFromPoint(x, y)?.closest("listen-player")) {
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
			docHeight: document.documentElement.scrollHeight,
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
		Math.abs(docked.docHeight - inline.docHeight) <= 1,
		`${name}: layout shift ${docked.docHeight - inline.docHeight}px on docking`,
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
{
	const { ctx, page } = await openPage({ width: 1440, height: 900 });
	await page.waitForSelector("listen-player:not([hidden])", { timeout: 8000 });
	await page.evaluate(() => window.scrollTo(0, 1500));
	await page.waitForTimeout(300);
	await page.evaluate((href) => window.swup.navigate(href), OTHER_POST);
	await page.waitForURL(`**${OTHER_POST}`, { timeout: 8000 }).catch(() => {});
	await page
		.waitForSelector("listen-player:not([hidden])", { timeout: 8000 })
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
}

// 3. Desktop dark + mobile: collapsed by default, expands on toggle, no horizontal overflow.
for (const [name, viewport, theme] of [
	["desktop-1440-dark", { width: 1440, height: 900 }, "dark"],
	["mobile-375-light", { width: 375, height: 800 }, "light"],
	["mobile-375-dark", { width: 375, height: 800 }, "dark"],
]) {
	const { ctx, page } = await openPage(viewport, { theme });
	await page
		.waitForSelector("listen-player:not([hidden])", { timeout: 8000 })
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
{
	const { ctx, page } = await openPage({ width: 1440, height: 900 });
	await page.waitForSelector("listen-player:not([hidden])", { timeout: 8000 });
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
}

// 5. Neural slot: offered only when window.__KOKORO_READY is set. Choosing it asks first; cancel keeps the built-in voice.
{
	const ctx = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	});
	await ctx.addInitScript(`${SPEECH_STUB}; window.__KOKORO_READY = true;`);
	const page = await ctx.newPage();
	await page.goto(base + PLAYER_POST, { waitUntil: "load" });
	await page.waitForSelector("listen-player:not([hidden])", { timeout: 8000 });
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
}

// 6. The player is not on a post that opts out. Opt-out is a front-matter flag, so this checks a standalone page is untouched.
{
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
}

await browser.close();
server.close();

if (failures.length) {
	console.error("Listen player check failed:");
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
console.log("Listen player check passed.");
