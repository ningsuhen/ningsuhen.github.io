// LPM playground: one shared model card, five business demos and a "your own" tab.
// Everything shown is measured in this browser: the engine (lpm/) runs a small language model on the visitor's GPU and the
// evaluation numbers come from its real answers (eval.js). No mock engine, no invented data, no silent fallback.
import * as lpm from "./lpm/lpm-client.js";
import { chooseThreshold, confusion, curve, isAuto, keywordPredictor, majorityLabel, pct, summarize, wilson } from "./eval.js";

const MODEL_URL = "https://huggingface.co/buckets/ningsuhen/lpm-models/resolve/qwen3-0.6b-f16.lpm1";
const MODEL_BYTES = 1503264868;
const WASM_URL = new URL("./lpm/pkg/lpm_web_bg.wasm", import.meta.url).href;
const STARTER_THRESHOLD = 2.0; // used until an evaluation picks one from data
const TARGET_ACC = 0.9;
const MIN_AUTO = 5;
const METER_MIN_MAX = 8;
const CHUNK = 6;
const MAX_LABELS = 8;
const MAX_SHOTS = 12;

const $ = (id) => document.getElementById(id);
const sleep0 = () => new Promise((r) => setTimeout(r, 0));
const mb = (b) => (b / 1e6).toFixed(b >= 1e8 ? 0 : 1);
const fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${b} bytes`);
const fmtMs = (ms) => (ms >= 10000 ? `${(ms / 1000).toFixed(1)} s` : ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`);
const num = (x, d = 2) => x.toFixed(d);

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}
function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", "rd-icon");
  s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS("http://www.w3.org/2000/svg", "use");
  u.setAttribute("href", `#i-${name}`);
  s.append(u);
  return s;
}
const chip = (text, kind = "neutral", ic) => h("span", { class: `rd-chip rd-chip--${kind}` }, ic ? icon(ic) : null, text);
const clear = (e) => {
  e.replaceChildren();
  return e;
};

// ---- network accounting: Performance resource timing, read for real ------------------------------------------
try {
  performance.setResourceTimingBufferSize(5000);
} catch {
  // keep the default buffer
}
async function requestsSince(t0) {
  await sleep0();
  await sleep0();
  return performance.getEntriesByType("resource").filter((e) => e.startTime >= t0 - 1 && !e.name.startsWith("data:"));
}

// ---- state ----------------------------------------------------------------------------------------------------
const S = {
  gpu: { ok: false, adapter: "", message: "" },
  engineReady: false,
  adapter: "",
  model: "none", // none | loading | ready | lost
  busy: false,
  stop: false,
  prefixKey: null,
  prefixSeen: false,
};
const DEMOS = {};
let RULES = null;

// ---- plain-language errors ------------------------------------------------------------------------------------
function plainError(e) {
  const code = e && e.code;
  const detail = String((e && e.message) || e);
  if (e && e.name === "AbortError") return "Download cancelled. Nothing was kept. Press the button to start again.";
  switch (code) {
    case "NO_WEBGPU":
      return "This browser has no usable WebGPU, so the model cannot run here. Use a recent desktop Chrome or Edge on a computer with a graphics card. Nothing was downloaded and no fake result is shown.";
    case "SOFTWARE_ADAPTER":
      return "The browser offers only a software adapter (the CPU pretending to be a graphics card). This page needs a real GPU and does not fall back to software.";
    case "MODEL_MISSING":
      return `The model could not be downloaded (offline, blocked or the host refused). Nothing was kept. Check the connection and try again, or pick a file you already have. Detail: ${detail}`;
    case "MODEL_CORRUPT":
      return `The model file failed its integrity check, so it was not used. Any cached copy was deleted. Press the button to download it again, or pick a different file. Detail: ${detail}`;
    case "DEVICE_LOST":
      return "The graphics card stopped answering (the browser reset it). Press Load model again: it comes from your browser cache, no new download.";
    case "MODEL_NOT_LOADED":
      return "Load the model first (the card at the top of the page).";
    case "PROMPT_TOO_LONG":
      return `This text is too long for the model's small 512-token window together with the demo's fixed examples. Shorten it. Detail: ${detail}`;
    case "BAD_INPUT":
      return `The settings are not valid: ${detail}`;
    default:
      return `Something failed: ${detail}`;
  }
}

// ---- GPU pre-check (no download) --------------------------------------------------------------------------------
async function checkGpu() {
  if (!navigator.gpu) {
    return { ok: false, adapter: "", message: plainError({ code: "NO_WEBGPU" }) };
  }
  let ad = null;
  try {
    ad = await navigator.gpu.requestAdapter();
  } catch (e) {
    return { ok: false, adapter: "", message: `WebGPU exists but asking for a graphics adapter failed: ${e}` };
  }
  if (!ad) return { ok: false, adapter: "", message: "WebGPU exists but the browser found no graphics adapter. Nothing was downloaded." };
  const info = ad.info || {};
  const name = [info.vendor, info.architecture, info.description || info.device].filter(Boolean).join(" ") || "unnamed adapter";
  if (ad.isFallbackAdapter || info.isFallbackAdapter) return { ok: false, adapter: name, message: plainError({ code: "SOFTWARE_ADAPTER" }) };
  return { ok: true, adapter: name, message: "" };
}

// ---- model card ----------------------------------------------------------------------------------------------------
const card = {
  status: () => $("lp-gpu-status"),
  adapter: () => $("lp-adapter"),
  stage: () => $("lp-stage"),
  fill: () => $("lp-load-fill"),
  meter: () => $("lp-load-meter"),
  facts: () => $("lp-load-facts"),
  msg: () => $("lp-load-msg"),
  go: () => $("lp-load-go"),
  cancel: () => $("lp-load-cancel"),
  file: () => $("lp-load-file"),
  fileBtn: () => $("lp-load-file-btn"),
};

function setStage(text) {
  card.stage().textContent = text;
}
function setProgress(done, total) {
  const pctDone = total ? Math.min(100, (done / total) * 100) : 0;
  card.fill().style.width = `${pctDone}%`;
  card.meter().setAttribute("aria-valuenow", String(Math.round(pctDone)));
}
function showLoadMsg(text, kind = "bad") {
  const m = card.msg();
  m.hidden = !text;
  m.className = `rd-callout rd-callout--${kind} lp-msg`;
  m.textContent = text || "";
}
function setFacts(rows) {
  const dl = clear(card.facts());
  for (const [k, v] of rows) dl.append(h("dt", { text: k }), h("dd", { text: v }));
  dl.hidden = !rows.length;
}

function syncButtons() {
  const ready = S.model === "ready";
  const loading = S.model === "loading";
  card.go().disabled = !S.gpu.ok || loading || S.busy;
  card.fileBtn().disabled = !S.gpu.ok || loading || S.busy;
  card.cancel().hidden = !loading;
  card.go().querySelector(".lp-btn-text").textContent = ready ? "Reload model" : S.model === "lost" ? "Load model again" : "Download and load model";
  for (const d of Object.values(DEMOS)) d.sync();
}

async function loadModel(file) {
  if (S.busy || S.model === "loading") return;
  S.model = "loading";
  S.busy = true;
  S.prefixKey = null;
  showLoadMsg("");
  setFacts([]);
  setProgress(0, 1);
  card.meter().hidden = false;
  syncButtons();
  const ctl = new AbortController();
  S.abort = ctl;
  const realFetch = window.fetch;
  window.fetch = (input, init) => (String(input) === MODEL_URL ? realFetch(input, { ...init, signal: ctl.signal }) : realFetch(input, init));
  const t0 = performance.now();
  try {
    if (!S.engineReady) {
      setStage("Starting the engine (about 0.3 MB) and the word list (about 4.4 MB) from this site...");
      const { adapter } = await lpm.init({ wasmUrl: WASM_URL });
      S.engineReady = true;
      S.adapter = adapter;
      card.adapter().textContent = adapter;
    }
    setStage(file ? `Reading ${file.name} from your disk into the GPU...` : "Reading the model into the GPU (downloading it if it is not in your browser cache)...");
    let last = 0;
    const tStart = performance.now();
    const info = await lpm.loadModel({
      ...(file ? { file } : { url: MODEL_URL }),
      onProgress: (done, total) => {
        const now = performance.now();
        if (now - last < 120 && done < total) return;
        last = now;
        setProgress(done, total);
        const rate = done / Math.max(1, (now - tStart) / 1000);
        setStage(`${mb(done)} of ${mb(total)} MB, ${mb(rate)} MB/s`);
      },
    });
    setProgress(1, 1);
    S.prefixKey = null;
    const reqs = await requestsSince(t0);
    const modelReq = reqs.filter((r) => r.name === MODEL_URL).length;
    S.model = "ready";
    setStage("Model ready.");
    const where = { network: "downloaded just now", opfs: "your browser's private storage (cache)", file: "a file you picked" }[info.source];
    setFacts([
      ["Loaded from", where],
      ["Read", `${fmtBytes(info.bytes)} in ${fmtMs(info.ms)}`],
      ["Kept in cache for next time", info.cached ? "yes" : file ? "no (loaded from a file)" : "no"],
      ["Model requests this load", `${modelReq} (to the model host)`],
    ]);
    if (info.cacheError) showLoadMsg(`The model loaded, but it could not be saved in the browser cache, so the next visit downloads it again. ${info.cacheError}`, "warn");
  } catch (e) {
    S.model = e && e.code === "DEVICE_LOST" ? "lost" : "none";
    setProgress(0, 1);
    setStage("Not loaded.");
    showLoadMsg(plainError(e));
  } finally {
    window.fetch = realFetch;
    S.busy = false;
    S.abort = null;
    syncButtons();
  }
}

function deviceLost() {
  S.model = "lost";
  S.prefixKey = null;
  setStage("Stopped: the GPU was reset.");
  showLoadMsg(plainError({ code: "DEVICE_LOST" }));
  syncButtons();
}

// ---- trace rendering ------------------------------------------------------------------------------------------
const STEPS = [
  ["quote", "1. Your text"],
  ["list", "2. The choices"],
  ["trophy", "3. The winner"],
  ["gauge", "4. How sure"],
  ["route", "5. What the program does"],
  ["code", "6. The code that does it"],
];

function meterWithTick(value, scaleMax, threshold) {
  const w = Math.min(100, (Math.max(0, value) / scaleMax) * 100);
  const t = Math.min(100, (threshold / scaleMax) * 100);
  return h(
    "div",
    { class: "lp-meter" },
    h("div", { class: "rd-meter", role: "meter", "aria-label": "Margin", "aria-valuemin": "0", "aria-valuemax": String(scaleMax), "aria-valuenow": num(value) }, h("span", { class: "rd-meter__fill", style: `width:${w}%` })),
    h("span", { class: "lp-tick", style: `left:${t}%`, title: `Threshold ${num(threshold, 1)}` }),
  );
}

function thresholdSource(d) {
  if (d.thresholdSource === "dev") return "chosen on the dev split";
  if (d.thresholdSource === "you") return "set by you";
  return "starter value, not tuned; run the evaluation to choose from data";
}

// ---- generic demo --------------------------------------------------------------------------------------------------
class Demo {
  constructor(cfg) {
    Object.assign(this, cfg);
    this.threshold = STARTER_THRESHOLD;
    this.thresholdSource = "starter";
    this.eval = null;
    this.last = null;
  }
  get q() {
    return (s) => $(`${this.key}-${s}`);
  }
  labelName(id) {
    return this.names.get(id) ?? id;
  }
  init() {
    const q = this.q;
    q("go").addEventListener("click", () => this.onClassify());
    q("text").addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") this.onClassify();
    });
    q("trace").hidden = false;
    if (this.hasEval) {
      const total = this.items.filter((i) => i.split === "fewshot").length;
      q("promptinfo").textContent = `The model reads the instruction, the ${this.plan.style === "definition" ? "label definitions" : "label names"} and ${this.plan.fewshotIds.length} of the ${total} solved examples in the dataset (the rest do not fit its 512-token window).`;
    }
    this.renderTrace(null);
    this.renderProof(null);
    if (this.hasEval) {
      q("eval").addEventListener("click", () => this.runEval());
      q("stop").addEventListener("click", () => {
        S.stop = true;
      });
      q("thr").addEventListener("input", (e) => this.setThreshold(Number(e.target.value), "you"));
      q("thr-reset").addEventListener("click", () => this.eval && this.setThreshold(this.eval.devPick.threshold, "dev"));
      this.renderExamples();
    }
    this.sync();
  }
  sync() {
    const ready = S.model === "ready" && !S.busy;
    const q = this.q;
    q("go").disabled = !ready;
    q("hint").textContent = S.model === "ready" ? (S.busy ? "The GPU is busy with another run." : "") : "Load the model first (card at the top of the page).";
    if (this.hasEval) {
      q("eval").disabled = !ready;
      q("stop").hidden = !(S.busy && this.evalRunning);
    }
  }

  // ---- classify one text
  spec() {
    return this.specValue;
  }
  async classifyText(text) {
    const spec = this.spec();
    const key = JSON.stringify(spec);
    const first = S.prefixKey !== key;
    const t0 = performance.now();
    let r;
    try {
      r = await lpm.classify({ text, ...spec });
    } catch (e) {
      if (e && e.code === "DEVICE_LOST") deviceLost();
      throw e;
    }
    const wall = performance.now() - t0;
    S.prefixKey = key;
    const reqs = await requestsSince(t0);
    return { r, wall, first, reqs, text };
  }
  async onClassify() {
    if (S.busy || S.model !== "ready") return;
    const text = this.q("text").value.trim();
    const msg = this.q("msg");
    msg.hidden = true;
    if (!text) {
      msg.hidden = false;
      msg.textContent = "Type some text or pick an example first.";
      return;
    }
    let call;
    S.busy = true;
    syncButtons();
    this.q("go").setAttribute("aria-busy", "true");
    if (S.prefixKey !== JSON.stringify(this.spec())) this.q("hint").textContent = "First call for this demo: reading its fixed examples through the model once. This can take tens of seconds.";
    try {
      call = await this.classifyText(text);
    } catch (e) {
      msg.hidden = false;
      msg.textContent = plainError(e);
      return;
    } finally {
      S.busy = false;
      this.q("go").removeAttribute("aria-busy");
      syncButtons();
    }
    this.last = call;
    this.renderTrace(call);
    this.renderProof(call);
  }

  outcome(r, call) {
    return this.rule(r, this, call);
  }
  // ---- the live trace
  renderTrace(call) {
    const ol = clear(this.q("trace"));
    const bodies = STEPS.map(([ic, title]) => {
      const body = h("div", { class: "lp-step__b" });
      ol.append(h("li", { class: "lp-step" }, h("div", { class: "lp-step__t" }, icon(ic), title), body));
      return body;
    });
    if (!call) {
      for (const b of bodies) b.append(h("p", { class: "lp-muted", text: "Waiting for you to press Classify." }));
      bodies[3].append(h("p", { class: "lp-muted lp-explain" }, "Margin is how far ahead the winner is over the runner-up, in the model's own units. Bigger means surer. It is not a percentage."));
      return;
    }
    const { r, text } = call;
    const t = this.threshold;
    // 1 text
    bodies[0].append(h("blockquote", { class: "lp-quote", text }));
    // 2 choices
    const runnerUp = r.scores[1] ? r.scores[1].label : null;
    bodies[1].append(
      h(
        "ul",
        { class: "lp-choices" },
        this.labels.map((l) =>
          h(
            "li",
            { class: l.id === r.label ? "is-win" : l.id === runnerUp ? "is-second" : "" },
            h("span", { class: "lp-choice__name", text: this.labelName(l.id) }),
            l.id === r.label ? chip("winner", "good") : l.id === runnerUp ? chip("runner-up", "neutral") : h("span", { class: "lp-muted", text: "behind" }),
          ),
        ),
      ),
      h("p", { class: "lp-muted lp-explain", text: "The model scored every choice, but the GPU hands back only the top two. The rest are simply behind." }),
    );
    // 3 winner
    const win = h("p", { class: "lp-win" }, this.labelName(r.label));
    bodies[2].append(win);
    const known = this.byText?.get(text);
    if (known) {
      const ok = known.label === r.label;
      bodies[2].append(h("p", { class: "lp-muted" }, ok ? icon("circle-check") : icon("circle-x"), ` The dataset's answer for this example is "${this.labelName(known.label)}": ${ok ? "the model agrees." : "the model got this one wrong."}`));
    } else if (this.byText) {
      bodies[2].append(h("p", { class: "lp-muted", text: "This text is not one of the dataset examples, so there is no answer key to compare with." }));
    }
    if (this.regexCheck) {
      const rx = this.regexCheck(text);
      const modelOk = r.label === "clean" && r.margin >= t;
      const blocked = rx !== "clean" || !modelOk;
      bodies[2].append(
        h(
          "div",
          { class: "lp-compare" },
          h("div", {}, h("p", { class: "lp-muted", text: "Model" }), h("p", { class: "lp-win", text: this.labelName(r.label) }), h("p", { class: "lp-muted lp-explain", text: modelOk ? "clean, clear margin" : r.label !== "clean" ? "flags it" : "clean but a close call: treated as not clean" })),
          h("div", {}, h("p", { class: "lp-muted", text: "Plain regex check" }), h("p", { class: "lp-win", text: this.labelName(rx) }), h("p", { class: "lp-muted lp-explain", text: "exact patterns only, no model" })),
          h("div", {}, h("p", { class: "lp-muted", text: "Combined verdict" }), h("p", { class: "lp-win" }, chip(blocked ? "blocked" : "allowed", blocked ? "bad" : "good", blocked ? "circle-x" : "circle-check")), h("p", { class: "lp-muted lp-explain", text: "blocked if either one objects" })),
        ),
      );
    }
    // 4 margin
    const scaleMax = Math.max(METER_MIN_MAX, this.eval?.maxMargin ?? 0, r.margin);
    const clearEnough = r.margin >= t;
    bodies[3].append(
      h("p", { class: "lp-big" }, `margin ${num(r.margin)}`, " ", chip(clearEnough ? "clear" : "close call", clearEnough ? "good" : "warn", clearEnough ? "circle-check" : "triangle-alert")),
      meterWithTick(r.margin, scaleMax, t),
      h("p", { class: "lp-muted lp-explain" }, `The tick marks the bar for acting alone: ${num(t, 1)} (${thresholdSource(this)}). Margin is how far ahead the winner is over the runner-up. Bigger means surer. It is not a percentage.`),
    );
    // 5 outcome
    const o = this.outcome(r, call);
    bodies[4].append(h("div", { class: `rd-callout rd-callout--${o.kind} lp-outcome` }, h("strong", { text: o.text }), o.detail ? h("span", { text: ` ${o.detail}` }) : null));
    if (o.extra) bodies[4].append(o.extra);
    // 6 code
    bodies[5].append(h("pre", { class: "lp-code" }, h("code", { text: this.snippet(t) })), h("p", { class: "lp-muted lp-explain", text: "This is the whole branch. The model returns a label and a margin; ordinary code does the rest." }));
  }

  // ---- proof strip
  renderProof(call) {
    const box = clear(this.q("proof"));
    const dash = "-";
    const cell = (value, label, note, tone) =>
      h("div", { class: `rd-stat${tone ? ` rd-stat--${tone}` : ""}` }, h("div", { class: "rd-stat__value", text: value }), h("div", { class: "rd-stat__label", text: label }), note ? h("div", { class: "lp-statnote", text: note }) : null);
    if (!call) {
      box.append(cell(dash, "Time for this call"), cell(dash, "Read back from the GPU"), cell(dash, "Network requests during this call"), cell(S.adapter || S.gpu.adapter || dash, "Graphics card"), cell(dash, "Prompt size"));
    } else {
      const { r, reqs, first } = call;
      box.append(
        cell(fmtMs(r.ms), "Time for this call", first ? "First call for this demo: includes the one-time prefix prefill, see below." : "The prefix was already read, so this is your text only."),
        cell(`${r.bytesReadBack} bytes`, "Read back from the GPU", "Just the winner and the margin."),
        cell(String(reqs.length), "Network requests during this call", reqs.length ? reqs.map((e) => e.name.split("?")[0]).slice(0, 3).join(", ") : "Measured with the browser's resource timing."),
        cell(S.adapter || S.gpu.adapter, "Graphics card"),
        cell(String(r.promptTokens), "Prompt size", "tokens the model read, out of 512."),
      );
    }
    const note = this.q("proof-note");
    note.textContent = call
      ? call.first
        ? "This was the first call with this demo's instructions and examples. The engine first reads those fixed examples through the model once and keeps the result on the GPU (the prefix prefill). That is why this call took much longer than the next one will. Calls after this one only process your text, until you switch to another demo or change the prompt."
        : "The fixed instructions and examples were already on the GPU from an earlier call, so this call only processed your text."
      : "The first call for each demo is much slower: the engine reads the demo's fixed instructions and examples through the model once and keeps the result on the GPU (the prefix prefill). Later calls only process your text.";
  }

  // ---- examples
  renderExamples() {
    const box = clear(this.q("examples"));
    this.exampleButtons = new Map();
    for (const it of this.examples) {
      const b = h("button", { type: "button", class: "rd-btn rd-btn--sm lp-ex", title: "Put this example in the box" }, h("span", { class: "lp-ex__t", text: it.text.length > 44 ? `${it.text.slice(0, 42).trim()}...` : it.text }));
      b.addEventListener("click", () => {
        this.q("text").value = it.text;
        this.q("text").focus();
      });
      this.exampleButtons.set(it.id, b);
      box.append(b);
    }
  }
  markTricky() {
    if (!this.eval) return;
    const wrong = new Set(this.eval.test.filter((r) => r.pred !== r.gold).map((r) => r.id));
    for (const [id, b] of this.exampleButtons) {
      b.querySelector(".lp-ex__flag")?.remove();
      if (wrong.has(id)) b.append(h("span", { class: "lp-ex__flag" }, chip("tricky", "warn")));
      b.classList.toggle("is-tricky", wrong.has(id));
    }
  }

  // ---- evaluation
  async runEval() {
    if (S.busy || S.model !== "ready") return;
    const q = this.q;
    const spec = this.spec();
    const dev = this.items.filter((i) => i.split === "dev");
    const test = this.items.filter((i) => i.split === "test");
    const todo = [...dev.map((i) => ({ i, set: "dev" })), ...test.map((i) => ({ i, set: "test" }))];
    S.busy = true;
    S.stop = false;
    this.evalRunning = true;
    syncButtons();
    q("eval-msg").hidden = true;
    q("eval-progress").hidden = false;
    const key = JSON.stringify(spec);
    const wasFirst = S.prefixKey !== key;
    const t0 = performance.now();
    const rows = [];
    const results = [];
    try {
      for (let at = 0; at < todo.length; at += CHUNK) {
        if (S.stop) throw Object.assign(new Error("stopped"), { stopped: true });
        const slice = todo.slice(at, at + CHUNK);
        q("eval-status").textContent = `Running ${Math.min(at + CHUNK, todo.length)} of ${todo.length} (${at < dev.length ? "dev" : "test"} split)...${wasFirst && at === 0 ? " The first call reads this demo's fixed examples through the model once; that can take tens of seconds." : ""}`;
        q("eval-fill").style.width = `${(at / todo.length) * 100}%`;
        q("eval-meter").setAttribute("aria-valuenow", String(Math.round((at / todo.length) * 100)));
        const { results: rs } = await lpm.classifyBatch(slice.map((s) => s.i.text), spec);
        rs.forEach((r, k) => {
          const it = slice[k];
          rows.push({ id: it.i.id, text: it.i.text, gold: it.i.label, pred: r.label, margin: r.margin, ambiguous: it.i.ambiguous, note: it.i.note ?? null, set: it.set, ms: r.ms });
          results.push(r);
        });
        await sleep0();
      }
      S.prefixKey = key;
      const totalMs = performance.now() - t0;
      const reqs = await requestsSince(t0);
      const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
            this.finishEval(rows, { totalMs, requests: reqs.length, calls: rows.length, median, prefillMs: wasFirst ? Math.max(0, results[0].ms - median) : 0 });
    } catch (e) {
      q("eval-msg").hidden = false;
      q("eval-msg").textContent = e.stopped ? "Stopped. No numbers are shown for a partial run." : `Evaluation stopped: ${plainError(e)} No numbers are shown for a partial run.`;
      if (e && e.code === "DEVICE_LOST") deviceLost();
    } finally {
      S.busy = false;
      this.evalRunning = false;
      q("eval-progress").hidden = true;
      syncButtons();
    }
  }

  finishEval(rows, run) {
    const dev = rows.filter((r) => r.set === "dev");
    const test = rows.filter((r) => r.set === "test");
    const devPick = chooseThreshold(dev, this.alwaysHuman, TARGET_ACC, MIN_AUTO);
    const chosen = devPick.reached ? devPick : { threshold: devPick.best?.threshold ?? STARTER_THRESHOLD, ...(devPick.best ?? {}) };
    const maxMargin = Math.ceil(Math.max(...rows.map((r) => r.margin), 1));
    const testItems = this.items.filter((i) => i.split === "test");
    const maj = majorityLabel(this.items);
    const kw = keywordPredictor(this.id, this.labels.map((l) => l.id), RULES);
    const base = {
      majority: { label: maj, correct: testItems.filter((i) => i.label === maj).length },
      keyword: { correct: testItems.filter((i) => kw(i.text) === i.label).length, preds: new Map(testItems.map((i) => [i.id, kw(i.text)])) },
    };
    this.eval = { dev, test, devPick: { ...chosen, reached: devPick.reached }, devPickRaw: devPick, maxMargin, run, base, n: test.length, nDev: dev.length };
    this.thresholdSource = "dev";
    this.threshold = this.eval.devPick.threshold;
    const slider = this.q("thr");
    slider.max = String(maxMargin);
    slider.value = String(this.threshold);
    this.q("thr-box").hidden = false;
    this.q("thr-empty").hidden = true;
    this.q("wrong-empty").hidden = true;
    this.renderEval();
    this.markTricky();
    if (this.last) this.renderTrace(this.last);
    this.q("acc-out").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  setThreshold(t, source) {
    this.threshold = Math.round(t * 10) / 10;
    this.thresholdSource = source;
    this.q("thr").value = String(this.threshold);
    this.renderEval(true);
    if (this.last) this.renderTrace(this.last);
  }

  renderEval(onlyThreshold = false) {
    const E = this.eval;
    if (!E) return;
    const t = this.threshold;
    const sTest = summarize(E.test, t, this.alwaysHuman);
    const ci = wilson(sTest.correct, sTest.n);
    const ciAuto = wilson(sTest.autoCorrect, sTest.auto);
    const q = this.q;
    q("thr-readout").textContent = num(t, 1);
    q("thr-src").textContent = thresholdSource(this);

    // slider block (section 5)
    const box = clear(q("thr-out"));
    box.append(
      h(
        "div",
        { class: "rd-stats" },
        this.stat(sTest.n ? pct(sTest.auto / sTest.n) : "-", "Handled by the program alone", `${sTest.auto} of ${sTest.n} test items`),
        this.stat(sTest.auto ? pct(sTest.autoCorrect / sTest.auto) : "n/a", "Right, among those", sTest.auto ? `${sTest.autoCorrect} of ${sTest.auto}; 95% interval ${pct(ciAuto.lo, 0)} to ${pct(ciAuto.hi, 0)}` : "nothing handled alone"),
        this.stat(String(sTest.human), "Sent to a person", `${pct(sTest.human / sTest.n, 0)} of the test items`),
      ),
      this.chart(E, t),
    );

    // accuracy card (section 4)
    const acc = clear(q("acc-out"));
    const dp = E.devPick;
    acc.append(
      h(
        "p",
        { class: "lp-lead" },
        dp.reached
          ? `Step 1, on the dev split (${E.nDev} items): the lowest margin at which the auto-handled answers are at least ${pct(TARGET_ACC, 0)} right is ${num(dp.threshold, 1)}. That is the bar.`
          : `Step 1, on the dev split (${E.nDev} items): no margin got the auto-handled answers to ${pct(TARGET_ACC, 0)} right (with at least ${MIN_AUTO} items handled alone). The best was ${dp.autoCorrect} of ${dp.auto} right (${pct(dp.autoCorrect / dp.auto, 0)}) at margin ${num(dp.threshold, 1)}, so ${this.noun} cannot be trusted to act alone to that standard here.`,
      ),
      h("p", { class: "lp-lead" }, `Step 2, on the held-out test split (${E.n} items, used once), with the bar at ${num(t, 1)} (${thresholdSource(this)}):`),
      h(
        "div",
        { class: "rd-stats" },
        this.stat(pct(ci.p), "Accuracy, all items", `${sTest.correct} of ${sTest.n} right; 95% interval ${pct(ci.lo, 0)} to ${pct(ci.hi, 0)}`, "candidate"),
        this.stat(sTest.auto ? pct(sTest.autoCorrect / sTest.auto) : "n/a", "Accuracy, handled alone", sTest.auto ? `${sTest.autoCorrect} of ${sTest.auto}; 95% interval ${pct(ciAuto.lo, 0)} to ${pct(ciAuto.hi, 0)}` : "nothing was handled alone"),
        this.stat(pct(sTest.auto / sTest.n), "Share handled alone", `${sTest.auto} of ${sTest.n}`),
        this.stat(String(sTest.human), "Sent to a person", `${sTest.n - sTest.auto} of ${sTest.n}`),
      ),
      this.cmpTable(E, sTest, ci),
      h("p", { class: "lp-muted lp-explain", text: `n = ${E.n} test items is small: read the intervals, not just the percentages. The items are fictional and were written by an AI model.` }),
      this.cleanNote(E),
      this.confusionTable(E),
      this.runNote(E),
      this.extra ? this.extra(E, t) : null,
    );
    this.renderWrong();
  }

  stat(value, label, note, tone) {
    return h("div", { class: `rd-stat${tone ? ` rd-stat--${tone}` : ""}` }, h("div", { class: "rd-stat__value", text: value }), h("div", { class: "rd-stat__label", text: label }), note ? h("div", { class: "lp-statnote", text: note }) : null);
  }

  cmpTable(E, sTest, ci) {
    const n = E.n;
    const row = (name, correct, note, best) => {
      const w = wilson(correct, n);
      return h("tr", { class: best ? "" : "rd-table__ref" }, h("td", { text: name }), h("td", { class: `rd-num${best ? " rd-best" : ""}`, text: pct(correct / n) }), h("td", { class: "rd-num", text: `${pct(w.lo, 0)} to ${pct(w.hi, 0)}` }), h("td", { text: note }));
    };
    const model = row("The model (this page, your GPU)", sTest.correct, "Every item through the model, before any threshold.", true);
    const kw = row("Keyword / regex rules", E.base.keyword.correct, this.id === "sensitive-text-gate" ? "Plain regular expressions for emails, phone numbers, card numbers, ID numbers and key formats." : "Hand-written word lists per label, written from the label definitions before the texts were read.", false);
    const mj = row("Always the most common label", E.base.majority.correct, `Always answers "${this.labelName(E.base.majority.label)}".`, false);
    return h("div", { class: "rd-table-wrap" }, h("table", { class: "rd-table" }, h("caption", { text: `Test split, n = ${n}. Same items for all three rows.` }), h("thead", {}, h("tr", {}, h("th", { text: "Method" }), h("th", { class: "rd-num", text: "Accuracy" }), h("th", { class: "rd-num", text: "95% interval" }), h("th", { text: "What it is" }))), h("tbody", {}, model, kw, mj)));
  }

  cleanNote(E) {
    const clean = E.test.filter((r) => !r.ambiguous);
    const amb = E.test.length - clean.length;
    if (!amb) return null;
    const c = clean.filter((r) => r.pred === r.gold).length;
    return h("p", { class: "lp-muted lp-explain", text: `${amb} of the ${E.n} test items are marked ambiguous by the dataset author (a reasonable person could pick another label). On the other ${clean.length}, the model is right on ${c} (${pct(c / clean.length)}).` });
  }

  confusionTable(E) {
    const ids = this.labels.map((l) => l.id);
    const m = confusion(E.test, ids);
    const head = h("tr", {}, h("th", { text: "Right answer (down) / model said (across)" }), ids.map((id) => h("th", { class: "rd-num", text: this.labelName(id) })));
    const body = ids.map((g) => h("tr", {}, h("th", { scope: "row", text: this.labelName(g) }), ids.map((p) => h("td", { class: `rd-num${g === p ? " lp-diag" : m[g][p] ? " lp-off" : ""}`, text: String(m[g][p]) }))));
    return h("div", { class: "lp-cm" }, h("h3", { text: "Where the answers land" }), h("div", { class: "rd-table-wrap" }, h("table", { class: "rd-table" }, h("thead", {}, head), h("tbody", {}, body))), h("p", { class: "lp-muted lp-explain", text: "Each row is the right answer; each column is what the model said. The shaded diagonal is correct." }));
  }

  runNote(E) {
    const r = E.run;
    return h("p", { class: "lp-muted lp-explain", text: `This run: ${r.calls} calls in ${fmtMs(r.totalMs)} on your GPU. A typical call took ${fmtMs(r.median)} (median)${r.prefillMs ? `; the first call took ${fmtMs(r.prefillMs)} longer because it read the demo's fixed examples through the model once` : ""}. ${r.requests} network requests during the whole run.` });
  }

  chart(E, t) {
    const W = 640;
    const Hh = 210;
    const pad = { l: 44, r: 12, t: 12, b: 34 };
    const max = E.maxMargin;
    const pts = curve(E.test, this.alwaysHuman, max, 80);
    const X = (v) => pad.l + (v / max) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - v) * (Hh - pad.t - pad.b);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("class", "lp-chart");
    svg.setAttribute("aria-label", "Share handled alone and its accuracy as the margin threshold moves from 0 to the largest margin seen");
    const add = (tag, attrs, text) => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text != null) e.textContent = text;
      svg.append(e);
      return e;
    };
    for (const g of [0, 0.25, 0.5, 0.75, 1]) {
      add("line", { x1: pad.l, x2: W - pad.r, y1: Y(g), y2: Y(g), stroke: "var(--rd-line-soft)", "stroke-width": 1 });
      add("text", { x: pad.l - 6, y: Y(g) + 4, "text-anchor": "end", class: "lp-axis" }, `${g * 100}%`);
    }
    const ticks = Math.min(max, 8);
    for (let i = 0; i <= ticks; i++) {
      const v = (max * i) / ticks;
      add("text", { x: X(v), y: Hh - 16, "text-anchor": "middle", class: "lp-axis" }, num(v, v % 1 ? 1 : 0));
    }
    add("text", { x: (pad.l + W - pad.r) / 2, y: Hh - 2, "text-anchor": "middle", class: "lp-axis" }, "margin threshold");
    const line = (key, color, dash) => {
      let d = "";
      let pen = false;
      for (const p of pts) {
        const v = p[key];
        if (v == null) {
          pen = false;
          continue;
        }
        d += `${pen ? "L" : "M"}${X(p.t).toFixed(1)} ${Y(v).toFixed(1)}`;
        pen = true;
      }
      add("path", { d, fill: "none", stroke: color, "stroke-width": 2.5, ...(dash ? { "stroke-dasharray": dash } : {}) });
    };
    line("share", "var(--rd-cat-3)", "6 4");
    line("acc", "var(--rd-accent)");
    add("line", { x1: X(t), x2: X(t), y1: pad.t, y2: Hh - pad.b, stroke: "var(--rd-text-strong)", "stroke-width": 1.5 });
    return h(
      "figure",
      { class: "rd-figure" },
      svg,
      h("ul", { class: "rd-legend" }, h("li", {}, h("span", { class: "rd-legend__swatch", style: "--c: var(--rd-accent)" }), "Right, among those handled alone"), h("li", {}, h("span", { class: "rd-legend__swatch rd-legend__swatch--square", style: "--c: var(--rd-cat-3)" }), "Share handled alone")),
      h("figcaption", { text: "Computed from the model's real answers on the test split. The vertical line is the current threshold. A raised bar sends more items to a person. Whether the rest get more accurate is what the blue line shows; it breaks where nothing is handled alone." }),
    );
  }

  renderWrong() {
    const E = this.eval;
    if (!E) return;
    const t = this.threshold;
    const wrong = E.test.filter((r) => r.pred !== r.gold);
    const autoWrong = wrong.filter((r) => isAuto(r, t, this.alwaysHuman));
    const escCorrect = E.test.filter((r) => r.pred === r.gold && !isAuto(r, t, this.alwaysHuman));
    const out = clear(this.q("wrong-out"));
    out.append(
      h("p", { class: "lp-lead" }, `${wrong.length} of ${E.n} test answers are wrong. With the bar at ${num(t, 1)}, ${wrong.length - autoWrong.length} of them would reach a person, and ${autoWrong.length} would be acted on automatically: ${autoWrong.length ? "those are the costly ones." : "none got through."}`),
    );
    const item = (r) => {
      const isAuto_ = isAuto(r, t, this.alwaysHuman);
      const right = r.pred === r.gold;
      const b = h("button", { type: "button", class: "rd-btn rd-btn--sm" }, "Try this one");
      b.addEventListener("click", () => {
        this.q("text").value = r.text;
        this.q("try").scrollIntoView({ behavior: "smooth", block: "start" });
        this.q("text").focus({ preventScroll: true });
      });
      return h(
        "li",
        { class: `lp-wrong${right ? "" : " is-wrong"}` },
        h("blockquote", { class: "lp-quote", text: r.text }),
        h(
          "p",
          { class: "lp-wrong__meta" },
          right ? chip("right answer", "good") : chip("wrong", "bad", "circle-x"),
          ` model said "${this.labelName(r.pred)}"; right answer "${this.labelName(r.gold)}"; margin ${num(r.margin)} `,
          isAuto_ ? chip(right ? "handled alone" : "would be acted on", right ? "neutral" : "bad") : chip("goes to a person", "good"),
          r.ambiguous ? chip("ambiguous", "warn") : null,
        ),
        r.ambiguous && r.note ? h("p", { class: "lp-muted lp-explain", text: `Why ambiguous (dataset note): ${r.note}` }) : null,
        b,
      );
    };
    if (wrong.length) out.append(h("ul", { class: "lp-wronglist" }, wrong.sort((a, b) => b.margin - a.margin).map(item)));
    if (escCorrect.length)
      out.append(h("details", { class: "rd-fold" }, h("summary", { text: `${escCorrect.length} right answers that still go to a person at this bar` }), h("ul", { class: "lp-wronglist" }, escCorrect.sort((a, b) => a.margin - b.margin).map(item))));
  }
}

// ---- demo configs -----------------------------------------------------------------------------------------------
const num1 = (x) => num(x, 1);

function cfgFor(id) {
  const T = (t) => num1(t);
  switch (id) {
    case "email-triage":
      return {
        key: "email",
        noun: "the model",
        alwaysHuman: [],
        rule: (r, d) =>
          r.margin >= d.threshold
            ? { kind: "good", text: `Goes to the "${d.labelName(r.label)}" folder.`, detail: "Code only files the email. It never deletes, archives or answers anything." }
            : { kind: "warn", text: 'Goes to the "Needs a look" folder.', detail: `The margin ${num(r.margin)} is below ${T(d.threshold)}, so a person decides.` },
        snippet: (t) => `const r = await classify({ text: email.body, instruction, labels, fewshots });
if (r.margin < ${T(t)}) return moveTo("Needs a look", email);
return moveTo(FOLDER[r.label], email);   // file it, never delete or reply`,
      };
    case "ticket-routing":
      return {
        key: "ticket",
        noun: "the model",
        alwaysHuman: ["cancellation"],
        rule: (r, d) =>
          r.label === "cancellation"
            ? { kind: "warn", text: "Goes to a human retention agent.", detail: "Cancellations always do, whatever the margin." }
            : r.margin >= d.threshold
              ? { kind: "good", text: `Goes to the ${d.labelName(r.label)} team queue.` }
              : { kind: "warn", text: "Goes to the general queue.", detail: `The margin ${num(r.margin)} is below ${T(d.threshold)}, so no team is picked automatically.` },
        snippet: (t) => `const r = await classify({ text: ticket.body, instruction, labels, fewshots });
if (r.label === "cancellation") return assign("retention-agent", ticket);   // a human, always
if (r.margin < ${T(t)}) return assign("general-queue", ticket);
return assign(TEAM[r.label], ticket);`,
      };
    case "document-type":
      return {
        key: "doc",
        noun: "the model",
        alwaysHuman: [],
        rule: (r, d) =>
          r.margin >= d.threshold
            ? { kind: "good", text: `Filed as: ${d.labelName(r.label)}.`, detail: "The model only picks the type. It never reads an amount, date or total." }
            : { kind: "warn", text: "Goes to the manual-sort pile.", detail: `The margin ${num(r.margin)} is below ${T(d.threshold)}, so a person sorts it.` },
        snippet: (t) => `const r = await classify({ text: doc.text, instruction, labels, fewshots });
if (r.margin < ${T(t)}) return manualSortPile.add(doc);
return folders[r.label].add(doc);   // type only: amounts and dates are checked elsewhere`,
      };
    case "lead-intent":
      return {
        key: "lead",
        noun: "the model",
        alwaysHuman: [],
        rule: (r, d) =>
          r.margin >= d.threshold
            ? { kind: "good", text: `Tagged "${d.labelName(r.label)}" and queued for a person.`, detail: "The label only sets the queue and the routing. A person decides what to do with every lead." }
            : { kind: "warn", text: "Moves up the review queue.", detail: `The margin ${num(r.margin)} is below ${T(d.threshold)}: uncertain leads get a person's eyes first. Nothing is rejected or answered by code.` },
        snippet: (t) => `const r = await classify({ text: lead.message, instruction, labels, fewshots });
const priority = r.margin < ${T(t)} ? "review-first" : PRIORITY[r.label];
queue.add(lead, { tag: r.label, priority });   // never reject, delete or auto-reply`,
      };
    case "sensitive-text-gate":
      return {
        key: "sens",
        noun: "the model",
        alwaysHuman: [],
        rule: (r, d, call) => {
          const rx = d.regexCheck(call.text);
          const modelOk = r.label === "clean" && r.margin >= d.threshold;
          const ok = rx === "clean" && modelOk;
          if (ok) return { kind: "good", text: "Allowed to paste: both checks found nothing.", detail: "This is a speed bump for accidents, not a compliance control." };
          const why = [];
          if (rx !== "clean") why.push(`the regex check found ${d.labelName(rx).toLowerCase()}`);
          if (r.label !== "clean") why.push(`the model says ${d.labelName(r.label).toLowerCase()}`);
          else if (r.margin < d.threshold) why.push(`the model said clean but only narrowly (margin ${num(r.margin)}, bar ${T(d.threshold)}), and the gate fails closed`);
          return { kind: "bad", text: "Blocked: do not paste this into a cloud assistant.", detail: `Why: ${why.join("; ")}.` };
        },
        snippet: (t) => `const r = await classify({ text, instruction, labels, fewshots });
const regexLabel = plainRegexCheck(text);               // your own regexes, no model
const safe = regexLabel === "clean" && r.label === "clean" && r.margin >= ${T(t)};
if (!safe) return block(text, "Check this text first.");   // fail closed
return sendToCloudAssistant(text);`,
      };
    default:
      throw new Error(`unknown demo ${id}`);
  }
}

function buildSpec(ds, plan) {
  const style = plan.style;
  const labels = ds.labels.map((l) => ({ id: l.id, description: style === "definition" ? l.definition : l.name }));
  const byId = new Map(ds.items.map((i) => [i.id, i]));
  const fewshots = plan.fewshotIds.map((id) => ({ text: byId.get(id).text, label: byId.get(id).label }));
  return { instruction: ds.instruction, labels, fewshots };
}

function pickExamples(items, labels, n = 8) {
  const test = items.filter((i) => i.split === "test");
  const per = labels.map((l) => test.filter((i) => i.label === l.id));
  const out = [];
  for (let r = 0; out.length < n && r < 4; r++) for (const q of per) if (out.length < n && q[r]) out.push(q[r]);
  return out;
}

async function loadDemos() {
  const [rules, plans] = await Promise.all([fetch("./data/baseline-rules.json").then((r) => r.json()), fetch("./data/prompts.json").then((r) => r.json())]);
  RULES = rules;
  const ids = ["email-triage", "ticket-routing", "document-type", "lead-intent", "sensitive-text-gate"];
  const sets = await Promise.all(ids.map((id) => fetch(`./data/${id}.json`).then((r) => r.json())));
  sets.forEach((ds) => {
    const cfg = cfgFor(ds.id);
    const plan = plans[ds.id];
    const demo = new Demo({
      ...cfg,
      id: ds.id,
      hasEval: true,
      ds,
      items: ds.items,
      labels: ds.labels,
      names: new Map(ds.labels.map((l) => [l.id, l.name])),
      byText: new Map(ds.items.map((i) => [i.text, i])),
      specValue: buildSpec(ds, plan),
      examples: pickExamples(ds.items, ds.labels),
      plan,
    });
    if (ds.id === "sensitive-text-gate") {
      demo.regexCheck = keywordPredictor(ds.id, [], rules);
      demo.extra = sensExtra(demo);
    }
    DEMOS[cfg.key] = demo;
  });
}

// Demo 5 extra: the plain regex check next to the model, and both together.
function sensExtra(d) {
  return (E, t) => {
    const sens = E.test.filter((r) => r.gold !== "clean");
    const clean = E.test.filter((r) => r.gold === "clean");
    const rx = (r) => d.regexCheck(r.text) !== "clean";
    const model = (r) => r.pred !== "clean" || r.margin < t;
    const both = (r) => rx(r) || model(r);
    const row = (name, f) => {
      const caught = sens.filter(f).length;
      const wrongBlock = clean.filter(f).length;
      return h("tr", {}, h("td", { text: name }), h("td", { class: "rd-num", text: `${caught} of ${sens.length}` }), h("td", { class: "rd-num", text: `${wrongBlock} of ${clean.length}` }));
    };
    return h(
      "div",
      { class: "lp-cm" },
      h("h3", { text: "The gate as a whole: model, regex, or both" }),
      h("div", { class: "rd-table-wrap" }, h("table", { class: "rd-table" }, h("caption", { text: `Test split. Blocked means held back from the cloud assistant. Model blocks anything that is not "clean" or is below the bar ${num(t, 1)} (fail closed).` }), h("thead", {}, h("tr", {}, h("th", { text: "Check" }), h("th", { class: "rd-num", text: "Sensitive texts blocked" }), h("th", { class: "rd-num", text: "Clean texts blocked by mistake" }))), h("tbody", {}, row("Plain regex check only", rx), row("Model only", model), row("Both (blocked if either says so)", both)))),
      h("p", { class: "lp-muted lp-explain", text: "A sensitive text that is not blocked is a leak. A clean text that is blocked is only an annoyance. That is why the gate fails closed." }),
    );
  };
}

// ---- demo 6: your own ---------------------------------------------------------------------------------------------------
const CUSTOM_DEFAULT = {
  instruction: "Sort this kitchen note into one pile.",
  labels: [
    { id: "shopping", description: "things to buy at the shop" },
    { id: "recipe", description: "cooking steps or ingredients for a dish" },
    { id: "reminder", description: "something to remember to do at a certain time" },
  ],
  shots: [
    ["Buy oats, two lemons and a bag of rice", "shopping"],
    ["We are out of olive oil again", "shopping"],
    ["Fry the onions until soft, add the tomatoes and simmer for 20 minutes", "recipe"],
    ["Pancakes: 200g flour, 2 eggs, 300ml milk, pinch of salt. Whisk, rest, fry.", "recipe"],
    ["Take the bread out of the freezer tonight", "reminder"],
    ["Descale the kettle on Sunday", "reminder"],
  ],
  examples: ["Milk, eggs and some coriander", "Simmer the beans for an hour, then add the salt", "Do not forget to turn the oven off at six", "Salt is nearly gone, add it to the sauce at the end"],
};

class Custom extends Demo {
  constructor() {
    super({ key: "own", id: "custom", noun: "the model", alwaysHuman: [], hasEval: false, labels: [], names: new Map(), items: [], examples: [] });
    this.shots = [];
    this.rows = [];
  }
  labelName(id) {
    return id;
  }
  init() {
    const q = this.q;
    // adopt the rows that are already in the HTML
    [...q("labels").children].forEach((row) => this.bindLabel(row));
    [...q("shots").children].forEach((row, k) => this.bindShot(row, row.querySelector("select").dataset.want));
    q("add-label").addEventListener("click", () => {
      this.addLabel("", "");
      this.refresh();
    });
    q("add-shot").addEventListener("click", () => {
      this.addShot("", this.rows[0]?.id.value.trim() || "");
      this.refresh();
    });
    q("instruction").addEventListener("input", () => this.refresh());
    q("thr-own").addEventListener("input", () => {
      const v = Number(q("thr-own").value);
      if (Number.isFinite(v)) {
        this.threshold = v;
        this.thresholdSource = "you";
      }
    });
    const ex = clear(q("examples"));
    for (const t of CUSTOM_DEFAULT.examples) {
      const b = h("button", { type: "button", class: "rd-btn rd-btn--sm lp-ex" }, h("span", { class: "lp-ex__t", text: t }));
      b.addEventListener("click", () => {
        q("text").value = t;
        q("text").focus();
      });
      ex.append(b);
    }
    this.refresh();
    super.init();
  }
  // The default rows are in the page's HTML (no layout shift); added rows use the same markup.
  labelRow(id, description) {
    return h("div", { class: "lp-row lp-row--label" }, h("input", { class: "rd-input", type: "text", "aria-label": "Answer name", placeholder: "name, e.g. shopping", maxlength: "30", value: id }), h("input", { class: "rd-input", type: "text", "aria-label": "What it means (optional)", placeholder: "what it means (optional)", value: description }), h("button", { type: "button", class: "rd-btn rd-btn--icon", "aria-label": "Remove this answer" }, icon("trash")));
  }
  shotRow(text) {
    return h("div", { class: "lp-row lp-row--shot" }, h("input", { class: "rd-input", type: "text", "aria-label": "Example text", placeholder: "an example text", value: text }), h("select", { class: "rd-select", "aria-label": "Its answer" }), h("button", { type: "button", class: "rd-btn rd-btn--icon", "aria-label": "Remove this example" }, icon("trash")));
  }
  addLabel(id, description) {
    const row = this.labelRow(id, description);
    this.q("labels").append(row);
    this.bindLabel(row);
  }
  addShot(text, label) {
    const row = this.shotRow(text);
    this.q("shots").append(row);
    this.bindShot(row, label);
  }
  bindLabel(row) {
    const [idEl, dEl, rm] = row.children;
    const rec = { id: idEl, d: dEl, row };
    rm.addEventListener("click", () => {
      this.rows = this.rows.filter((r) => r !== rec);
      row.remove();
      this.refresh();
    });
    [idEl, dEl].forEach((e) => e.addEventListener("input", () => this.refresh()));
    this.rows.push(rec);
  }
  bindShot(row, want) {
    const [tEl, sel, rm] = row.children;
    const rec = { t: tEl, sel, row, want };
    rm.addEventListener("click", () => {
      this.shots = this.shots.filter((x) => x !== rec);
      row.remove();
      this.refresh();
    });
    tEl.addEventListener("input", () => this.refresh());
    sel.addEventListener("change", () => {
      rec.want = sel.value;
      this.refresh();
    });
    this.shots.push(rec);
  }
  // rebuild selects, limits, prompt preview and the validation message
  refresh() {
    const q = this.q;
    const ids = this.rows.map((r) => r.id.value.trim());
    for (const s of this.shots) {
      const keep = s.want;
      s.sel.replaceChildren(...ids.filter(Boolean).map((i) => h("option", { value: i, text: i, selected: i === keep })));
      if (ids.includes(keep)) s.sel.value = keep;
      else s.want = s.sel.value;
    }
    q("add-label").disabled = this.rows.length >= MAX_LABELS;
    q("add-shot").disabled = this.shots.length >= MAX_SHOTS;
    q("label-count").textContent = `${this.rows.length} of ${MAX_LABELS} answers`;
    q("shot-count").textContent = `${this.shots.length} of ${MAX_SHOTS} examples`;
    const problem = this.validate();
    const err = q("form-error");
    err.hidden = !problem;
    err.textContent = problem ?? "";
    if (!problem) {
      this.labels = this.rows.map((r) => ({ id: r.id.value.trim() }));
      this.specValue = this.buildSpecValue();
      q("prompt").textContent = this.promptPreview(this.specValue);
    }
    this.specOk = !problem;
    this.sync();
  }
  validate() {
    const ids = this.rows.map((r) => r.id.value.trim());
    if (!this.q("instruction").value.trim()) return "Write an instruction, for example: Sort this note into one pile.";
    if (ids.length < 2) return "Add at least two answers.";
    if (ids.some((i) => !i)) return "Every answer needs a name.";
    if (new Set(ids.map((i) => i.toLowerCase())).size !== ids.length) return "Answer names must all be different.";
    for (const [k, s] of this.shots.entries()) {
      if (!s.t.value.trim()) return `Example ${k + 1} has no text. Fill it in or remove it.`;
      if (!ids.includes(s.sel.value)) return `Example ${k + 1} points at an answer that does not exist.`;
    }
    return null;
  }
  buildSpecValue() {
    return {
      instruction: this.q("instruction").value.trim(),
      labels: this.rows.map((r) => ({ id: r.id.value.trim(), description: r.d.value.trim() || r.id.value.trim() })),
      fewshots: this.shots.map((s) => ({ text: s.t.value.trim(), label: s.sel.value })),
    };
  }
  promptPreview(spec) {
    const clean = (s) => String(s).replace(/\s+/g, " ").trim();
    const codes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const code = new Map(spec.labels.map((l, i) => [l.id, codes[i]]));
    let p = `${clean(spec.instruction)}\nOptions:\n`;
    spec.labels.forEach((l, i) => (p += `${codes[i]}: ${clean(l.description)}\n`));
    p += "\n";
    for (const f of spec.fewshots) p += `Text: ${clean(f.text)}\nAnswer: ${code.get(f.label)}\n\n`;
    return `${p}Text: <your text>\nAnswer:`;
  }
  spec() {
    if (!this.specOk) throw Object.assign(new Error(this.validate() ?? "invalid"), { code: "BAD_INPUT" });
    return this.specValue;
  }
  sync() {
    const ready = S.model === "ready" && !S.busy && this.specOk !== false;
    const q = this.q;
    q("go").disabled = !ready;
    q("hint").textContent = S.model !== "ready" ? "Load the model first (card at the top of the page)." : S.busy ? "The GPU is busy with another run." : this.specOk === false ? "Fix the settings above first." : "";
  }
  outcome(r) {
    return r.margin >= this.threshold
      ? { kind: "good", text: `Answer: ${r.label}.`, detail: "What your program does with it is up to you." }
      : { kind: "warn", text: "A person looks at it.", detail: `The margin ${num(r.margin)} is below ${num1(this.threshold)}.` };
  }
  snippet(t) {
    return `const r = await classify({ text, instruction, labels, fewshots });
if (r.margin < ${num1(t)}) return askAPerson(text);
return handle(r.label, text);`;
  }
}

// ---- boot ------------------------------------------------------------------------------------------------------------------
async function boot() {
  card.go().addEventListener("click", () => loadModel());
  card.file().addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) loadModel(f);
  });
  card.cancel().addEventListener("click", () => S.abort?.abort());
  card.go().disabled = true;
  card.fileBtn().disabled = true;
  card.fileBtn().addEventListener("click", () => card.file().click());
  S.gpu = await checkGpu();
  const st = card.status();
  clear(st).append(S.gpu.ok ? chip("WebGPU found", "good", "circle-check") : chip("WebGPU not usable", "bad", "circle-x"));
  card.adapter().textContent = S.gpu.adapter || "none";
  setStage(S.gpu.ok ? "Not loaded." : S.gpu.message);
  if (!S.gpu.ok) card.stage().classList.add("lp-bad");
  card.meter().hidden = true;
  const custom = new Custom();
  DEMOS[custom.key] = custom;
  try {
    await loadDemos();
  } catch (e) {
    showLoadMsg(`The demo data could not be read from this site (${e}). Reload the page.`);
    return;
  }
  for (const d of Object.values(DEMOS)) d.init();
  syncButtons();
  window.addEventListener("pagehide", () => S.abort?.abort());
}
boot();
