import { rule, SRC, type HashRule } from './rule';
import { BASE64, BASE64_URL, HEX, countTrailing, only, upperNote } from './scan';

/**
 * Rules for raw digests, which can only be told apart by length. A string that is exactly n hexadecimal characters lists
 * every algorithm of that length and nothing of the neighbouring lengths, in the order they are most often met. That order
 * is an editorial ranking and not a probability: the tables below are where to change it.
 */

interface DigestSpec {
  id: string;
  name: string;
  /** One sentence that says why this algorithm has this length. */
  fact: string;
  /** The document that defines the algorithm. */
  source: string;
}

const LENGTH_ONLY = 'Length only: nothing in the string says which algorithm made it.';
const FIPS180 = 'FIPS 180-4';
const FIPS202 = 'FIPS 202';
const RFC7693 = 'RFC 7693';
const NLMP = 'Microsoft MS-NLMP section 3.3.1 (NTLM v1 authentication)';

function spec(id: string, name: string, bits: number, source: string, extra = ''): DigestSpec {
  return {
    id,
    name,
    fact: `${name} is a ${bits}-bit digest, written as ${bits / 4} hexadecimal characters.${extra}`,
    source,
  };
}

/** Hexadecimal digests by the number of characters, each list in the order of the table. */
const HEX_DIGESTS: readonly (readonly [number, readonly DigestSpec[]])[] = [
  [
    8,
    [
      {
        id: 'crc32',
        name: 'CRC-32',
        fact: 'CRC-32 is a 32-bit checksum, written as 8 hexadecimal characters. It detects changes and is not a password hash.',
        source: 'RFC 1952 (the CRC-32 in the gzip trailer)',
      },
      {
        id: 'adler32',
        name: 'Adler-32',
        fact: 'Adler-32 is a 32-bit checksum, written as 8 hexadecimal characters. It detects changes and is not a password hash.',
        source: 'RFC 1950 (the ADLER32 checksum of the zlib format)',
      },
    ],
  ],
  // 16 hexadecimal characters are listed by the framework rules (MySQL before 4.1 and Oracle 10g), which sit before this table.
  [
    32,
    [
      spec('md5', 'MD5', 128, 'RFC 1321'),
      {
        id: 'ntlm',
        name: 'NTLM (NT hash)',
        fact: 'The NT hash is the MD4 digest of the UTF-16 little-endian password: 128 bits, written as 32 hexadecimal characters.',
        source: `${NLMP}: NTOWFv1 is MD4(UNICODE(Passwd))`,
      },
      spec('md4', 'MD4', 128, 'RFC 1320'),
      {
        id: 'lm',
        name: 'LM hash',
        fact: 'The LM hash is 128 bits (two 64-bit DES results), written as 32 hexadecimal characters, normally in upper case.',
        source: `${NLMP}: LMOWFv1 is two DES results`,
      },
      spec('md2', 'MD2', 128, 'RFC 1319'),
      spec('ripemd128', 'RIPEMD-128', 128, 'ISO/IEC 10118-3 (RIPEMD-128)'),
    ],
  ],
  [40, [spec('sha1', 'SHA-1', 160, FIPS180), spec('ripemd160', 'RIPEMD-160', 160, 'ISO/IEC 10118-3 (RIPEMD-160)')]],
  [
    56,
    [
      spec('sha224', 'SHA-224', 224, FIPS180),
      spec('sha3-224', 'SHA3-224', 224, FIPS202),
      spec('sha512-224', 'SHA-512/224', 224, FIPS180),
    ],
  ],
  [
    64,
    [
      spec('sha256', 'SHA-256', 256, FIPS180),
      spec('sha3-256', 'SHA3-256', 256, FIPS202),
      spec(
        'keccak256',
        'Keccak-256',
        256,
        'The Keccak team, Keccak specifications (the original padding, as Ethereum uses it)',
        ' It differs from SHA3-256 by its padding.',
      ),
      spec('blake2s', 'BLAKE2s-256', 256, RFC7693),
      spec('blake3', 'BLAKE3', 256, 'The BLAKE3 specification', ' This is its default output length.'),
      spec('sha512-256', 'SHA-512/256', 256, FIPS180),
    ],
  ],
  [96, [spec('sha384', 'SHA-384', 384, FIPS180), spec('sha3-384', 'SHA3-384', 384, FIPS202)]],
  [
    128,
    [
      spec('sha512', 'SHA-512', 512, FIPS180),
      spec('sha3-512', 'SHA3-512', 512, FIPS202),
      spec('blake2b', 'BLAKE2b-512', 512, RFC7693),
      spec('whirlpool', 'Whirlpool', 512, 'ISO/IEC 10118-3 (Whirlpool)'),
    ],
  ],
];

function hexRules(): HashRule[] {
  const rules: HashRule[] = [];
  for (const [length, specs] of HEX_DIGESTS) {
    for (const s of specs) {
      rules.push(
        rule(s.id, s.name, 3, s.source, (line) => {
          if (line.length !== length || !only(line, HEX)) return null;
          return `${s.fact} ${LENGTH_ONLY}${upperNote(line)}`;
        }),
      );
    }
  }
  return rules;
}

/**
 * A digest of `bytes` bytes written in Base64 (RFC 4648 section 4) or Base64url (section 5), with its padding or without it:
 * 16 bytes are 22 characters unpadded or 24 with two equals signs, 20 bytes 27 or 28 with one, 32 bytes 43 or 44 with one,
 * 64 bytes 86 or 88 with two.
 */
function base64Rule(id: string, name: string, bytes: number, source: string): HashRule {
  const unpadded = Math.ceil((bytes * 4) / 3);
  const padded = 4 * Math.ceil(bytes / 3);
  return rule(id, `${name} digest in Base64`, 3, `${SRC.rfc4648}; ${source}`, (line) => {
    const n = line.length;
    if (n !== unpadded && n !== padded) return null;
    // Padding is counted by a loop that walks back from the end, never by a pattern anchored to the end.
    const pads = countTrailing(line, '=');
    if (pads !== (n === padded ? padded - unpadded : 0)) return null;
    const core = n - pads;
    const url = !only(line, BASE64, 0, core);
    if (url && !only(line, BASE64_URL, 0, core)) return null;
    return `${n} Base64${url ? 'url' : ''} characters ${pads > 0 ? `with ${pads} padding sign${pads === 1 ? '' : 's'}` : 'without padding'} are the Base64 of a ${bytes}-byte value, the size of ${name}. ${LENGTH_ONLY}`;
  });
}

/** The length rules, in the order of the rule table. */
export const DIGEST_RULES: readonly HashRule[] = [
  ...hexRules(),
  base64Rule('b64-md5', 'MD5', 16, 'RFC 1321'),
  base64Rule('b64-sha1', 'SHA-1', 20, FIPS180),
  base64Rule('b64-sha256', 'SHA-256', 32, FIPS180),
  base64Rule('b64-sha512', 'SHA-512', 64, FIPS180),
];
