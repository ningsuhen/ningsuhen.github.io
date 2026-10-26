// lpm-client.js: typed decisions on the GPU, from a web page. ESM, no
// frameworks, no external requests except the model URL the caller passes.
//
//   import { init, loadModel, classify, classifyBatch, LpmError } from "./lpm-client.js";
//   const { adapter } = await init({ wasmUrl: "./pkg/lpm_web_bg.wasm" });
//   await loadModel({ url, onProgress: (done, total) => {} });
//   const r = await classify({ text, instruction, labels, fewshots });
//
// Files to ship together: lpm-client.js, lpm-loader.js, tokenizer.js,
// pkg/lpm_web.js, pkg/lpm_web_bg.wasm, tok/vocab.json, tok/merges.txt.
//
// PROMPT TEMPLATE (a base model, few-shot; the static part is prefilled once and
// its KV cache is reused for every call):
//
//   <instruction>
//   Options:
//   A: <label 0 description>
//   B: <label 1 description>
//   ...
//   (blank line)
//   Text: <few-shot text>          <- one block per fewshot, in order
//   Answer: <code of its label>
//   (blank line)
//   -- everything above is the static prefix --
//   Text: <the text to classify>   <- the dynamic part
//   Answer:
//
// The model answers with ONE token: the code letter (" A", " B", ...). The
// candidates are those code tokens, so a decision is "which of these N letters
// has the highest logit". Codes are letters, so the first tokens are distinct by
// construction; this is asserted at runtime anyway.
//
// MARGIN. The GPU reads back 16 bytes: [top1 token, top2 token, margin f32 bits,
// pad]. `margin` is the LOGIT gap between the best and second-best candidate
// (0 = tie, larger = surer). Only the top two candidates leave the GPU, so
// `scores` carries a two-way softmax over those two (p1 = sigmoid(margin)),
// not a softmax over all labels; the other labels are omitted. `marginP` =
// p1 - p2 = tanh(margin / 2) is that two-way probability gap in [0, 1].
import initWasm, {
  device_lost,
  device_name,
  decide_prefill,
  decide_text,
  lpm1_begin,
  lpm1_chunk,
  lpm1_finish,
} from "./pkg/lpm_web.js";
import { streamLpm1 } from "./lpm-loader.js";
import { Qwen3Tokenizer } from "./tokenizer.js";

/** Model context length (Qwen3-0.6B config max_len). */
const MAX_LEN = 512;
const READBACK_BYTES = 16;
const LPM1_HEADER = 64;
const LPM1_FOOTER = 36;

/** Loud, typed error. `code` is one of the constants below. */
export class LpmError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LpmError";
    this.code = code;
  }
}
export const ERR = {
  NO_WEBGPU: "NO_WEBGPU",
  SOFTWARE_ADAPTER: "SOFTWARE_ADAPTER",
  MODEL_MISSING: "MODEL_MISSING",
  MODEL_CORRUPT: "MODEL_CORRUPT",
  MODEL_NOT_LOADED: "MODEL_NOT_LOADED",
  DEVICE_LOST: "DEVICE_LOST",
  BAD_INPUT: "BAD_INPUT",
  PROMPT_TOO_LONG: "PROMPT_TOO_LONG",
};

let tokenizer = null;
let adapterName = null;
let modelLoaded = false;
let prefixKey = null; // which static prefix is currently resident in the KV cache

function gpuError(e) {
  const msg = String(e && e.message ? e.message : e);
  if (/software adapter/i.test(msg)) return new LpmError(ERR.SOFTWARE_ADAPTER, msg);
  if (/no GPU adapter|webgpu/i.test(msg)) return new LpmError(ERR.NO_WEBGPU, msg);
  return e instanceof Error ? e : new Error(msg);
}

function checkDevice() {
  if (!modelLoaded) throw new LpmError(ERR.MODEL_NOT_LOADED, "call loadModel() first");
  if (device_lost()) {
    modelLoaded = false;
    prefixKey = null;
    throw new LpmError(ERR.DEVICE_LOST, "the GPU device was lost; call loadModel() again (served from the OPFS cache)");
  }
}

/**
 * Load the wasm module and the tokenizer, and prove a real GPU is present.
 * @param {{wasmUrl?: string|URL, tokenizerBase?: string}} opts
 * @returns {Promise<{adapter: string}>}
 */
export async function init({ wasmUrl, tokenizerBase = new URL("./tok/", import.meta.url).href } = {}) {
  if (!navigator.gpu) throw new LpmError(ERR.NO_WEBGPU, "this browser has no WebGPU (navigator.gpu is missing)");
  await initWasm(wasmUrl ? { module_or_path: wasmUrl } : undefined);
  try {
    await device_name(); // fails closed on a software adapter (D13)
  } catch (e) {
    throw gpuError(e);
  }
  // Chrome often reports an empty adapter `name`; describe the adapter from its info.
  const info = (await navigator.gpu.requestAdapter())?.info;
  adapterName =
    [info?.vendor, info?.architecture, info?.description || info?.device].filter(Boolean).join(" ") ||
    "unknown GPU adapter";
  tokenizer = await Qwen3Tokenizer.load(tokenizerBase);
  return { adapter: adapterName };
}

// ---- model loading --------------------------------------------------------

async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// OPFS cache keyed by URL. A cache file is trusted only if its size matches
// what its own header promises; its BLAKE3 is re-verified on every load anyway.
async function opfsEntry(url) {
  const dir = await navigator.storage.getDirectory();
  return { dir, name: `lpm-client-${(await sha256Hex(url)).slice(0, 24)}.lpm1` };
}

async function openCached(url) {
  try {
    const { dir, name } = await opfsEntry(url);
    const file = await (await dir.getFileHandle(name)).getFile();
    const head = new Uint8Array(await file.slice(0, LPM1_HEADER).arrayBuffer());
    if (head.length < LPM1_HEADER) return null;
    const dataBytes = Number(new DataView(head.buffer).getBigUint64(20, true));
    if (file.size !== LPM1_HEADER + dataBytes + LPM1_FOOTER) return null;
    return file;
  } catch {
    return null;
  }
}

async function dropCached(url) {
  try {
    const { dir, name } = await opfsEntry(url);
    await dir.removeEntry(name);
  } catch {
    // nothing cached
  }
}

/**
 * Stream an LPM1 file into the GPU. Give `file` (a File/Blob from a picker) or
 * `url` (network, cached in OPFS after the first load).
 * @returns {Promise<{source: 'network'|'opfs'|'file', bytes: number, ms: number, cached: boolean, cacheError?: string}>}
 */
export async function loadModel({ url, file, onProgress } = {}) {
  if (!tokenizer) throw new LpmError(ERR.MODEL_NOT_LOADED, "call init() before loadModel()");
  if (!url && !file) throw new LpmError(ERR.BAD_INPUT, "loadModel needs { url } or { file }");
  const t0 = performance.now();
  const api = { lpm1_begin, lpm1_chunk, lpm1_finish };
  modelLoaded = false;
  prefixKey = null;
  let source;
  let bytes;
  let tee;
  let closeTee = async () => {};
  let cached = false;
  let cacheError;
  let stream;

  if (file) {
    source = "file";
    bytes = file.size;
    stream = file.stream();
  } else {
    const hit = await openCached(url);
    if (hit) {
      source = "opfs";
      bytes = hit.size;
      stream = hit.stream();
      cached = true;
    } else {
      source = "network";
      let resp;
      try {
        resp = await fetch(url, { cache: "no-store" });
      } catch (e) {
        throw new LpmError(ERR.MODEL_MISSING, `model fetch failed (network or CORS): ${e}`);
      }
      if (!resp.ok || !resp.body) throw new LpmError(ERR.MODEL_MISSING, `model fetch ${resp.status} ${resp.statusText} for ${url}`);
      bytes = Number(resp.headers.get("content-length")) || 0;
      stream = resp.body;
      try {
        const { dir, name } = await opfsEntry(url);
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        tee = (chunk) => w.write(chunk);
        closeTee = () => w.close();
      } catch (e) {
        cacheError = `OPFS cache unavailable: ${e}`;
      }
    }
  }

  try {
    await streamLpm1(stream.getReader(), api, {
      tee,
      onProgress: (done, total) => onProgress && onProgress(done, total),
    });
    await closeTee();
    cached = cached || !!tee;
  } catch (e) {
    try {
      await closeTee();
    } catch {
      // already failing
    }
    if (url && source === "network") await dropCached(url);
    const msg = String(e && e.message ? e.message : e);
    if (/BLAKE3|ended early|shorter than|LPM1/i.test(msg)) {
      if (url && source === "opfs") await dropCached(url);
      throw new LpmError(ERR.MODEL_CORRUPT, msg);
    }
    throw gpuError(e);
  }
  modelLoaded = true;
  const out = { source, bytes, ms: performance.now() - t0, cached };
  if (cacheError) out.cacheError = cacheError;
  return out;
}

// ---- prompt building ------------------------------------------------------

const CODES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function clean(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function buildSpec({ instruction, labels, fewshots = [] }) {
  if (!instruction || !Array.isArray(labels) || labels.length < 2)
    throw new LpmError(ERR.BAD_INPUT, "classify needs an instruction and at least 2 labels");
  if (labels.length > CODES.length) throw new LpmError(ERR.BAD_INPUT, `at most ${CODES.length} labels`);
  const ids = new Set(labels.map((l) => l.id));
  if (ids.size !== labels.length) throw new LpmError(ERR.BAD_INPUT, "label ids must be unique");
  const codeOf = new Map(labels.map((l, i) => [l.id, CODES[i]]));
  const candidates = labels.map((_, i) => {
    const t = tokenizer.encode(" " + CODES[i]);
    if (t.length !== 1) throw new LpmError(ERR.BAD_INPUT, `answer code ${CODES[i]} is not a single token`);
    return t[0];
  });
  if (new Set(candidates).size !== candidates.length)
    throw new LpmError(ERR.BAD_INPUT, "label answer tokens are not distinct");
  let prefix = `${clean(instruction)}\nOptions:\n`;
  labels.forEach((l, i) => (prefix += `${CODES[i]}: ${clean(l.description || l.id)}\n`));
  prefix += "\n";
  for (const f of fewshots) {
    if (!codeOf.has(f.label)) throw new LpmError(ERR.BAD_INPUT, `fewshot label ${JSON.stringify(f.label)} is not in labels`);
    prefix += `Text: ${clean(f.text)}\nAnswer: ${codeOf.get(f.label)}\n\n`;
  }
  return { prefix, candidates, ids: labels.map((l) => l.id), key: prefix };
}

async function ensurePrefix(spec) {
  if (prefixKey === spec.key) return spec.prefixIds.length;
  const n = await decide_prefill(spec.prefixIds);
  prefixKey = spec.key;
  return n;
}

async function runOne(spec, text) {
  const t0 = performance.now();
  const dyn = tokenizer.encode(`Text: ${clean(text)}\nAnswer:`);
  if (spec.prefixIds.length + dyn.length > MAX_LEN)
    throw new LpmError(ERR.PROMPT_TOO_LONG, `prompt is ${spec.prefixIds.length + dyn.length} tokens, limit ${MAX_LEN}`);
  let r;
  try {
    r = await decide_text(dyn, spec.candidates);
  } catch (e) {
    checkDevice();
    throw gpuError(e);
  }
  const [t1, t2, margin] = r;
  const i1 = spec.candidates.indexOf(t1);
  const i2 = spec.candidates.indexOf(t2);
  if (i1 < 0) throw new Error(`GPU returned token ${t1}, not one of the candidates`);
  const p1 = 1 / (1 + Math.exp(-margin));
  const scores = [{ label: spec.ids[i1], p: p1 }];
  if (i2 >= 0 && i2 !== i1) scores.push({ label: spec.ids[i2], p: 1 - p1 });
  return {
    label: spec.ids[i1],
    margin,
    marginP: Math.tanh(margin / 2),
    scores,
    ms: performance.now() - t0,
    promptTokens: spec.prefixIds.length + dyn.length,
    bytesReadBack: READBACK_BYTES,
  };
}

function prepare(opts) {
  const spec = buildSpec(opts); // validate input first, then the device
  checkDevice();
  spec.prefixIds = tokenizer.encode(spec.prefix);
  if (spec.prefixIds.length >= MAX_LEN) throw new LpmError(ERR.PROMPT_TOO_LONG, `static prompt is ${spec.prefixIds.length} tokens, limit ${MAX_LEN}`);
  return spec;
}

/**
 * Decide one text.
 * @param {{text: string, instruction: string, labels: {id: string, description?: string}[], fewshots?: {text: string, label: string}[]}} o
 * @returns {Promise<{label: string, margin: number, marginP: number, scores: {label: string, p: number}[], ms: number, promptTokens: number, bytesReadBack: number}>}
 */
export async function classify(o) {
  const spec = prepare(o);
  try {
    await ensurePrefix(spec);
  } catch (e) {
    checkDevice();
    throw gpuError(e);
  }
  return runOne(spec, o.text);
}

/**
 * Decide many texts with the same options (`items` are strings or {text}).
 * @returns {Promise<{results: object[], totalMs: number}>} results as in classify(), in order.
 */
export async function classifyBatch(items, o) {
  const spec = prepare({ ...o, text: "" });
  const t0 = performance.now();
  try {
    await ensurePrefix(spec);
  } catch (e) {
    checkDevice();
    throw gpuError(e);
  }
  const results = [];
  for (const it of items) results.push(await runOne(spec, typeof it === "string" ? it : it.text));
  return { results, totalMs: performance.now() - t0 };
}
