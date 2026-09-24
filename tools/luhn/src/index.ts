import meta from './meta.json';

export { meta };

export class LuhnError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'LuhnError';
    this.position = position;
  }
}

export interface IssuerMatch {
  id: string;
  label: string;
}

interface IssuerRange {
  id: string;
  label: string;
  note: string;
  /** Same-width min/max strings, compared lexicographically -- which is
   * the same as numeric order for two digit strings of equal length. */
  prefixRanges: { min: string; max: string }[];
  lengths: number[];
}

/**
 * This project's own compilation from publicly published issuer
 * identification number references, snapshotted 2026-09-24. Four families
 * are required by the plan this tool was built from, each cited below; a
 * fifth (China UnionPay) is included because Discover's own 622126-622925
 * range is explicitly co-branded with it, which is what the "overlapping
 * range" behaviour below demonstrates on real published data rather than
 * a fabricated example.
 */
export const ISSUERS: Array<IssuerRange> = [
  {
    id: 'visa',
    label: 'Visa',
    // Issuer publication: Visa numbers begin with 4, lengths 13, 16 or 19.
    note: 'Begins with 4.',
    prefixRanges: [{ min: '4', max: '4' }],
    lengths: [13, 16, 19],
  },
  {
    id: 'mastercard',
    label: 'Mastercard',
    // 51-55: issuer publication. 222100-272099: Mastercard's own 2-series
    // BIN impact checklist --
    // https://www.mastercard.us/content/dam/mccom/en-us/documents/issuer-2-series-BIN-impact-checklist-aug-2016.pdf
    note: 'Begins 51-55, or the 2-series range 222100-272099.',
    prefixRanges: [
      { min: '51', max: '55' },
      { min: '222100', max: '272099' },
    ],
    lengths: [16],
  },
  {
    id: 'amex',
    label: 'American Express',
    // Issuer publication: American Express numbers begin 34 or 37, length 15.
    note: 'Begins 34 or 37.',
    prefixRanges: [
      { min: '34', max: '34' },
      { min: '37', max: '37' },
    ],
    lengths: [15],
  },
  {
    id: 'discover',
    label: 'Discover',
    // 6011, 644-649, 65: Thredd's Discover product documentation --
    // https://docs.thredd.com/product_sheets/Discover_Product_Sheet.pdf
    // 622126-622925: the same document, and independently confirmed as
    // a China UnionPay co-branded range by
    // en.wikipedia.org/wiki/Payment_card_number ("Discover Card" row).
    note: 'Begins 6011, 622126-622925, 644-649, or 65.',
    prefixRanges: [
      { min: '6011', max: '6011' },
      { min: '622126', max: '622925' },
      { min: '644', max: '649' },
      { min: '65', max: '65' },
    ],
    lengths: [16, 19],
  },
  {
    id: 'unionpay',
    label: 'China UnionPay',
    // en.wikipedia.org/wiki/Payment_card_number, "China UnionPay" row: 62,
    // active, length 16-19. The same source's "Discover Card" row notes
    // 622126-622925 is shared with this range -- the overlap this tool's
    // all-matches contract exists to report.
    note: 'Begins 62. Overlaps Discover in the 622126-622925 sub-range.',
    prefixRanges: [{ min: '62', max: '62' }],
    lengths: [16, 17, 18, 19],
  },
];

interface DigitsInfo {
  digits: string;
  strippedCount: number;
}

/** Strips spaces and hyphens, validates everything else is a digit, and
 * enforces a minimum digit count with a message naming why. */
function parseDigits(input: string, minDigits: number): DigitsInfo {
  const trimmed = input.trim();
  let digits = '';
  let strippedCount = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch >= '0' && ch <= '9') {
      digits += ch;
      continue;
    }
    if (ch === ' ' || ch === '-') {
      strippedCount++;
      continue;
    }
    throw new LuhnError(`"${ch}" is not a digit or a recognised separator (space or hyphen).`, i);
  }
  if (digits.length < minDigits) {
    throw new LuhnError(
      minDigits === 2
        ? 'At least two digits are required; there is nothing to check with fewer.'
        : `At least ${minDigits} digit${minDigits === 1 ? '' : 's'} required.`,
    );
  }
  return { digits, strippedCount };
}

/** The Luhn walk: from the right, double every second digit, subtracting
 * nine from anything over nine, then sum everything. checkDigit and
 * isValid both funnel through this one implementation. */
function luhnSum(digits: string): number {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum;
}

export function isValid(input: string): boolean {
  const { digits } = parseDigits(input, 2);
  return luhnSum(digits) % 10 === 0;
}

export function checkDigit(input: string): string {
  const { digits } = parseDigits(input, 1);
  // Append a placeholder digit position, sum as if it were there, then
  // solve for the digit that makes the total a multiple of ten.
  const sum = luhnSum(digits + '0');
  return String((10 - (sum % 10)) % 10);
}

function prefixInRange(digits: string, range: { min: string; max: string }): boolean {
  const width = range.min.length;
  if (digits.length < width) return false;
  const prefix = digits.slice(0, width);
  return prefix >= range.min && prefix <= range.max;
}

export function identify(input: string): IssuerMatch[] {
  const { digits } = parseDigits(input, 2);
  const matches: IssuerMatch[] = [];
  for (const issuer of ISSUERS) {
    if (!issuer.lengths.includes(digits.length)) continue;
    if (!issuer.prefixRanges.some((r) => prefixInRange(digits, r))) continue;
    matches.push({ id: issuer.id, label: issuer.label });
  }
  return matches;
}
