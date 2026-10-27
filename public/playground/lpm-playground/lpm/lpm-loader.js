// Shared LPM1 streaming loader (DOM-free). Used by demo.js (OPFS re-upload) and
// lpm-client.js (network / OPFS / file loads): ONE implementation of "stream an
// LPM1 container into the GPU in 16 MiB chunks".
//
// `reader` is a ReadableStreamDefaultReader over the container bytes
// ([64-byte header][data][36-byte footer]). `api` is { lpm1_begin, lpm1_chunk,
// lpm1_finish } from pkg/lpm_web.js. Without `tee`, reading stops once the data
// section is in (the footer is ignored). With `tee`, every raw chunk (header,
// data and footer) is handed to `tee(chunk)` before use and the stream is read
// to its end, so the caller can write a byte-exact copy (the OPFS cache).
// Returns what `lpm1_finish` returns (the wasm heap size); a BLAKE3 or size
// mismatch throws from there.
export const CHUNK = 16 * 1024 * 1024;
export const LPM1_HEADER = 64;

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export async function streamLpm1(reader, api, { onProgress, tee } = {}) {
  const staging = new Uint8Array(CHUNK);
  let sOff = 0;
  const flush = () => {
    if (sOff === 0) return;
    api.lpm1_chunk(sOff === CHUNK ? staging : staging.subarray(0, sOff));
    sOff = 0;
  };
  const fill = (chunk) => {
    let ci = 0;
    while (ci < chunk.length) {
      const w = Math.min(CHUNK - sOff, chunk.length - ci);
      staging.set(chunk.subarray(ci, ci + w), sOff);
      sOff += w;
      ci += w;
      if (sOff === CHUNK) flush();
    }
  };

  let head = new Uint8Array(0);
  let want = null;
  let fed = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (tee) await tee(value);
    let v = value;
    if (want === null) {
      head = concat(head, v);
      if (head.length < LPM1_HEADER) continue;
      want = await api.lpm1_begin(head.subarray(0, LPM1_HEADER));
      v = head.subarray(LPM1_HEADER); // over-read past the header is data
      head = null;
    }
    const take = Math.min(v.length, want - fed);
    if (take > 0) {
      fill(v.subarray(0, take));
      fed += take;
      if (onProgress) onProgress(fed, want);
    }
    if (fed >= want && !tee) {
      await reader.cancel();
      break;
    }
  }
  if (want === null) throw new Error("LPM1 stream shorter than the 64-byte header");
  if (fed < want) throw new Error(`LPM1 stream ended early (${fed} of ${want} data bytes)`);
  flush();
  return api.lpm1_finish();
}
