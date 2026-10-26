/* @ts-self-types="./voice_chat.d.ts" */

//#region exports

export class Mel {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MelFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_mel_free(ptr, 0);
    }
    /**
     * Extract log-mel features from 16 kHz audio. Returns `[n_mels * frames]`, mel-major.
     * @param {Float32Array} samples
     * @returns {Float32Array}
     */
    extract(samples) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.mel_extract(this.__wbg_ptr, samples);
        return ret;
    }
    /**
     * The Whisper 80-mel front end.
     */
    constructor() {
        const ret = wasm.mel_whisper();
        this.__wbg_ptr = ret;
        MelFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Mel.prototype[Symbol.dispose] = Mel.prototype.free;

export class Resampler {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ResamplerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_resampler_free(ptr, 0);
    }
    /**
     * @param {number} src_rate
     * @param {number} dst_rate
     */
    constructor(src_rate, dst_rate) {
        _assertNum(src_rate);
        _assertNum(dst_rate);
        const ret = wasm.resampler_new(src_rate, dst_rate);
        this.__wbg_ptr = ret;
        ResamplerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Float32Array} src
     * @returns {Float32Array}
     */
    process(src) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.resampler_process(this.__wbg_ptr, src);
        return ret;
    }
}
if (Symbol.dispose) Resampler.prototype[Symbol.dispose] = Resampler.prototype.free;

export class Ring {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RingFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ring_free(ptr, 0);
    }
    clear() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        wasm.ring_clear(this.__wbg_ptr);
    }
    /**
     * @param {number} n
     */
    consume(n) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        _assertNum(n);
        wasm.ring_consume(this.__wbg_ptr, n);
    }
    /**
     * @returns {number}
     */
    len() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.ring_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} cap
     */
    constructor(cap) {
        _assertNum(cap);
        const ret = wasm.ring_new(cap);
        this.__wbg_ptr = ret;
        RingFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * The next `n` samples, without consuming them.
     * @param {number} n
     * @returns {Float32Array}
     */
    peek(n) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        _assertNum(n);
        const ret = wasm.ring_peek(this.__wbg_ptr, n);
        return ret;
    }
    /**
     * @param {Float32Array} block
     */
    push(block) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        wasm.ring_push(this.__wbg_ptr, block);
    }
    /**
     * The most recent `n` samples, oldest first.
     * @param {number} n
     * @returns {Float32Array}
     */
    tail(n) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        _assertNum(n);
        const ret = wasm.ring_tail(this.__wbg_ptr, n);
        return ret;
    }
}
if (Symbol.dispose) Ring.prototype[Symbol.dispose] = Ring.prototype.free;

export class SentenceSplitter {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SentenceSplitterFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sentencesplitter_free(ptr, 0);
    }
    /**
     * Feed the next decoded token. Returns the completed sentence, or null.
     * @param {string} token
     * @returns {string | undefined}
     */
    feed(token) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(token, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sentencesplitter_feed(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * Flush the remainder as a final sentence, or null.
     * @returns {string | undefined}
     */
    finish() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.sentencesplitter_finish(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    constructor() {
        const ret = wasm.sentencesplitter_new();
        this.__wbg_ptr = ret;
        SentenceSplitterFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) SentenceSplitter.prototype[Symbol.dispose] = SentenceSplitter.prototype.free;

export class Turn {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TurnFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_turn_free(ptr, 0);
    }
    /**
     * Returns true when the Smart Turn probability completed the turn.
     * @param {number} prob
     * @returns {boolean}
     */
    feed_turn_prob(prob) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.turn_feed_turn_prob(this.__wbg_ptr, prob);
        return ret !== 0;
    }
    /**
     * Returns true when the turn was interrupted.
     * @returns {boolean}
     */
    interrupt() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.turn_interrupt(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} complete_threshold
     * @param {number} timeout
     */
    constructor(complete_threshold, timeout) {
        _assertNum(timeout);
        const ret = wasm.turn_new(complete_threshold, timeout);
        this.__wbg_ptr = ret;
        TurnFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * 0 = idle, 1 = active.
     * @returns {number}
     */
    phase() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.turn_phase(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns true when the turn completed.
     * @returns {boolean}
     */
    speech_ended() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.turn_speech_ended(this.__wbg_ptr);
        return ret !== 0;
    }
    speech_started() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        wasm.turn_speech_started(this.__wbg_ptr);
    }
    /**
     * Returns true when the hard timeout completed the turn.
     * @returns {boolean}
     */
    tick() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.turn_tick(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) Turn.prototype[Symbol.dispose] = Turn.prototype.free;

export class Vad {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VadFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vad_free(ptr, 0);
    }
    /**
     * Feed a block of frames (`probs[i]` is frame i's speech probability, `samples[i]` its audio).
     * Returns the events emitted, in order.
     * @param {Float32Array} probs
     * @param {Float32Array} samples
     * @returns {VadEvent[]}
     */
    feed_block(probs, samples) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.vad_feed_block(this.__wbg_ptr, probs, samples);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * True when the current speech run is long enough to be real.
     * @returns {boolean}
     */
    is_real_speech() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.vad_is_real_speech(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * `threshold` in `[0,1]`; the rest in frames.
     * @param {number} threshold
     * @param {number} pre_roll
     * @param {number} min_speech
     * @param {number} hangover
     * @param {number} redemption
     */
    constructor(threshold, pre_roll, min_speech, hangover, redemption) {
        _assertNum(pre_roll);
        _assertNum(min_speech);
        _assertNum(hangover);
        _assertNum(redemption);
        const ret = wasm.vad_new(threshold, pre_roll, min_speech, hangover, redemption);
        this.__wbg_ptr = ret;
        VadFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * 0 = idle, 1 = speaking.
     * @returns {number}
     */
    phase() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.vad_phase(this.__wbg_ptr);
        return ret;
    }
    /**
     * The pre-roll audio that preceded the current speech start.
     * @returns {Float32Array}
     */
    pre_roll() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.vad_pre_roll(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Vad.prototype[Symbol.dispose] = Vad.prototype.free;

/**
 * A VAD event, as the JS side reads it.
 */
export class VadEvent {
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
    static __wrap(ptr) {
        const obj = Object.create(VadEvent.prototype);
        obj.__wbg_ptr = ptr;
        VadEventFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VadEventFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vadevent_free(ptr, 0);
    }
    /**
     * The frame index the event refers to.
     * @returns {number}
     */
    get frame() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.__wbg_get_vadevent_frame(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * 0 = none, 1 = started, 2 = ended.
     * @returns {number}
     */
    get kind() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.__wbg_get_vadevent_kind(this.__wbg_ptr);
        return ret;
    }
    /**
     * The frame index the event refers to.
     * @param {number} arg0
     */
    set frame(arg0) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        _assertNum(arg0);
        wasm.__wbg_set_vadevent_frame(this.__wbg_ptr, arg0);
    }
    /**
     * 0 = none, 1 = started, 2 = ended.
     * @param {number} arg0
     */
    set kind(arg0) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        _assertNum(arg0);
        wasm.__wbg_set_vadevent_kind(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    frame() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.vadevent_frame(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    kind() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.vadevent_kind(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) VadEvent.prototype[Symbol.dispose] = VadEvent.prototype.free;

//#endregion

//#region wasm imports
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_length_58572db4c38f3c3e: function() { return logError(function (arg0) {
            const ret = arg0.length;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_new_from_slice_ca6ad97db1f4779a: function() { return logError(function (arg0, arg1) {
            const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_prototypesetcall_8b03c01e2c0f8066: function() { return logError(function (arg0, arg1, arg2) {
            Float32Array.prototype.set.call(getArrayF32FromWasm0(arg0, arg1), arg2);
        }, arguments); },
        __wbg_vadevent_new: function() { return logError(function (arg0) {
            const ret = VadEvent.__wrap(arg0);
            return ret;
        }, arguments); },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./voice_chat_bg.js": import0,
    };
}


//#endregion
const MelFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_mel_free(ptr, 1));
const ResamplerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_resampler_free(ptr, 1));
const RingFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ring_free(ptr, 1));
const SentenceSplitterFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sentencesplitter_free(ptr, 1));
const TurnFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_turn_free(ptr, 1));
const VadFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vad_free(ptr, 1));
const VadEventFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vadevent_free(ptr, 1));


//#region intrinsics
function _assertNum(n) {
    if (typeof(n) !== 'number') throw new Error(`expected a number argument, found ${typeof(n)}`);
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function logError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        let error = (function () {
            try {
                return e instanceof Error ? `${e.message}\n\nStack:\n${e.stack}` : e.toString();
            } catch(_) {
                return "<failed to stringify thrown value>";
            }
        }());
        console.error("wasm-bindgen: imported JS function that was not marked as `catch` threw an error:", error);
        throw e;
    }
}

function passStringToWasm0(arg, malloc, realloc) {
    if (typeof(arg) !== 'string') throw new Error(`expected a string argument, found ${typeof(arg)}`);
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
        if (ret.read !== arg.length) throw new Error('failed to pass whole string');
        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
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


//#endregion

//#region wasm loading
let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('voice_chat_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
//#endregion
export { wasm as __wasm }
