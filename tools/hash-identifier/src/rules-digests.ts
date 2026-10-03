import { rule, type HashRule } from './rule';
import { HEX, HEX_LOWER, HEX_UPPER, only } from './scan';

/**
 * Rules for raw digests, which can only be told apart by length. A string that is exactly n hexadecimal characters lists
 * every algorithm of that length and nothing of the neighbouring lengths, in the order they are most often met. That order
 * is an editorial ranking and not a probability: the table below is where to change it.
 */

interface DigestSpec {
  id: string;
  name: string;
  /** One sentence that says why this algorithm has this length, with its document. */
  fact: string;
  source: string;
}

const LENGTH_ONLY = 'Length only: nothing in the string says which algorithm made it.';

/** Hexadecimal digests by the number of characters, each list in the order of the table. */
const HEX_DIGESTS: readonly (readonly [number, readonly DigestSpec[]])[] = [
  [
    32,
    [
      {
        id: 'md5',
        name: 'MD5',
        fact: 'MD5 is a 128-bit digest, written as 32 hexadecimal characters.',
        source: 'RFC 1321',
      },
      {
        id: 'ntlm',
        name: 'NTLM (NT hash)',
        fact: 'The NT hash is the MD4 digest of the UTF-16 little-endian password: 128 bits, written as 32 hexadecimal characters.',
        source: 'Microsoft MS-NLMP (NTOWFv1)',
      },
      {
        id: 'md4',
        name: 'MD4',
        fact: 'MD4 is a 128-bit digest, written as 32 hexadecimal characters.',
        source: 'RFC 1320',
      },
      {
        id: 'lm',
        name: 'LM hash',
        fact: 'The LM hash is 128 bits (two 64-bit DES results), written as 32 hexadecimal characters, normally in upper case.',
        source: 'Microsoft MS-NLMP (LMOWFv1)',
      },
      {
        id: 'md2',
        name: 'MD2',
        fact: 'MD2 is a 128-bit digest, written as 32 hexadecimal characters.',
        source: 'RFC 1319',
      },
      {
        id: 'ripemd128',
        name: 'RIPEMD-128',
        fact: 'RIPEMD-128 is a 128-bit digest, written as 32 hexadecimal characters.',
        source: 'ISO/IEC 10118-3',
      },
    ],
  ],
];

function digestRules(): HashRule[] {
  const rules: HashRule[] = [];
  for (const [length, specs] of HEX_DIGESTS) {
    for (const spec of specs) {
      rules.push(
        rule(spec.id, spec.name, 3, spec.source, (line) => {
          if (line.length !== length || !only(line, HEX)) return null;
          const upper =
            !only(line, HEX_LOWER) && only(line, HEX_UPPER)
              ? ' The digits are upper case, which does not change the value.'
              : '';
          return `${spec.fact} ${LENGTH_ONLY}${upper}`;
        }),
      );
    }
  }
  return rules;
}

/** The length rules, in the order of the rule table. */
export const DIGEST_RULES: readonly HashRule[] = digestRules();
