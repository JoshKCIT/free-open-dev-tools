/**
 * MD4 as RFC 1320 defines it, and the NTLM (NT) hash built on it.
 *
 * MD4 is broken: collisions are trivial and preimages are practical. It is here because older systems still store
 * values made with it, and the NT hash of a password is MD4 of the password as UTF-16LE (MS-NLMP section 3.3.1,
 * NTOWFv1: MD4(UNICODE(Passwd))).
 *
 * All arithmetic is on 32-bit integers (`| 0` after every sum, `>>> 0` where a value is read back as unsigned).
 */

/** Left shifts of the three rounds, repeating every four steps (RFC 1320 section 3.4). */
const SHIFTS_1 = [3, 7, 11, 19];
const SHIFTS_2 = [3, 5, 9, 13];
const SHIFTS_3 = [3, 9, 11, 15];
/** The order in which round 3 reads the sixteen words of a block. */
const ORDER_3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];

/** MD4 of a byte array, as its 16 bytes. */
export function md4(bytes: Uint8Array): Uint8Array {
  const length = bytes.length;
  // One 0x80 byte, zeros up to 56 bytes into a block, then the length in bits as two little-endian words.
  const total = Math.ceil((length + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = length * 8;
  view.setUint32(total - 8, bits % 4294967296, true);
  view.setUint32(total - 4, Math.floor(bits / 4294967296), true);

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;
  const x = new Int32Array(16);

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) x[i] = view.getInt32(offset + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let step = 0; step < 48; step++) {
      let f: number;
      let k: number;
      let constant: number;
      let shift: number;
      if (step < 16) {
        f = (b & c) | (~b & d);
        k = step;
        constant = 0;
        shift = SHIFTS_1[step & 3]!;
      } else if (step < 32) {
        const j = step - 16;
        f = (b & c) | (b & d) | (c & d);
        k = ((j & 3) << 2) | (j >> 2);
        constant = 0x5a827999;
        shift = SHIFTS_2[j & 3]!;
      } else {
        const j = step - 32;
        f = b ^ c ^ d;
        k = ORDER_3[j]!;
        constant = 0x6ed9eba1;
        shift = SHIFTS_3[j & 3]!;
      }
      const sum = (a + f + x[k]! + constant) | 0;
      const rotated = (sum << shift) | (sum >>> (32 - shift));
      // The four variables take turns being the one that changes: after each step they are (d, new, b, c).
      const next = d;
      d = c;
      c = b;
      b = rotated;
      a = next;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setInt32(0, a0, true);
  outView.setInt32(4, b0, true);
  outView.setInt32(8, c0, true);
  outView.setInt32(12, d0, true);
  return out;
}

/**
 * The NTLM (NT) hash of a password: MD4 of the text as UTF-16LE, two bytes per UTF-16 code unit, low byte first.
 * A character outside the Basic Multilingual Plane is two code units (a surrogate pair) and so four bytes.
 */
export function ntlm(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    bytes[i * 2] = unit & 0xff;
    bytes[i * 2 + 1] = unit >>> 8;
  }
  return md4(bytes);
}
