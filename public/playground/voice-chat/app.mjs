// voice-chat — the page logic (loaded by the fragment's page.js). Loads the shared ORT loader and Kokoro engine, the Rust wasm, and
// the pipeline. Nothing downloads before the Start click.
import { ensureOrtRuntime } from '/tts/ort-runtime.js';
import { createEngine as createKokoro } from '/tts/kokoro.js';
import { Pipeline } from './pipeline.mjs';

const $ = (id) => document.getElementById(id);
const gate = $('gate'), live = $('live'), startBtn = $('start-btn'), stopBtn = $('stop-btn');
const gateStatus = $('gate-status'), err = $('err');
const transcript = $('transcript'), llmEl = $('llm'), latency = $('latency');
const wave = $('wave'), wctx = wave.getContext('2d');

const MODEL_BASE = 'https://huggingface.co/';
const VAD_URL = MODEL_BASE + 'onnx-community/silero-vad/resolve/main/onnx/model.onnx';
const TURN_URL = MODEL_BASE + 'pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-cpu.onnx';
const ASR_ENCODER_URL = MODEL_BASE + 'onnx-community/moonshine-base-ONNX/resolve/main/onnx/encoder_model.onnx';
// The non-merged decoder: it takes `encoder_hidden_states` (the raw encoder output) and computes
// the cross-attention KV internally, so no encoder-KV precomputation is needed. The merged variant
// (decoder_model_merged_q4f16.onnx) is rejected by ORT 1.27 at session creation (a graph-structure
// error), and the with-past variant expects pre-projected encoder KV we can't compute here.
const ASR_DECODER_URL = MODEL_BASE + 'onnx-community/moonshine-base-ONNX/resolve/main/onnx/decoder_model.onnx';
const LLM_URL = MODEL_BASE + 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX/resolve/main/onnx/model_q4f16.onnx';

let pipeline = null;
let kokoro = null;
let running = false;

function setChip(id, on, cls) {
  const el = $(id);
  el.classList.remove('is-on', 'is-bad', 'is-warn');
  if (cls) el.classList.add(cls);
  el.setAttribute('aria-disabled', on ? 'false' : 'true');
}

function setStage(name, on) {
  const el = document.querySelector(`.vc-stage[data-stage="${name}"]`);
  if (el) el.classList.toggle('is-on', on);
}

function showErr(msg) {
  err.textContent = msg;
  err.hidden = false;
}

function drawWave(samples) {
  const w = wave.width, h = wave.height;
  wctx.clearRect(0, 0, w, h);
  const mid = h / 2;
  const n = samples.length;
  if (!n) return;
  const step = Math.max(1, Math.floor(n / w));
  wctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--rd-accent') || '#4f46e5';
  wctx.lineWidth = 1;
  wctx.beginPath();
  for (let x = 0; x < w; x++) {
    let peak = 0;
    for (let i = x * step; i < (x + 1) * step && i < n; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    const y = mid - peak * (h / 2 - 2);
    wctx.lineTo(x, y);
    wctx.lineTo(x, h - y);
  }
  wctx.stroke();
}

function fmt(ms) {
  return ms == null ? '–' : Math.round(ms).toString();
}

function updateLatency(lat) {
  if (!lat) return;
  latency.hidden = false;
  for (const [k, v] of Object.entries(lat)) {
    const cell = latency.querySelector(`[data-l="${k}"]`);
    if (cell) cell.textContent = fmt(v);
  }
}

async function loadKokoro(onProgress) {
  if (kokoro) return kokoro;
  kokoro = createKokoro();
  await kokoro.init({ onProgress });
  return kokoro;
}

// The ONNX Runtime namespace the pipeline drives its sessions with. Wired explicitly, independent of
// Kokoro: the verified wasm binary from the shared loader, the UMD bundle evaluated for window.ort,
// and wasmPaths for the .mjs glue. Kokoro sets up its own copy; this one is the pipeline's.
let ortNs = null;
async function ensureOrt() {
  if (ortNs) return ortNs;
  const wasmBinary = await ensureOrtRuntime();
  const ortBase = new URL('/tts/vendor/ort/', location.href).href;
  if (!window.ort) {
    const s = document.createElement('script');
    s.src = ortBase + 'ort.webgpu.min.js';
    document.head.appendChild(s);
    await new Promise((r, j) => { s.onload = r; s.onerror = () => j(new Error('ONNX Runtime bundle failed to load')); });
  }
  window.ort.env.wasm.wasmBinary = wasmBinary;
  window.ort.env.wasm.wasmPaths = ortBase;
  ortNs = window.ort;
  return ortNs;
}

async function start() {
  startBtn.setAttribute('aria-disabled', 'true');
  gateStatus.hidden = false;
  gateStatus.textContent = 'Requesting microphone…';
  try {
    // WebGPU check.
    const gpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
    setChip('chip-gpu', gpu, gpu ? 'is-on' : 'is-warn');
    if (!gpu) {
      gateStatus.textContent = 'No WebGPU. The VAD, turn detector and ASR will run, but voice replies need a GPU. Use the text box below, or enable WebGPU.';
    }

    // Load the shared ORT runtime (pinned binary) and the Kokoro engine.
    gateStatus.textContent = 'Loading ONNX Runtime…';
    await ensureOrt();
    gateStatus.textContent = 'Loading Kokoro…';
    await loadKokoro((f) => { gateStatus.textContent = `Loading Kokoro… ${Math.round(f * 100)}%`; });

    // ASR + LLM are loaded on demand by the pipeline (after the VAD and turn are resident).
    const ort = () => ensureOrt();
    pipeline = new Pipeline(
      {
        ort,
        vadUrl: VAD_URL,
        turnUrl: TURN_URL,
        asrEncoderUrl: ASR_ENCODER_URL,
        asrDecoderUrl: ASR_DECODER_URL,
        llmUrl: LLM_URL,
        tts: kokoro,
      },
      {
        onState: (s) => {
          setChip('chip-vad', s.state === 'listening', 'is-on');
          setChip('chip-turn', s.turnActive, 'is-on');
          setChip('chip-llm', s.state === 'thinking', 'is-on');
          setChip('chip-tts', s.ttsPlaying, 'is-on');
          setStage('mic', s.state !== 'idle');
          setStage('vad', s.state === 'listening');
          setStage('turn', s.turnActive);
          setStage('llm', s.state === 'thinking');
          setStage('tts', s.ttsPlaying);
          if (s.state === 'interrupted') {
            llmEl.innerHTML = '<span class="vc-interrupted">interrupted</span>';
          }
          updateLatency(s.latency);
        },
        onEvent: (e) => {
          if (e.type === 'transcript') {
            transcript.innerHTML = `<span class="vc-you">You: </span>${escapeHtml(e.text)}`;
          } else if (e.type === 'interrupted') {
            llmEl.innerHTML = '<span class="vc-interrupted">interrupted</span>';
          } else if (e.type === 'error') {
            showErr(e.message);
          }
        },
      },
    );

    await pipeline.start();
    running = true;
    gate.hidden = true;
    live.hidden = false;
    startWave();
  } catch (e) {
    gateStatus.hidden = true;
    showErr(friendlyError(e));
  } finally {
    startBtn.removeAttribute('aria-disabled');
  }
}

function friendlyError(e) {
  const m = String(e?.message ?? e);
  if (/permission|denied|not permitted/i.test(m)) return 'Microphone permission was denied. Allow the microphone in your browser and try again.';
  if (/no devices|no microphone/i.test(m)) return 'No microphone was found.';
  if (/webgpu|adapter/i.test(m)) return 'WebGPU is not available on this device. Voice replies need a GPU; the text box below still works.';
  return m;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let waveTimer = null;
function startWave() {
  // The pipeline exposes the mic via its AudioContext; sample it for the waveform.
  const ctx = pipeline?.audioCtx;
  if (!ctx) return;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  // Connect the mic source to the analyser (the pipeline already connects it to the worklet).
  // We re-create a source from the same stream to tap it.
  pipeline.stream.getTracks().forEach((t) => {
    const src = ctx.createMediaStreamSource(new MediaStream([t]));
    src.connect(analyser);
  });
  const buf = new Float32Array(analyser.fftSize);
  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    drawWave(buf);
    waveTimer = requestAnimationFrame(tick);
  };
  tick();
}

async function stop() {
  running = false;
  if (waveTimer) cancelAnimationFrame(waveTimer);
  waveTimer = null;
  await pipeline?.stop();
  live.hidden = true;
  gate.hidden = false;
  transcript.textContent = '';
  llmEl.textContent = '';
  err.hidden = true;
  latency.hidden = true;
}

// The text fallback: run the LLM on typed text and speak the answer.
async function sendText() {
  const text = $('text-input').value.trim();
  if (!text) return;
  const out = $('text-llm');
  out.textContent = '';
  try {
    if (!kokoro) {
      await loadKokoro();
    }
    // Without a loaded LLM, we can only echo the text spoken. A real LLM would be wired here.
    out.textContent = '(LLM not loaded in this build) ';
    for await (const chunk of kokoro.speak(text)) {
      await playChunk(chunk.samples, chunk.sampleRate);
    }
  } catch (e) {
    out.textContent = friendlyError(e);
  }
}

let audioCtxShared = null;
async function playChunk(samples, sampleRate) {
  if (!audioCtxShared) audioCtxShared = new AudioContext();
  const ctx = audioCtxShared;
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
$('text-send').addEventListener('click', sendText);
