/* Speed test tab. Loaded by page.js; the markup is in body.html. Nothing is fetched until the visitor presses Start: the device probe and the cache check are local, and
   the runtime library is imported only inside a run. The model is read from Cache Storage when it is there (no consent
   needed: nothing is downloaded); otherwise the consent box must be ticked first. */
const LAYA_BASE_URL = 'https://huggingface.co/ningsuhen/laya-typed-decisions-onnx/resolve/main/fp16/';
const LAYA_HOST_READY = true;            // public, CORS and range requests verified; fetched at run time, never committed to this site
const LAYA_FILE = 'laya.fp16-nonan.onnx';
const ORT_BASE = '/tts/vendor/ort/';    // the site's shared ONNX Runtime Web JavaScript (1.27.0); the wasm comes from /tts/ort-runtime.js
const ortRuntime = () => import('/tts/ort-runtime.js');
let ORT_BYTES = 0;                      // set in init() from the loader's pin
const N_DECISIONS = 50, N_RUNS = 3, WARMUP = 3;
const CACHE_LAYA = 'brev-traversal-laya-fp16-v1';

const D = JSON.parse(document.getElementById('gs-data').textContent);
const $ = (id) => document.getElementById(id);
const fmtB = (n) => n.toLocaleString('en-US') + ' B';
const fmtMB = (n) => (n / 1e6).toFixed(0) + ' MB';
const f1 = (x) => (x == null || !isFinite(x) ? 'n/a' : x.toFixed(1));
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return NaN; const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const median = (xs) => pct(xs, 0.5);

const layaUrl = LAYA_BASE_URL + LAYA_FILE;
const layaReady = LAYA_HOST_READY;
const layaHostLabel = 'huggingface.co, which redirects the file to its CDN (us.aws.cdn.hf.co or another *.hf.co host)';

const S = { dev: null, laya: null, running: false, stop: false, abort: null, contacts: new Set(), cached: false, ortCached: false };

function setStatus(t, err) { const e = $('status'); e.textContent = t; e.classList.toggle('gs-err', !!err); }
function setBar(frac) { $('bar').style.setProperty('--w', frac == null ? 0 : Math.max(0, Math.min(100, frac * 100)).toFixed(1)); }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function callout(kind, title, text) { const d = el('div', 'rd-callout rd-callout--' + kind); const p = el('p', 'rd-callout__title'); p.innerHTML = '<svg class="rd-icon" aria-hidden="true"><use href="#i-triangle-alert"/></svg>'; p.appendChild(document.createTextNode(title)); d.appendChild(p); d.appendChild(document.createTextNode(text)); return d; }

/* ============ device probe and WebGPU feature check (local only) ============ */
async function probe() {
  const o = { mobile: false, gpu: !!navigator.gpu, adapter: null, info: {}, limits: {}, f16: false, software: false,
    mem: navigator.deviceMemory ?? null, cores: navigator.hardwareConcurrency ?? null, platform: navigator.userAgentData?.platform || navigator.platform || '' };
  o.mobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches);
  if (navigator.gpu) {
    try {
      const a = await navigator.gpu.requestAdapter();
      if (a) {
        o.adapter = a; const i = a.info || (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
        o.info = { vendor: i.vendor || '', architecture: i.architecture || '', device: i.device || '', description: i.description || '' };
        o.limits = { maxBufferSize: a.limits.maxBufferSize, maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize };
        o.f16 = a.features.has('shader-f16');
        o.software = !!a.isFallbackAdapter || /swiftshader|llvmpipe|software|lavapipe/i.test(Object.values(o.info).join(' '));
      }
    } catch (e) { o.err = String(e && e.message || e); }
  }
  o.ok = !!o.adapter && o.f16;  // the fp16 graph needs shader-f16 on the WebGPU provider
  return o;
}
function browserName() {
  const u = navigator.userAgent; const m = u.match(/(Edg|OPR|Chrome|Firefox|Version)\/([\d.]+)/);
  if (!m) return u.slice(0, 60);
  const n = { Edg: 'Edge', OPR: 'Opera', Chrome: 'Chrome', Firefox: 'Firefox', Version: 'Safari' }[m[1]];
  return n + ' ' + m[2].split('.')[0] + ' on ' + (S.dev?.platform || 'unknown OS');
}
function adapterName(p) { return p && p.adapter ? [p.info.vendor, p.info.architecture, p.info.device, p.info.description].filter(Boolean).join(' / ') || 'not exposed by the browser' : 'none'; }
function renderProbe(p) {
  const rows = [
    ['Browser', browserName()],
    ['WebGPU', p.gpu ? (p.adapter ? 'available' : 'present, but no adapter was returned') : 'not available'],
    ['Adapter', adapterName(p)],
    ['shader-f16', p.adapter ? (p.f16 ? 'yes' : 'no (the fp16 model needs it)') : 'n/a'],
    ['maxBufferSize', p.limits.maxBufferSize != null ? fmtB(p.limits.maxBufferSize) : 'n/a'],
    ['Device memory', p.mem != null ? p.mem + ' GB reported (browsers round and cap this value)' : 'not reported by this browser'],
    ['CPU threads', p.cores != null ? String(p.cores) : 'not reported'],
    ['Form factor', p.mobile ? 'mobile or touch-first' : 'desktop'],
  ];
  const dl = $('probe'); dl.textContent = '';
  rows.forEach(([k, v]) => { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); });
  const w = $('probe-warn'); w.textContent = '';
  if (p.software) w.appendChild(callout('warn', 'Software adapter', 'This adapter is a software renderer, not a GPU. Numbers will be far below real hardware and meaningless as a GPU comparison.'));
}

/* ============ gates: no silent CPU run ============ */
function applyGates(p) {
  const why = !p.gpu ? 'WebGPU is not available in this browser.' : !p.adapter ? 'WebGPU is present but returned no GPU adapter.' : !p.f16 ? 'Your GPU adapter does not offer shader-f16, which the fp16 model needs on WebGPU.' : '';
  if (why || p.mobile) {
    $('gate').hidden = false;
    $('gate-text').textContent = (p.mobile ? 'This looks like a phone or tablet; the test downloads 846 MB. ' : '') + why +
      (why ? ' The GPU test is off. The page will not fall back to the CPU by itself; the slow CPU (wasm) run is an explicit opt-in below.' : '');
  }
  const lb = $('p-laya');
  if (!layaReady) { lb.checked = false; lb.disabled = true; $('p-laya-note').textContent = 'Model host not configured, so this run is disabled.'; }
  else {
    lb.disabled = !p.ok; lb.checked = !!p.ok;
    $('p-laya-note').textContent = p.ok ? '50 decisions at batch 1, three runs, after a three-pass warm-up.' : 'Unavailable here: ' + why;
    $('p-cpu-row').hidden = !!p.ok;
  }
  syncStart();
}
function wants() { return layaReady && (S.dev && S.dev.ok ? $('p-laya').checked : $('p-laya-cpu').checked); }
/* Consent is needed only when the model would be downloaded; a cached copy is read locally. */
function syncStart() {
  $('p-ok-row').hidden = S.cached;
  $('b-start').disabled = S.running || !S.dev || !wants() || !(S.cached || $('p-ok').checked);
  $('b-remove').disabled = S.running || !S.cached;
}

/* ============ Cache Storage (this page's cache only) ============ */
async function cachedResponse() {
  if (typeof caches === 'undefined') return null;
  try { if (!(await caches.has(CACHE_LAYA))) return null; return (await (await caches.open(CACHE_LAYA)).match(layaUrl)) || null; } catch (e) { return null; }
}
async function showCache() {
  const r = await cachedResponse();
  try { S.ortCached = await (await ortRuntime()).ortRuntimeCached(); } catch (e) { S.ortCached = false; }
  S.cached = S.ortCached && !!r && Number(r.headers.get('content-length') || D.layaBytes) === D.layaBytes;
  const chip = $('dl-chip');
  chip.className = 'rd-chip ' + (S.cached ? 'rd-chip--good' : 'rd-chip--neutral');
  $('dl-state').textContent = typeof caches === 'undefined' ? 'Cache Storage is unavailable here: every run downloads the model again.' :
    S.cached ? 'Downloaded: the model (' + fmtMB(D.layaBytes) + ') and the runtime are in this browser\'s cache. Start reads them from there; nothing is downloaded.' :
      'Not downloaded yet: Start downloads ' + fmtMB(D.layaBytes + (S.ortCached ? 0 : ORT_BYTES)) + ' once, after you agree below.';
  syncStart();
}
async function removeDownload() {
  try {
    const before = navigator.storage?.estimate ? (await navigator.storage.estimate()).usage : null;
    await caches.delete(CACHE_LAYA);
    await (await ortRuntime()).removeOrtRuntime();
    const after = navigator.storage?.estimate ? (await navigator.storage.estimate()).usage : null;
    setStatus('Download removed.' + (before != null && after != null ? ' Freed about ' + fmtMB(Math.max(0, before - after)) + ' (browser storage estimate).' : ''));
  } catch (e) { setStatus('Could not remove the download: ' + e.message, true); }
  showCache();
}

/* ============ model bytes: cache first, else one consented download ============ */
function noteHost(u) { try { S.contacts.add(new URL(u, location.href).host); } catch (e) {} showContacts(); }
function showContacts() { $('contacts').textContent = S.contacts.size ? 'Hosts contacted for the downloads: ' + [...S.contacts].join(', ') : 'No download host has been contacted.'; }
async function fetchLaya(signal) {
  const total = D.layaBytes;
  const hit = await cachedResponse();
  if (hit) {
    setStatus('laya: reading the downloaded copy from this browser\'s cache...');
    const b = new Uint8Array(await hit.arrayBuffer());
    if (b.length === total) return { buf: b, fromCache: true };
    await caches.delete(CACHE_LAYA);
  }
  noteHost(layaUrl);
  const r = await fetch(layaUrl, { signal, mode: 'cors', credentials: 'omit', cache: 'no-store' });
  if (r.url) noteHost(r.url);  // the CDN host the redirect landed on
  if (!r.ok) throw new Error('laya download failed: HTTP ' + r.status + ' from ' + new URL(layaUrl).host);
  const buf = new Uint8Array(total); let off = 0; const rd = r.body.getReader(); const t0 = performance.now();
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    if (off + value.length > total) throw new Error('laya file is larger than the expected ' + fmtB(total) + '; refusing it.');
    buf.set(value, off); off += value.length;
    setBar(off / total); setStatus('laya: downloading ' + (off / 1e6).toFixed(0) + ' of ' + (total / 1e6).toFixed(0) + ' MB'); $('status2').textContent = ((off / 1e6) / ((performance.now() - t0) / 1000)).toFixed(1) + ' MB/s';
  }
  if (off !== total) throw new Error('laya file is ' + fmtB(off) + ', expected ' + fmtB(total) + '; refusing it.');
  const dlMs = performance.now() - t0;
  let persisted = null;
  try {
    await (await caches.open(CACHE_LAYA)).put(layaUrl, new Response(buf, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(total) } }));
    if (navigator.storage?.persist) persisted = await navigator.storage.persist();  // ask the browser not to evict it
  } catch (e) { /* quota or private window: run uncached */ }
  return { buf, fromCache: false, dlMs, persisted };
}

function explain(e) {
  const m = String((e && e.message) || e);
  if (e && e.name === 'AbortError' || /abort/i.test(m)) return 'Cancelled.';
  if (/out of memory|oom|alloc|bad_alloc|memory|RangeError|buffer.*too large|maxBufferSize/i.test(m)) return 'The tab or GPU ran out of memory (' + m.slice(0, 160) + '). Close other tabs and applications and try again.';
  if (/device.*lost|context.*lost/i.test(m)) return 'The GPU device was lost (' + m.slice(0, 160) + '). This is usually memory pressure or a driver reset. Reload the page and try again.';
  return m.slice(0, 300);
}

/* ============ laya run ============ */
/* The shared loader returns the verified wasm bytes (Cache Storage, else the pinned host) and hooks window.ort so ONNX
   Runtime gets them as env.wasm.wasmBinary with numThreads 1. The JavaScript is the site's shared copy, loaded once. */
async function loadOrt(signal) {
  const rt = await ortRuntime();
  if (!S.ortCached) noteHost(rt.ORT_WASM_URL);
  const wasmBinary = await rt.ensureOrtRuntime({ signal, onProgress: (f) => { setBar(f); setStatus('Runtime: ' + (S.ortCached ? 'reading the cached copy' : 'downloading ' + (f * ORT_BYTES / 1e6).toFixed(0) + ' of ' + (ORT_BYTES / 1e6).toFixed(0) + ' MB') + '...'); } });
  if (!window.ort?.InferenceSession) {
    await new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = ORT_BASE + 'ort.webgpu.min.js';
      sc.onload = resolve; sc.onerror = () => reject(new Error('could not load the ONNX Runtime script from this site'));
      document.head.appendChild(sc);
    });
  }
  const ort = window.ort;
  ort.env.wasm.wasmPaths = ORT_BASE; ort.env.wasm.wasmBinary = wasmBinary; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.logLevel = 'error';
  return ort;
}
function softmaxT(logits, k, t) { let mx = -Infinity; for (let i = 0; i < k; i++) mx = Math.max(mx, logits[i] / t); const e = new Array(k); let s = 0; for (let i = 0; i < k; i++) { e[i] = Math.exp(logits[i] / t - mx); s += e[i]; } return e.map((v) => v / s); }
function argmax(a) { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; }

async function runLaya(cpu) {
  const items = D.items, tStart = performance.now();
  setBar(0); setStatus('Runtime: loading ONNX Runtime Web...');
  S.abort = new AbortController();
  const ort = await loadOrt(S.abort.signal);
  ort.env.wasm.proxy = !!cpu;  // CPU path runs in a worker so the tab stays responsive; the WebGPU path must stay on the main thread
  const got = await fetchLaya(S.abort.signal);
  setBar(null); setStatus('laya: creating the session' + (cpu ? ' (CPU wasm)' : ' on the GPU (first run compiles shaders)') + '...');
  /* logSeverityLevel 3: ORT's generic warning that small shape nodes run on the CPU is not printed as a console error.
     Correctness is checked directly instead: every output is compared with native fp32. */
  const t0 = performance.now();
  const sess = await ort.InferenceSession.create(got.buf, { executionProviders: [cpu ? 'wasm' : 'webgpu'], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
  const loadMs = performance.now() - t0, readyMs = performance.now() - tStart;
  let lostMsg = null; try { ort.env.webgpu.device?.lost.then((i) => { lostMsg = i.message || i.reason; }); } catch (e) {}
  const mkFeeds = (it) => ({
    input_ids: new ort.Tensor('int64', BigInt64Array.from(it.ids, BigInt), [1, it.ids.length]),
    attention_mask: new ort.Tensor('int64', BigInt64Array.from(it.mask, BigInt), [1, it.mask.length]),
    marker_pos: new ort.Tensor('int64', BigInt64Array.from(it.pos, BigInt), [1, it.pos.length]),
    marker_mask: new ort.Tensor('bool', Uint8Array.from(it.pmask, (b) => (b ? 1 : 0)), [1, it.pmask.length]),
    qtype: new ort.Tensor('int64', BigInt64Array.from([BigInt(it.qt)]), [1]),
  });
  const one = async (i) => {
    const f = mkFeeds(items[i]);  // built fresh: the worker (CPU) path transfers and detaches input buffers
    const t = performance.now(); const out = await sess.run(f, ['logits', 'act_logits']); const lg = out.logits.data; const ms = performance.now() - t;
    const it = items[i]; const p = softmaxT(lg, it.k, it.t);
    let md = 0; for (let j = 0; j < it.k; j++) md = Math.max(md, Math.abs(p[j] - it.p[j]));
    return { ms, same: argmax(p) === argmax(it.p), md };
  };
  const res = { cpu, loadMs, readyMs, dlMs: got.dlMs, fromCache: got.fromCache, persisted: got.persisted, first: null, runs: [] };
  S.laya = res; renderLaya(); showCache();
  setStatus('laya: warm-up...'); setBar(0);
  for (let w = 0; w < WARMUP; w++) { const r = await one(w % items.length); if (w === 0) res.first = r.ms; if (lostMsg) throw new Error('device lost: ' + lostMsg); }
  renderLaya();
  for (let run = 0; run < N_RUNS; run++) {
    const lat = [], same = [], md = [];
    const walkSum = new Map();
    for (let n = 0; n < N_DECISIONS; n++) {
      if (S.stop) { setStatus('laya: stopped.'); renderLaya(); return res; }
      const i = n % items.length; const r = await one(i);
      lat.push(r.ms); same.push(r.same); md.push(r.md);
      if (n < items.length) walkSum.set(items[i].m, (walkSum.get(items[i].m) || 0) + r.ms);
      if (lostMsg) throw new Error('device lost: ' + lostMsg);
      setBar((run * N_DECISIONS + n + 1) / (N_RUNS * N_DECISIONS)); setStatus('laya: run ' + (run + 1) + ' of ' + N_RUNS + ', decision ' + (n + 1) + ' of ' + N_DECISIONS);
    }
    const sumMs = lat.reduce((a, b) => a + b, 0);
    const walks = [...walkSum.values()];
    res.runs.push({ dps: N_DECISIONS / (sumMs / 1000), p50: pct(lat, 0.5), p95: pct(lat, 0.95), walkP50: pct(walks, 0.5), walks: walks.length,
      same: same.filter(Boolean).length / same.length, md: Math.max(...md) });
    renderLaya();
  }
  setStatus('laya: done.'); setBar(1);
  try { await sess.release(); } catch (e) {}
  return res;
}

function renderLaya() {
  const r = S.laya; if (!r) return;
  const tb = $('laya-tbl'); tb.hidden = !r.runs.length; const body = tb.querySelector('tbody'); body.textContent = '';
  r.runs.forEach((x, i) => { const tr = el('tr'); [['Run ' + (i + 1)], [f1(x.dps), 1], [f1(x.p50), 1], [f1(x.p95), 1], [f1(x.walkP50) + ' (' + x.walks + ' walks)', 1], [(x.same * 100).toFixed(1) + '%', 1], [x.md.toFixed(3), 1]].forEach(([t, n]) => tr.appendChild(el('td', n ? 'rd-num' : null, t))); body.appendChild(tr); });
  const m = (k) => median(r.runs.map((x) => x[k]));
  const parts = [];
  parts.push(r.cpu ? 'CPU (wasm), single thread: the slow opt-in, not comparable to GPU numbers.' : 'WebGPU.');
  parts.push((r.fromCache ? 'Model read from this browser\'s cache (no download)' : 'Downloaded in ' + (r.dlMs / 1000).toFixed(1) + ' s (' + (D.layaBytes / 1e6 / (r.dlMs / 1000)).toFixed(1) + ' MB/s)' + (r.persisted === true ? ', kept as persistent storage' : r.persisted === false ? ', cached (the browser did not grant persistent storage)' : '')) + '; session creation ' + (r.loadMs / 1000).toFixed(1) + ' s; ready ' + (r.readyMs / 1000).toFixed(1) + ' s after Start.');
  if (r.first != null) parts.push('First pass (includes shader compile) ' + f1(r.first) + ' ms.');
  if (r.runs.length) parts.push('Median of runs: ' + f1(m('dps')) + ' decisions/s, p50 ' + f1(m('p50')) + ' ms, walk p50 ' + f1(m('walkP50')) + ' ms.');
  if (r.runs.length && m('same') < 0.95) parts.push('Warning: only ' + (m('same') * 100).toFixed(1) + '% of the top options match native ONNX Runtime for the fp32 model (largest probability difference ' + Math.max(...r.runs.map((x) => x.md)).toFixed(2) + '). On this browser, driver and execution provider the fp16 graph computes different answers than it did in our test (47 of 47 on Chrome/Metal, ORT-web 1.31-dev), so read the speed as a speed only.');
  $('laya-sum').textContent = parts.join(' ');
  updateCard();
}

/* ============ results card and the comparison strip ============ */
function cmpRow(measure, you, bench, note) { const tr = el('tr'); tr.appendChild(el('td', null, measure)); tr.appendChild(el('td', 'rd-num', you)); tr.appendChild(el('td', 'rd-num', bench)); tr.appendChild(el('td', null, note)); return tr; }
function updateCard() {
  const B = D.bench, L = S.laya, lines = [], cmp = $('cmp'); cmp.textContent = '';
  const dev = S.dev, depth = (D.items.length / D.walks).toFixed(2);
  const lr = L && L.runs.length ? L.runs : null;
  if (lr) {
    const dps = median(lr.map((x) => x.dps)), p50 = median(lr.map((x) => x.p50)), p95 = median(lr.map((x) => x.p95)), wp = median(lr.map((x) => x.walkP50)), same = median(lr.map((x) => x.same));
    lines.push('Brev tree traversal, speed test (ningsuhen.github.io/playground/brev-tree-traversal/?tab=speed), 2026-10-25 build');
    lines.push('Browser: ' + browserName() + '; WebGPU adapter: ' + adapterName(dev) + (dev && dev.software ? ' (SOFTWARE RENDERER)' : ''));
    lines.push('Memory reported: ' + (dev && dev.mem != null ? dev.mem + ' GB' : 'n/a') + '; threads: ' + (dev && dev.cores != null ? dev.cores : 'n/a') + '; shader-f16: ' + (dev && dev.f16 ? 'yes' : 'no'));
    lines.push('laya fp16 (' + (L.cpu ? 'CPU wasm' : 'WebGPU') + '), batch 1, 50 decisions x ' + lr.length + ' runs: ' + f1(dps) + ' decisions/s, per-pass p50 ' + f1(p50) + ' ms, p95 ' + f1(p95) + ' ms, walk p50 ' + f1(wp) + ' ms (mean depth ' + depth + ')');
    lines.push('  first pass ' + f1(L.first) + ' ms; model ' + (L.fromCache ? 'from cache' : 'downloaded in ' + (L.dlMs / 1000).toFixed(1) + ' s') + '; session creation ' + (L.loadMs / 1000).toFixed(1) + ' s; same top option as native fp32 ' + (same * 100).toFixed(1) + '%');
    if (same < 0.95) lines.push('  WARNING: top option differs from native fp32 on ' + ((1 - same) * 100).toFixed(0) + '% of passes; kernels on this provider disagree with the reference');
    lines.push('  benchmark RTX 4060 (PyTorch fp16, different runtime): walk p50 ' + B.walk_p50 + ' ms, p95 ' + B.walk_p95 + ' ms, mean depth ' + B.depth + '; root question ' + B.root_ms + ' ms');
    lines.push('Caveats: laya fp16 matched native fp32 on 47/47 recorded passes in Chrome/Metal with ORT-web 1.31-dev (this page runs 1.27.0); native subset of 134 messages: 0 of 3,082 node flips, final intent 134/134; full 616-message parity not run. Thermal throttling and shader compilation affect results.');
    cmp.appendChild(cmpRow('laya, per forward pass, p50', f1(p50) + ' ms', B.root_ms + ' ms (root question)', 'Different runtime: fp16 ONNX in ONNX Runtime Web against fp16 PyTorch. One forward pass here; the benchmark figure is the measured root-question latency, also one pass.'));
    cmp.appendChild(cmpRow('laya, per walk, p50', f1(wp) + ' ms', B.walk_p50 + ' ms (p95 ' + B.walk_p95 + ')', 'Yours replays the recorded path (' + depth + ' passes on average); the benchmark walked live (' + B.depth + ' on average), n=' + B.n + '.'));
    cmp.appendChild(cmpRow('laya, throughput', f1(dps) + ' decisions/s', 'not recorded', 'The benchmark recorded latency, not decisions per second.'));
    $('s-you-walk').textContent = f1(wp) + ' ms';
    $('card-text').textContent = lines.join('\n'); $('b-copy').disabled = false;
  } else {
    cmp.appendChild(cmpRow('laya, per forward pass, p50', 'not run', B.root_ms + ' ms (root question)', 'PyTorch fp16 on the RTX 4060, one pass.'));
    cmp.appendChild(cmpRow('laya, per walk, p50', 'not run', B.walk_p50 + ' ms (p95 ' + B.walk_p95 + ')', 'PyTorch fp16 greedy walk, RTX 4060, n=' + B.n + ', mean depth ' + B.depth + '.'));
    $('card-text').textContent = 'Run the test to fill this in.'; $('b-copy').disabled = true;
  }
  cmp.appendChild(cmpRow('FrogNano-4B, prefill and decode', 'not offered', 'not measured', 'No FrogNano run and no tokens-per-second figure exist for the RTX 4060 benchmark; this page does not run FrogNano.'));
}
async function copyCard() {
  const t = $('card-text').textContent;
  try { await navigator.clipboard.writeText(t); setStatus('Results copied to the clipboard.'); }
  catch (e) { const r = document.createRange(); r.selectNodeContents($('card-text')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('copy'); setStatus('Results copied to the clipboard.'); } catch (e2) { setStatus('Select the text above and copy it manually.', true); } }
}

/* ============ orchestration ============ */
/* A tab is a real link, so leaving the Speed test tab reloads the page: ask first while a run is going. */
function guard(e) { e.preventDefault(); e.returnValue = ''; }
async function start() {
  const cpu = !(S.dev && S.dev.ok);
  S.running = true; S.stop = false; S.laya = null; S.contacts = new Set(); showContacts();
  addEventListener('beforeunload', guard);
  $('b-stop').disabled = false; $('b-stop-l').textContent = 'Stop / Cancel';
  ['p-laya', 'p-laya-cpu', 'p-ok'].forEach((id) => { $(id).disabled = true; });
  syncStart();
  $('laya-tbl').hidden = true; $('laya-sum').textContent = 'Running...';
  try { await runLaya(cpu); } catch (e) { const m = explain(e); setStatus('laya: ' + m, true); S.laya = null; $('laya-sum').textContent = 'Failed: ' + m; }
  finally {
    S.running = false; S.abort = null; $('b-stop').disabled = true; $('b-stop-l').textContent = 'Stop';
    removeEventListener('beforeunload', guard);
    $('p-ok').disabled = false; $('p-laya-cpu').disabled = false; applyGates(S.dev); showCache(); updateCard();
  }
}
function stop() { S.stop = true; try { S.abort && S.abort.abort(); } catch (e) {} setStatus('Stopping...'); }

async function init() {
  $('s-bench-walk').textContent = Math.round(D.bench.walk_p50) + ' ms';
  document.querySelectorAll('.b-walk').forEach((n) => { n.textContent = D.bench.walk_p50; });
  $('m-pool').textContent = D.items.length;
  try { ORT_BYTES = (await ortRuntime()).ORT_WASM_BYTES; } catch (e) {}
  $('c-laya-size').textContent = fmtB(D.layaBytes); $('c-ort-size').textContent = fmtB(ORT_BYTES); $('c-laya-host').textContent = layaHostLabel;
  showContacts(); updateCard();
  await showCache();
  S.dev = await probe(); renderProbe(S.dev); applyGates(S.dev); updateCard();
  setStatus(S.dev.ok ? 'Idle. Press Start when ready.' : 'Idle. The GPU test is unavailable in this browser (see above).');
}
['p-laya', 'p-laya-cpu', 'p-ok'].forEach((id) => $(id).addEventListener('change', syncStart));
$('b-start').addEventListener('click', () => { if (!$('b-start').disabled) start(); });
$('b-stop').addEventListener('click', stop);
$('b-remove').addEventListener('click', removeDownload);
$('b-copy').addEventListener('click', copyCard);
init();
