// AI Boom Trajectories: the report's runtime on the site's Doc shell (fragment page.js).
// The shell owns pages, sections, history, search and the rail; this file only fills and wires the
// content: the scenario explorer (filter kernel in WebAssembly, re-simulation in a worker), the money
// web, the deal / ledger filters, the cost calculator, the supply-chain toggle and fact deep links.
// Generated into page.js by aiecon/report/fragment.py; the engine glue below is wasm-bindgen output.
// Contract: no globals (everything goes through root.ownerDocument), no history calls, same-origin only.

function aieconEngine() {
const exports = {};
/* @ts-self-types="./aiecon_wasm.d.ts" */

/**
 * `(Σw)² / Σw²` over the selected paths.
 * @param {Float64Array} weights
 * @param {Uint32Array} selected
 * @returns {number}
 */
function effective_n(weights, selected) {
    const ptr0 = passArrayF64ToWasm0(weights, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(selected, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.effective_n(ptr0, len0, ptr1, len1);
    return ret;
}
exports.effective_n = effective_n;

/**
 * Weighted share of selected paths with `1 ≤ start ≤ h`.
 * @param {Int8Array} starts
 * @param {Float64Array} weights
 * @param {Uint32Array} selected
 * @param {number} h
 * @returns {number}
 */
function odds(starts, weights, selected, h) {
    const ptr0 = passArray8ToWasm0(starts, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(weights, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray32ToWasm0(selected, wasm.__wbindgen_export);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.odds(ptr0, len0, ptr1, len1, ptr2, len2, h);
    return ret;
}
exports.odds = odds;

/**
 * Weighted quantile over selected paths; NaN when nothing is selected.
 * @param {Float64Array} values
 * @param {Float64Array} weights
 * @param {Uint32Array} selected
 * @param {number} q
 * @returns {number}
 */
function quantile(values, weights, selected, q) {
    const ptr0 = passArrayF64ToWasm0(values, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(weights, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray32ToWasm0(selected, wasm.__wbindgen_export);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.quantile(ptr0, len0, ptr1, len1, ptr2, len2, q);
    return ret;
}
exports.quantile = quantile;

/**
 * Full run for the browser: base64 arrays plus shapes and quarter labels.
 * @param {string} model_json
 * @param {string} config_json
 * @returns {string}
 */
function run(model_json, config_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(model_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(config_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.run(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr3 = r0;
        var len3 = r1;
        if (r3) {
            ptr3 = 0; len3 = 0;
            throw takeObject(r2);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
    }
}
exports.run = run;

/**
 * Filter kernel: `offsets` delimits each node's allowed-state list; an empty
 * `offsets` means no driver constraints. `bits` is one bitmask per path.
 * @param {Int8Array} drivers
 * @param {number} n_paths
 * @param {number} k
 * @param {Uint32Array} bits
 * @param {Uint32Array} allowed
 * @param {Uint32Array} offsets
 * @param {number} require
 * @param {number} exclude
 * @returns {Uint32Array}
 */
function select(drivers, n_paths, k, bits, allowed, offsets, require, exclude) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(drivers, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(bits, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(allowed, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(offsets, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        wasm.select(retptr, ptr0, len0, n_paths, k, ptr1, len1, ptr2, len2, ptr3, len3, require, exclude);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v5 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export3(r0, r1 * 4, 4);
        return v5;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
exports.select = select;

/**
 * JSON variant used by the CLI-equivalent path and by tests.
 * @param {string} input_json
 * @param {string} filter_json
 * @returns {string}
 */
function select_json(input_json, filter_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(filter_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.select_json(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr3 = r0;
        var len3 = r1;
        if (r3) {
            ptr3 = 0; len3 = 0;
            throw takeObject(r2);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
    }
}
exports.select_json = select_json;

/**
 * Per-series sha256 of the raw little-endian arrays (native = WASM check).
 * @param {string} model_json
 * @param {string} config_json
 * @returns {string}
 */
function series_hashes(model_json, config_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(model_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(config_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.series_hashes(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr3 = r0;
        var len3 = r1;
        if (r3) {
            ptr3 = 0; len3 = 0;
            throw takeObject(r2);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
    }
}
exports.series_hashes = series_hashes;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
    };
    return {
        __proto__: null,
        "./aiecon_wasm_bg.js": import0,
    };
}

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasm;
exports.instantiate = async function (bytes) {
  const mod = await WebAssembly.compile(bytes);
  wasm = (await WebAssembly.instantiate(mod, __wbg_get_imports())).exports;
  if (wasm.__wbindgen_start) wasm.__wbindgen_start();
  return exports;
};
return exports;
}


const ASSET = "/research/ai-economy/";

export default function init({ root, rd }) {
	const doc = root.ownerDocument;
	const view = doc.defaultView;
	const $ = (id) => doc.getElementById(id);
	const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
	const icon = (name) => `<svg class="rd-icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

	// ---------------------------------------------------------------- sidecars (fetched on first use)
	async function bytes(url) {
		const res = await view.fetch(ASSET + url);
		if (!res.ok) throw new Error(url + " " + res.status);
		const buf = new Uint8Array(await res.arrayBuffer());
		if (buf[0] !== 0x1f || buf[1] !== 0x8b) return buf.buffer; // a server already decoded it
		const stream = new view.Blob([buf]).stream().pipeThrough(new view.DecompressionStream("gzip"));
		return new view.Response(stream).arrayBuffer();
	}
	let dataP = null;
	const data = () => (dataP ??= view.fetch(ASSET + "data.json").then((r) => r.json()));
	let pathsP = null;
	const paths = () => (pathsP ??= bytes("paths.json.gz").then((b) => JSON.parse(new view.TextDecoder().decode(b))));
	let engineP = null;
	const engine = () => (engineP ??= bytes("engine.wasm.gz").then((b) => aieconEngine().instantiate(b)));

	// ---------------------------------------------------------------- mounting
	const mounted = new Set();
	const MOUNTS = { "tab-explore": mountExplorer, "tab-money": mountMoney };
	function mount(id) {
		if (mounted.has(id) || !MOUNTS[id]) return;
		mounted.add(id);
		MOUNTS[id]();
	}
	for (const id of Object.keys(MOUNTS)) {
		const panel = $(id);
		if (panel && !panel.hidden) mount(id);
	}
	rd?.on?.("tabshow", ({ id }) => mount(id));

	// ---------------------------------------------------------------- links into folds and the ledger
	// A link or URL that names an element inside a closed <details> opens it first; a fact id (#fact-F0123)
	// also clears the ledger filters so its row is not hidden, and marks the row for a moment.
	function reveal(id) {
		const el = id && $(id);
		if (!el) return;
		for (let d = el.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
		if (el.tagName === "DETAILS") el.open = true;
		if (id.startsWith("fact-")) {
			ledger.clear();
			el.classList.add("ae-hl");
			view.setTimeout(() => el.classList.remove("ae-hl"), 2400);
		}
	}
	const hashId = () => decodeURIComponent(view.location.hash.slice(1));
	doc.addEventListener("click", (e) => {
		const a = e.target.closest?.('a[href*="#"]');
		if (a && a.origin === view.location.origin && a.pathname === view.location.pathname) reveal(decodeURIComponent(a.hash.slice(1)));
	}, true);
	view.addEventListener("hashchange", () => reveal(hashId()));

	// ---------------------------------------------------------------- evidence ledger filter
	const ledger = (() => {
		const q = $("src-search"), topic = $("sl-topic"), stance = $("sl-stance"), tier = $("sl-tier");
		const sup = root.querySelector("[data-sl-sup]"), count = root.querySelector("[data-sl-count]");
		const rows = Array.from(root.querySelectorAll("tr[data-topic]"));
		function draw() {
			const s = q ? q.value.trim().toLowerCase() : "";
			let n = 0;
			for (const r of rows) {
				const ok = (sup?.checked || !r.hasAttribute("data-sup")) &&
					(!topic?.value || r.dataset.topic === topic.value) &&
					(!stance?.value || r.dataset.stance === stance.value) &&
					(!tier?.value || r.dataset.tier === tier.value) &&
					(!s || r.textContent.toLowerCase().includes(s));
				r.hidden = !ok;
				if (ok) n++;
			}
			if (count) count.textContent = `${n.toLocaleString()} of ${rows.length.toLocaleString()} facts`;
		}
		for (const el of [q, topic, stance, tier]) el?.addEventListener("input", draw);
		sup?.addEventListener("change", draw);
		if (rows.length) draw();
		return {
			clear() {
				if (!rows.length) return;
				for (const el of [q, topic, stance, tier]) if (el) el.value = "";
				if (sup) sup.checked = true;
				draw();
			},
		};
	})();
	reveal(hashId());

	// ---------------------------------------------------------------- deal table filter
	{
		const sel = root.querySelector("[data-dl-type]");
		const rows = sel ? Array.from(root.querySelectorAll("tr[data-type]")) : [];
		const count = root.querySelector("[data-dl-count]");
		const draw = () => {
			let n = 0;
			for (const r of rows) {
				const on = !sel.value || r.dataset.type === sel.value;
				r.hidden = !on;
				if (on) n++;
			}
			if (count) count.textContent = `${n} of ${rows.length} deals`;
		};
		if (sel) {
			sel.addEventListener("change", draw);
			draw();
		}
	}

	// ---------------------------------------------------------------- supply-chain mode (gross / value added)
	{
		const btns = Array.from(root.querySelectorAll("[data-gl-mode]"));
		for (const b of btns)
			b.addEventListener("click", () => {
				for (const x of btns) x.setAttribute("aria-pressed", String(x === b));
				for (const p of root.querySelectorAll("[data-gl-pane]")) p.hidden = p.dataset.glPane !== b.dataset.glMode;
			});
	}

	// ---------------------------------------------------------------- local-inference cost calculator
	{
		const inputs = Array.from(root.querySelectorAll("[data-tco]"));
		const D = 30.4375, SEC = 86400, R = 3;
		const API = { open: { i: 0.15, o: 0.6 }, frontier: { i: 4, o: 20 } };
		const blend = (a) => (R * a.i + a.o) / (R + 1);
		function tco(p, life, w, kwh, tps, util, api) {
			const elec = ((w * 24 * D) / 1000) * kwh, td = (tps * SEC * util) / 100, tpm = (td * D) / 1e6, apiM = tpm * api;
			const tot = p + elec * life;
			return { tot, lpm: tot / (tpm * life), td, be: apiM <= elec ? null : p / (apiM - elec) };
		}
		const months = (x) => (x == null ? "never" : x.toFixed(2) + " months");
		function run() {
			const g = (n) => parseFloat(root.querySelector(`[data-tco="${n}"]`)?.value) || 0;
			const args = [g("price"), g("life_months"), g("watts"), g("kwh"), g("tok_per_s"), g("utilization_pct")];
			const ro = tco(...args, blend(API.open)), rf = tco(...args, blend(API.frontier));
			const set = (n, v) => { const e = root.querySelector(`[data-tco-out="${n}"]`); if (e) e.textContent = v; };
			set("total_local_cost", "$" + Math.round(rf.tot).toLocaleString());
			set("local_per_mtok", "$" + rf.lpm.toFixed(2));
			set("tokens_per_day", Math.round(rf.td).toLocaleString());
			set("be_open", months(ro.be));
			set("be_frontier", months(rf.be));
			const f = root.querySelector('[data-tco-out="finding"]');
			if (f) {
				const L = rf.lpm, O = blend(API.open), F = blend(API.frontier);
				f.innerHTML = `At these settings, local is <strong>${L > O ? "dearer" : "cheaper"}</strong> than an API serving the open model ($${L.toFixed(2)} vs $${O.toFixed(2)}/Mtok) and <strong>${L < F ? "cheaper" : "dearer"}</strong> than the frontier API ($${L.toFixed(2)} vs $${F.toFixed(2)}/Mtok).`;
			}
		}
		for (const e of inputs) e.addEventListener("input", run);
	}

	// ---------------------------------------------------------------- scenarios -> explorer
	let pendingScenario = null;
	let explorerApi = null;
	for (const b of root.querySelectorAll("[data-states]"))
		b.addEventListener("click", () => {
			pendingScenario = JSON.parse(b.dataset.states);
			if (explorerApi) explorerApi.load(pendingScenario);
			// The explorer is a section of this page: open it as a link would (the shell shows it, one entry).
			const a = doc.createElement("a");
			a.href = "#explorer";
			a.hidden = true;
			root.append(a);
			a.click();
			a.remove();
		});

	// ================================================================ explorer
	function mountExplorer() {
		const box = $("ae-explorer");
		if (!box) return;
		const UNKNOWN = 255, IN = "in", OUT = "out", SIM_PATHS = 5000;
		const SERIES = [
			{ name: "gdp_growth", label: "GDP growth", unit: "pp SAAR", kind: "pct" },
			{ name: "unemployment", label: "Unemployment", unit: "%", kind: "pct" },
			{ name: "spx", label: "S&P 500", unit: "index", kind: "num" },
			{ name: "hy_oas", label: "HY OAS", unit: "bp", kind: "bp" },
			{ name: "capex_big4", label: "Big-4 AI capex", unit: "$bn/qtr", kind: "money" },
			{ name: "ai_rev_direct", label: "Direct AI revenue", unit: "$bn/qtr", kind: "money" },
		];
		const S = { bundle: null, wasm: null, groups: {}, model: "", driver: {}, outcome: {}, selected: null, eff: 0, mode: "condition", sim: null, worker: null, cache: {}, base: {} };
		const status = (t) => { const n = $("expl-status"); if (n) n.textContent = t; };

		// decoding (the bundle's typed arrays are base64 in JSON)
		const b64 = (text) => { const bin = view.atob(text); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
		const aligned = (Ctor, text) => new Ctor(b64(text).slice().buffer);
		const n = () => Number(S.bundle.meta.n_export);
		const t = () => S.bundle.meta.quarters.length;
		let weights = null;
		function pathWeights() {
			if (!weights) weights = Float64Array.from(aligned(Float32Array, S.bundle.weights));
			return weights;
		}
		function column(name, i) {
			let c = S.cache[name];
			if (!c) {
				const block = S.bundle.series[name], raw = aligned(Uint16Array, block.data);
				c = new Float64Array(n() * t());
				for (let k = 0; k < c.length; k++) c[k] = block.offset + raw[k] * block.scale;
				S.cache[name] = c;
			}
			const col = new Float64Array(n());
			for (let j = 0; j < n(); j++) col[j] = c[j * t() + i];
			return col;
		}
		function simColumn(name, i) {
			const v = S.sim.series[name];
			if (!v) return null;
			const col = new Float64Array(S.sim.n);
			for (let p = 0; p < S.sim.n; p++) col[p] = v[p * S.sim.columns + i];
			return col;
		}

		// filters
		function allowed(node) {
			const c = S.driver[node.id];
			if (!c) return null;
			const idx = node.states.indexOf(c.chip);
			if (idx < 0) return null;
			if (c.state === IN) return [idx];
			const codes = [UNKNOWN];
			node.states.forEach((_, i) => { if (i !== idx) codes.push(i); });
			return codes;
		}
		const mask = (kind) => S.bundle.outcomes.flags.reduce((m, f, i) => (S.outcome[f] === kind ? (m | (1 << i)) >>> 0 : m), 0);
		function select() {
			const nodes = S.bundle.drivers.nodes, codes = [], offsets = [0];
			for (const node of nodes) { for (const c of allowed(node) || []) codes.push(c); offsets.push(codes.length); }
			return S.wasm.select(aligned(Int8Array, S.bundle.drivers.data), n(), nodes.length, aligned(Uint32Array, S.bundle.outcomes.bits), new Uint32Array(codes), new Uint32Array(offsets), mask("require"), mask("exclude"));
		}

		// formatting
		function fmt(kind, v) {
			if (v == null || Number.isNaN(v)) return "—";
			if (kind === "pct") return v.toFixed(1) + "%";
			if (kind === "bp") return v.toFixed(0) + " bp";
			if (kind === "money") return "$" + Math.round(v).toLocaleString() + "bn";
			return Math.round(v).toLocaleString();
		}
		const pretty = (id) => id.replace(/_/g, " ").replace(/\bgpu\b/gi, "GPU").replace(/\bai\b/gi, "AI").replace(/\broi\b/gi, "ROI").replace(/^./, (c) => c.toUpperCase());
		const chipText = (node, key) => { const l = node.labels[key] || key; return l.length <= 26 ? l : pretty(key); };

		// charts
		function quantiles(name, exported) {
			const out = { p5: [], p25: [], p50: [], p75: [], p95: [] };
			for (let i = 0; i < t(); i++) {
				const col = exported ? column(name, i) : simColumn(name, i);
				const w = exported ? pathWeights() : S.sim.weights;
				const sel = exported ? S.selected : S.sim.all;
				for (const [k, q] of [["p5", 0.05], ["p25", 0.25], ["p50", 0.5], ["p75", 0.75], ["p95", 0.95]]) out[k].push(S.wasm.quantile(col, w, sel, q));
			}
			return out;
		}
		function band(lo, hi, xs, y) {
			const pts = xs.map((x, i) => x.toFixed(1) + "," + y(hi[i]).toFixed(1));
			for (let j = xs.length - 1; j >= 0; j--) pts.push(xs[j].toFixed(1) + "," + y(lo[j]).toFixed(1));
			return pts.join(" ");
		}
		function fanSvg(spec, b, ghost) {
			const W = 340, H = 152, L = 52, R = 8, T = 10, B = 24, qs = S.bundle.meta.quarters;
			const xs = qs.map((_, i) => L + (i / (qs.length - 1)) * (W - L - R));
			let lo = Infinity, hi = -Infinity;
			for (const blk of [b, ghost]) if (blk) for (const q of ["p5", "p95"]) for (const v of blk[q]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
			if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
			const pad = (hi - lo) * 0.08 || 1;
			lo -= pad; hi += pad;
			const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
			const txt = 'font-size="11" fill="var(--rd-text-muted)"';
			let grid = "";
			for (let g = 0; g < 3; g++) {
				const gy = (T + (g / 2) * (H - T - B)).toFixed(1);
				grid += `<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" stroke="var(--rd-line)" stroke-width=".5"/><text x="${L - 4}" y="${(+gy + 3).toFixed(1)}" text-anchor="end" ${txt}>${fmt(spec.kind, hi - (g / 2) * (hi - lo))}</text>`;
			}
			let ticks = "";
			for (const i of [0, Math.floor((qs.length - 1) / 2), qs.length - 1])
				ticks += `<text x="${xs[i].toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === qs.length - 1 ? "end" : "middle"}" ${txt}>${esc(qs[i])}</text>`;
			const line = (blk) => xs.map((x, i) => x.toFixed(1) + "," + y(blk.p50[i]).toFixed(1)).join(" ");
			const last = t() - 1;
			const label = `${spec.label}: median ${fmt(spec.kind, b.p50[last])} at ${qs[last]}, 90 percent interval ${fmt(spec.kind, b.p5[last])} to ${fmt(spec.kind, b.p95[last])}.`;
			return `<svg viewBox="0 0 ${W} ${H}" width="${W}" class="ae-svg" role="img" aria-label="${esc(label)}">${grid}${ticks}` +
				`<polygon points="${band(b.p5, b.p95, xs, y)}" fill="var(--rd-accent)" fill-opacity=".14"/>` +
				`<polygon points="${band(b.p25, b.p75, xs, y)}" fill="var(--rd-accent)" fill-opacity=".22"/>` +
				(ghost ? `<polyline points="${line(ghost)}" fill="none" stroke="var(--rd-text-muted)" stroke-width="1" stroke-dasharray="3 3"/>` : "") +
				`<polyline points="${line(b)}" fill="none" stroke="var(--rd-accent)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
		}
		function fanTable(spec, b) {
			const qs = S.bundle.meta.quarters;
			const rows = [0, 4, 8, 12, 16, qs.length - 1].map((i) => `<tr><th scope="row">${esc(qs[i])}</th><td class="rd-num">${fmt(spec.kind, b.p5[i])}</td><td class="rd-num">${fmt(spec.kind, b.p50[i])}</td><td class="rd-num">${fmt(spec.kind, b.p95[i])}</td></tr>`).join("");
			return `<details class="rd-fold"><summary>Table</summary><div class="rd-table-wrap"><table class="rd-table"><thead><tr><th scope="col">Quarter</th><th scope="col" class="rd-num">p5</th><th scope="col" class="rd-num">Median</th><th scope="col" class="rd-num">p95</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
		}
		function charts() {
			const host = $("expl-charts");
			if (!host) return;
			const iv = S.mode === "intervene" && S.sim;
			const count = iv ? S.sim.n : S.selected.length;
			summary();
			if (count === 0) { host.innerHTML = '<p class="rd-meta" role="status">No paths match these filters. Reset to see the unconditional run.</p>'; return; }
			if (count < 30) { host.innerHTML = `<p class="rd-meta" role="status">Too few paths (${count}) to show numbers. Loosen the filters or reset.</p>`; return; }
			const thin = count < 200;
			host.innerHTML = SERIES.map((spec) => {
				const b = quantiles(spec.name, !iv);
				return `<figure class="ae-fan"><figcaption><span class="ae-title">${esc(spec.label)}</span> <span class="rd-meta">${esc(spec.unit)} · ${iv ? "intervention" : "condition"}</span></figcaption>` +
					fanSvg(spec, b, S.base[spec.name] || null) + fanTable(spec, b) +
					(thin ? '<p class="rd-meta">Thin sample: fewer than 200 effective paths.</p>' : "") + "</figure>";
			}).join("");
		}
		function summary() {
			if (!S.bundle || !S.selected) return;
			const iv = S.mode === "intervene" && S.sim;
			const count = iv ? S.sim.n : S.selected.length, eff = iv ? S.sim.n : S.eff, total = n();
			const node = $("expl-summary");
			if (node) node.textContent = `${count.toLocaleString()} of ${total.toLocaleString()} exported paths (effective ${Math.round(eff).toLocaleString()})`;
			const bar = $("cond-count");
			if (bar) bar.textContent = `${count.toLocaleString()} / ${total.toLocaleString()}`;
		}

		// controls
		function ruleHits(rule, nodeId, chip) {
			return Object.keys(rule.if).every((id) => {
				if (id === nodeId && rule.if[id] === chip) return true;
				const c = S.driver[id];
				return !!c && c.state === IN && c.chip === rule.if[id];
			});
		}
		function rulesOut(nodeId, chip) {
			for (const rule of S.bundle.rules_out || []) {
				if (!ruleHits(rule, nodeId, chip)) continue;
				if (rule.forbid[nodeId] === chip) return rule.why;
				if (rule.forbid.outcome && S.outcome[rule.forbid.outcome] === "require") return rule.why;
			}
			return null;
		}
		function outcomeRulesOut(flag) {
			for (const rule of S.bundle.rules_out || []) {
				if (rule.forbid.outcome !== flag) continue;
				if (Object.keys(rule.if).every((id) => { const c = S.driver[id]; return !!c && c.state === IN && c.chip === rule.if[id]; })) return rule.why;
			}
			return null;
		}
		function buildControls() {
			const groups = {};
			for (const node of S.bundle.drivers.nodes) (groups[S.groups[node.id] || "drivers"] ??= []).push(node);
			$("expl-drivers").innerHTML = Object.keys(groups).sort().map((g) =>
				`<h4>${esc(pretty(g))}</h4>` + groups[g].map((node) =>
					`<div class="ae-row"><span class="rd-meta">${esc(pretty(node.id))}</span>` + node.states.map((s) =>
						`<button type="button" class="rd-filter" data-node="${esc(node.id)}" data-chip="${esc(s)}" data-label="${esc(node.labels[s] || s)}" aria-pressed="false">${esc(chipText(node, s))}</button>`).join("") + "</div>").join("")).join("");
			$("expl-outcomes").innerHTML = '<h4>Outcomes</h4><div class="ae-row">' + S.bundle.outcomes.flags.map((f) =>
				`<button type="button" class="rd-filter" data-outcome="${esc(f)}" aria-pressed="false">${esc(f.replace(/_/g, " "))}</button>`).join("") + "</div>";
			paint();
		}
		function paint() {
			for (const b of box.querySelectorAll("[data-node]")) {
				const c = S.driver[b.dataset.node];
				const on = !!c && c.chip === b.dataset.chip;
				b.setAttribute("aria-pressed", String(on));
				b.classList.toggle("ae-out", on && c.state === OUT);
				const why = on ? null : rulesOut(b.dataset.node, b.dataset.chip);
				b.disabled = !!why;
				b.title = why ? "Ruled out: " + why : on ? (c.state === IN ? "Kept (in). Tap to drop these paths." : "Dropped (out). Tap to clear.") : b.dataset.label;
			}
			for (const b of box.querySelectorAll("[data-outcome]")) {
				const f = b.dataset.outcome, c = S.outcome[f], why = outcomeRulesOut(f);
				b.setAttribute("aria-pressed", String(!!c));
				b.classList.toggle("ae-out", c === "exclude");
				b.textContent = f.replace(/_/g, " ") + (c ? " · " + c : "");
				b.disabled = !!why && c !== "exclude";
				b.title = why ? "Ruled out: " + why : "";
			}
			const chips = [
				...Object.entries(S.driver).map(([id, c]) => `<span class="rd-chip ${c.state === IN ? "rd-chip--good" : "rd-chip--bad"}">${esc(pretty(id))}: ${esc(c.chip)} · ${c.state}</span>`),
				...Object.entries(S.outcome).map(([f, c]) => `<span class="rd-chip ${c === "require" ? "rd-chip--good" : "rd-chip--bad"}">${esc(f.replace(/_/g, " "))} · ${c}</span>`),
			];
			$("cond-chips").innerHTML = chips.length ? chips.join("") : '<span class="rd-meta">No filters</span>';
			$("cond-reset").disabled = chips.length === 0;
			const badge = $("mode-badge");
			if (badge) badge.textContent = S.mode === "intervene" ? "Intervene P(Y | do(X))" : "Condition P(Y | X)";
			const run = $("expl-resim");
			if (run && !S.worker) run.disabled = Object.keys(forces()).length === 0;
		}
		const forces = () => Object.fromEntries(Object.entries(S.driver).filter(([, c]) => c.state === IN).map(([id, c]) => [id, c.chip]));
		function update() {
			S.selected = select();
			S.eff = S.selected.length ? S.wasm.effective_n(pathWeights(), S.selected) : 0;
			paint();
			charts();
		}
		function load(states) {
			S.driver = {};
			S.outcome = {};
			for (const [id, chip] of Object.entries(states)) S.driver[id] = { state: IN, chip };
			S.sim = null;
			S.mode = "condition";
			update();
			status("Scenario drivers loaded: the bands show these paths.");
		}

		// re-simulation (Intervene): the engine runs in a worker on the shipped ModelInput
		function busy(on) {
			$("expl-progress").hidden = !on;
			$("expl-cancel").hidden = !on;
			$("expl-resim").disabled = on || Object.keys(forces()).length === 0;
		}
		function resim() {
			if (S.worker) return;
			const force = forces();
			if (!Object.keys(force).length) { status('Set at least one driver to "in" to force it.'); return; }
			busy(true);
			status(`Simulating ${SIM_PATHS.toLocaleString()} paths…`);
			const w = new view.Worker(ASSET + "engine-worker.js");
			S.worker = w;
			const done = () => { w.terminate(); S.worker = null; busy(false); };
			w.onmessage = (e) => {
				done();
				if (!e.data?.ok) { status("The engine rejected this scenario: " + (e.data ? e.data.error : "unknown error")); return; }
				accept(e.data.out);
			};
			w.onerror = (err) => { done(); status("Simulation failed: " + (err?.message || "worker error")); };
			const m = S.bundle.meta;
			w.postMessage({ model: S.model, config: JSON.stringify({ n_paths: SIM_PATHS, n_quarters: t(), seed: Number(m.seed), as_of: m.as_of, neutral_ai: false, hold_fci_at_mean: false, force, shocks: {}, import_share_override: null }) });
		}
		function accept(raw) {
			const wire = JSON.parse(raw), series = {};
			for (const name of Object.keys(wire.series)) series[name] = aligned(Float64Array, wire.series[name]);
			const all = new Uint32Array(wire.n_paths);
			for (let p = 0; p < wire.n_paths; p++) all[p] = p;
			S.sim = { series, weights: Float64Array.from(aligned(Float32Array, wire.weights)), all, n: wire.n_paths, columns: wire.n_columns };
			S.mode = "intervene";
			status(`Intervention: ${Object.keys(forces()).length} driver(s) forced, ${wire.n_paths.toLocaleString()} paths. These numbers are not the headline.`);
			paint();
			charts();
		}
		function cancel() {
			if (!S.worker) return;
			S.worker.terminate();
			S.worker = null;
			busy(false);
			status("Cancelled. Charts show the last completed run.");
		}

		box.addEventListener("click", (e) => {
			const chip = e.target.closest?.(".rd-filter");
			if (chip && !chip.disabled && S.bundle) {
				if (chip.dataset.outcome) {
					const f = chip.dataset.outcome, c = S.outcome[f];
					if (!c) S.outcome[f] = "require";
					else if (c === "require") S.outcome[f] = "exclude";
					else delete S.outcome[f];
				} else {
					const id = chip.dataset.node, c = S.driver[id];
					if (c && c.chip === chip.dataset.chip) {
						if (c.state === IN) S.driver[id] = { state: OUT, chip: c.chip };
						else delete S.driver[id];
					} else S.driver[id] = { state: IN, chip: chip.dataset.chip };
				}
				S.sim = null;
				S.mode = "condition";
				update();
			}
			if (e.target.closest?.("#cond-reset")) { S.driver = {}; S.outcome = {}; S.sim = null; S.mode = "condition"; update(); status(""); }
			if (e.target.closest?.("#expl-resim")) resim();
			if (e.target.closest?.("#expl-cancel")) cancel();
		});

		Promise.all([paths(), engine(), data()]).then(([bundle, wasm, d]) => {
			S.bundle = bundle;
			S.wasm = wasm;
			S.groups = d.groups || {};
			S.model = d.model || "";
			if (d.intervene === "paused") { $("expl-resim").hidden = true; $("expl-paused").hidden = false; }
			S.selected = Uint32Array.from({ length: n() }, (_, i) => i);
			S.eff = n();
			for (const spec of SERIES) S.base[spec.name] = bundle.summary.unfiltered[spec.name] || null;
			buildControls();
			update();
			explorerApi = { load };
			if (pendingScenario) load(pendingScenario);
		}).catch((err) => status("Could not load the exported paths or the engine: " + (err?.message || err)));
	}

	// ================================================================ money web
	function mountMoney() {
		const svg = $("mn-net");
		if (!svg) return;
		data().then((d) => { if (d.money) drawMoney(svg, d.money); }).catch(() => {});
	}
	function drawMoney(svg, P) {
		const NS = svg.namespaceURI;
		const laneH = 16, topM = 26, leftM = 178, rightM = 16, W = 1000, plotW = W - leftM - rightM;
		const H = topM + P.lanes.length * laneH + 10;
		svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
		const mk = (tag, attrs) => { const el = doc.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; };
		const tms = (s) => { const p = s.split("-"); return Date.UTC(+p[0], (p[1] ? +p[1] : 1) - 1, p[2] ? +p[2] : 1); };
		let tmin = Infinity, tmax = -Infinity;
		for (const d of P.deals) { const x = tms(d.date); tmin = Math.min(tmin, x); tmax = Math.max(tmax, x); }
		if (tmin === tmax) { tmin -= 864e5; tmax += 864e5; }
		const X = (x) => leftM + ((x - tmin) / (tmax - tmin)) * plotW;
		const Y = (c) => topM + P.laneIndex[c] * laneH + laneH / 2;
		let amax = 1;
		for (const d of P.deals) if (d.amt && d.amt > amax) amax = d.amt;
		const wOf = (amt) => (amt ? 1.5 + Math.sqrt(amt / amax) * 5 : 1.5);
		const baseOp = (d) => (d.status === "binding" ? 0.85 : d.status === "announced" ? 0.4 : 0.5);
		const groups = {};
		for (const d of P.deals) (groups[d.date + "|" + d.from + "|" + d.to] ??= []).push(d);
		for (const d of P.deals) { const g = groups[d.date + "|" + d.from + "|" + d.to]; d._dx = (g.indexOf(d) - (g.length - 1) / 2) * 5; }
		const muted = { "font-size": "11", fill: "var(--rd-text-muted)" };
		const axis = mk("g", {});
		svg.append(axis);
		const d0 = new Date(tmin);
		let ty = d0.getUTCFullYear(), tm = d0.getUTCMonth(), ti = 0;
		for (;;) {
			const x = Date.UTC(ty, tm, 1);
			if (x > tmax + 864e5) break;
			if (x >= tmin - 864e5) {
				const px = X(x);
				axis.append(mk("line", { x1: px, x2: px, y1: topM - 4, y2: topM + P.lanes.length * laneH, stroke: "var(--rd-line)", "stroke-opacity": 0.5 }));
				if (ti % 2 === 0) {
					const lab = mk("text", { x: px, y: topM - 8, "text-anchor": "middle", ...muted });
					lab.textContent = `${ty}-${String(tm + 1).padStart(2, "0")}`;
					axis.append(lab);
				}
			}
			ti++;
			if (++tm > 11) { tm = 0; ty++; }
		}
		for (const c of P.lanes) {
			const lab = mk("text", { x: leftM - 8, y: Y(c) + 3, "text-anchor": "end", "font-size": "11", fill: "var(--rd-text)" });
			lab.textContent = c;
			svg.append(lab);
		}
		const gEdges = mk("g", {});
		svg.append(gEdges);
		const card = $("mn-card");
		const edges = P.deals.map((d) => {
			const x = X(tms(d.date)) + d._dx, y0 = Y(d.fromL), y1 = Y(d.toL), col = P.types[d.type] || "var(--rd-text-muted)";
			const g = mk("g", { opacity: baseOp(d) });
			const path = mk("path", { d: `M${x},${y0} L${x},${y1}`, stroke: col, "stroke-width": wOf(d.amt), "stroke-linecap": "round", tabindex: "0", role: "button", "aria-label": `${d.from} to ${d.to}, ${d.type}` });
			path.style.cursor = "pointer";
			if (d.contingent) path.setAttribute("stroke-dasharray", "4 3");
			if (d.status === "binding") for (const cy of [y0, y1]) g.append(mk("circle", { cx: x, cy, r: 2.4, fill: col }));
			const ay = y1 >= y0 ? y1 - 4 : y1 + 4;
			g.append(mk("path", { d: `M${x - 3},${ay} L${x},${y1} L${x + 3},${ay}`, fill: "none", stroke: col, "stroke-width": 1.4, "pointer-events": "none" }));
			const lab = mk("text", { x: x + 6, y: (y0 + y1) / 2 + 3, "font-size": "11", fill: "var(--rd-text)" });
			lab.textContent = d.amt != null ? `$${d.amt}B` : "no amount";
			lab.setAttribute("visibility", "hidden");
			g.append(path, lab);
			const open = () => showCard(d);
			path.addEventListener("click", open);
			path.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
			gEdges.append(g);
			return { g, lab, op: baseOp(d), i: d.i };
		});
		function showCard(d) {
			if (!card) return;
			const amt = d.amt == null ? "no amount disclosed" : `$${d.amt}B`;
			const rows = [["type", d.type], [d.status === "binding" ? "cash committed" : "cash (announced)", amt], ["status", d.status], ["date", d.date]];
			if (d.contingent) rows.push(["contingent", "cap / guarantee"]);
			card.innerHTML = `<div class="ae-split"><p class="ae-title">${esc(d.from)} to ${esc(d.to)}</p><button type="button" class="rd-btn rd-btn--icon rd-btn--ghost" aria-label="Close">${icon("x")}</button></div>` +
				`<dl class="rd-defs">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` +
				`<p class="rd-meta">${esc(d.note)}</p><p class="rd-meta">Source fact: <a href="#fact-${esc(d.fact)}">${esc(d.fact)}</a></p>`;
			card.querySelector("button").addEventListener("click", () => card.hidePopover());
			card.querySelector("a").addEventListener("click", () => card.hidePopover());
			if (!card.hasAttribute("popover")) card.setAttribute("popover", "");
			card.hidden = false;
			card.showPopover();
		}
		const sel = $("mn-cycle");
		if (sel) {
			sel.replaceChildren(new view.Option("All deals", "all"), ...P.cycles.map((c) => new view.Option(`Cycle ${c.id + 1}: ${c.label}`, String(c.id))));
			sel.addEventListener("change", () => {
				const c = sel.value === "all" ? null : P.cycles.find((x) => String(x.id) === sel.value);
				const on = c ? new Set(c.edges) : null;
				for (const e of edges) {
					e.g.setAttribute("opacity", !on ? e.op : on.has(e.i) ? 1 : 0.12);
					e.lab.setAttribute("visibility", on && on.has(e.i) ? "visible" : "hidden");
				}
			});
		}
	}
}
