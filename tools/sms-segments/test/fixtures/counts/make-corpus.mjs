/**
 * The seeded message corpus the recorded counts are made from: 690 messages, 23 lengths around the 70, 134, 153, 160 and
 * 306 boundaries, times 5 mixes of plain, extension and non-GSM characters, times 6 messages each.
 *
 * Seed 12345 with the generator `seed = (seed * 1664525 + 1013904223) >>> 0`; the pools are written out below so the corpus
 * does not depend on any table of this tool. The 30 empty messages (length 0) are part of the corpus on purpose.
 */

export const SEED = 12345;

// The GSM 7-bit default alphabet without line feed and carriage return, in code order, with code 0x1B left out.
const DEFAULT_POOL =
  '@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

// The extension table: form feed, ^, {, }, backslash, [, ~, ], vertical bar, euro sign.
const EXTENSION_POOL = [12, 94, 123, 125, 92, 91, 126, 93, 124, 0x20ac].map((cp) => String.fromCodePoint(cp));

// Characters outside the alphabet, each a list of code points: c cedilla (lower case), right single quote, left double
// quote, em dash, ellipsis, no-break space, zero width space, a smiling face, a CJK character, e circumflex, a acute,
// e followed by a combining acute, tab, NUL.
const NON_GSM_POOL = [
  [0xe7],
  [0x2019],
  [0x201c],
  [0x2014],
  [0x2026],
  [0xa0],
  [0x200b],
  [0x1f600],
  [0x4e2d],
  [0xea],
  [0xe1],
  [0x65, 0x301],
  [9],
  [0],
].map((cps) => String.fromCodePoint(...cps));

const LENGTHS = [0, 1, 5, 69, 70, 71, 133, 134, 135, 152, 153, 154, 159, 160, 161, 305, 306, 307, 310, 460, 459, 461, 800];
const MIXES = [
  { ext: 0, non: 0 },
  { ext: 0.05, non: 0 },
  { ext: 0, non: 0.02 },
  { ext: 0.3, non: 0 },
  { ext: 0.1, non: 0.1 },
];
const PER_CELL = 6;

/** The 690 messages, in a fixed order. */
export function makeCorpus() {
  let seed = SEED;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const plain = [...DEFAULT_POOL];
  const make = (length, mix) => {
    let text = '';
    for (let i = 0; i < length; i++) {
      const r = rnd();
      if (r < mix.ext) text += pick(EXTENSION_POOL);
      else if (r < mix.ext + mix.non) text += pick(NON_GSM_POOL);
      else text += pick(plain);
    }
    return text;
  };
  const rows = [];
  for (const length of LENGTHS) {
    for (const mix of MIXES) {
      for (let k = 0; k < PER_CELL; k++) rows.push(make(length, mix));
    }
  }
  return rows;
}
