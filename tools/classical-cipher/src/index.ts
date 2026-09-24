import meta from './meta.json';

export { meta };

export type CipherName = 'caesar' | 'rot13' | 'rot47' | 'atbash' | 'vigenere';

export interface CipherDescriptor {
  id: CipherName;
  label: string;
  /** Does this cipher take a numeric shift? Only Caesar. */
  hasShift: boolean;
  /** Does this cipher take a text key? Only Vigenere. */
  hasKey: boolean;
  note: string;
}

/** Five named ciphers. This is a workbench for exactly these five, not a cipher framework. */
export const CIPHERS: CipherDescriptor[] = [
  {
    id: 'caesar',
    label: 'Caesar',
    hasShift: true,
    hasKey: false,
    note: 'Shifts each letter by a fixed amount within its own case.',
  },
  {
    id: 'rot13',
    label: 'ROT13',
    hasShift: false,
    hasKey: false,
    note: 'Caesar with a fixed shift of thirteen. Its own inverse: applying it twice returns the original.',
  },
  {
    id: 'rot47',
    label: 'ROT47',
    hasShift: false,
    hasKey: false,
    note: 'Rotates the ninety-four printable ASCII characters from ! to ~ by forty-seven. Its own inverse.',
  },
  {
    id: 'atbash',
    label: 'Atbash',
    hasShift: false,
    hasKey: false,
    note: 'Mirrors each letter to the opposite end of the alphabet within its own case. Its own inverse.',
  },
  {
    id: 'vigenere',
    label: 'Vigenere',
    hasShift: false,
    hasKey: true,
    note: 'Repeats a text key across the message, shifting each letter by its matching key letter.',
  },
];

export interface CipherOptions {
  cipher: CipherName;
  /** Caesar only. Default 3. */
  shift?: number;
  /** Vigenere only. Must contain at least one letter. */
  key?: string;
}

export class ClassicalCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassicalCipherError';
  }
}

const A_UPPER = 65; // 'A'
const A_LOWER = 97; // 'a'

/** Shifts one letter within its own case by `amount` positions, wrapping around the 26-letter alphabet. Non-letters pass through unchanged. */
function shiftLetter(ch: string, amount: number): string {
  const code = ch.charCodeAt(0);
  if (code >= A_UPPER && code <= A_UPPER + 25) {
    return String.fromCharCode(((((code - A_UPPER + amount) % 26) + 26) % 26) + A_UPPER);
  }
  if (code >= A_LOWER && code <= A_LOWER + 25) {
    return String.fromCharCode(((((code - A_LOWER + amount) % 26) + 26) % 26) + A_LOWER);
  }
  return ch;
}

function caesar(text: string, shift: number): string {
  return Array.from(text)
    .map((ch) => shiftLetter(ch, shift))
    .join('');
}

// ROT47's range: the ninety-four printable ASCII characters from the
// exclamation mark (33) through the tilde (126) inclusive. Forty-seven is
// exactly half of ninety-four, which is why rotating by it twice returns
// the original -- the same reason ROT13 is its own inverse over 26 letters.
const ROT47_LOW = 33; // '!'
const ROT47_HIGH = 126; // '~'
const ROT47_SPAN = 94; // 126 - 33 + 1
const ROT47_SHIFT = 47; // exactly half of 94

function rot47(text: string): string {
  return Array.from(text)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < ROT47_LOW || code > ROT47_HIGH) return ch;
      return String.fromCharCode(ROT47_LOW + ((code - ROT47_LOW + ROT47_SHIFT) % ROT47_SPAN));
    })
    .join('');
}

function atbash(text: string): string {
  return Array.from(text)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= A_UPPER && code <= A_UPPER + 25) return String.fromCharCode(A_UPPER + (25 - (code - A_UPPER)));
      if (code >= A_LOWER && code <= A_LOWER + 25) return String.fromCharCode(A_LOWER + (25 - (code - A_LOWER)));
      return ch;
    })
    .join('');
}

/** Letter-only shift amounts from a Vigenere key. A non-letter in the key is ignored before use. */
function vigenereKeyShifts(key: string): number[] {
  const shifts: number[] = [];
  for (const ch of key) {
    const code = ch.charCodeAt(0);
    if (code >= A_UPPER && code <= A_UPPER + 25) shifts.push(code - A_UPPER);
    else if (code >= A_LOWER && code <= A_LOWER + 25) shifts.push(code - A_LOWER);
  }
  return shifts;
}

function vigenere(text: string, key: string, direction: 1 | -1): string {
  const shifts = vigenereKeyShifts(key);
  if (shifts.length === 0) {
    throw new ClassicalCipherError('The Vigenere key needs at least one letter.');
  }
  let keyIndex = 0;
  return Array.from(text)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      const isLetter = (code >= A_UPPER && code <= A_UPPER + 25) || (code >= A_LOWER && code <= A_LOWER + 25);
      // Non-letters are copied through and do not advance the key position.
      if (!isLetter) return ch;
      const amount = direction * shifts[keyIndex % shifts.length]!;
      keyIndex++;
      return shiftLetter(ch, amount);
    })
    .join('');
}

function apply(text: string, options: CipherOptions, direction: 1 | -1): string {
  const { cipher, shift = 3, key = '' } = options;
  switch (cipher) {
    case 'caesar':
      return caesar(text, direction * shift);
    case 'rot13':
      // Caesar shift 13 is its own inverse: +13 twice is +26, which is identity mod 26.
      return caesar(text, direction * 13);
    case 'rot47':
      // Self-inverse regardless of direction; see the comment above ROT47_SHIFT.
      return rot47(text);
    case 'atbash':
      // Self-inverse regardless of direction: mirroring twice returns the original position.
      return atbash(text);
    case 'vigenere':
      return vigenere(text, key, direction);
    default: {
      const exhaustive: never = cipher;
      throw new ClassicalCipherError(`Unknown cipher: ${String(exhaustive)}`);
    }
  }
}

export function encipher(text: string, options: CipherOptions): string {
  return apply(text, options, 1);
}

export function decipher(text: string, options: CipherOptions): string {
  return apply(text, options, -1);
}
