/**
 * Chunk framing for the HTTPS firmware download stream.
 *
 * Each frame:  seq:u32be | len:u32be | crc32:u32be | flags:u32be | payload[len]
 * flags bit0 = last chunk of the file.
 */
export const FRAME_HEADER_BYTES = 16;
export const FLAG_LAST = 1;

let table: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodeFrame(seq: number, payload: Uint8Array, last: boolean): Uint8Array {
  const out = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, seq);
  dv.setUint32(4, payload.length);
  dv.setUint32(8, crc32(payload));
  dv.setUint32(12, last ? FLAG_LAST : 0);
  out.set(payload, FRAME_HEADER_BYTES);
  return out;
}

export interface Frame {
  seq: number;
  length: number;
  crc: number;
  last: boolean;
  payload: Uint8Array;
}

/** Decode a single complete frame (used by tests and reference clients). */
export function decodeFrame(buf: Uint8Array): Frame {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const length = dv.getUint32(4);
  const payload = buf.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + length);
  if (payload.length !== length) throw new Error("truncated frame");
  const crc = dv.getUint32(8);
  if (crc32(payload) !== crc) throw new Error("crc mismatch");
  return { seq: dv.getUint32(0), length, crc, last: (dv.getUint32(12) & FLAG_LAST) !== 0, payload };
}
