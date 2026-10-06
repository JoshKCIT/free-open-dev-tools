import { checkRecordLength } from './limits';

/**
 * What the tags table says about one tag: `ok` (read and valid), `default-used` (not in the record, so its default applies),
 * `retired` (a tag RFC 9989 removed), `unknown` (not a tag of RFC 9989, so ignored), `invalid` (its value is wrong, so it is
 * ignored and the default applies) or `repeated` (a second or later copy of a tag, ignored because the first value is used).
 */
export type DmarcStatus = 'ok' | 'default-used' | 'retired' | 'unknown' | 'invalid' | 'repeated';

/** One reporting address of a rua or ruf tag. */
export interface DmarcUri {
  /** The address as written, without the blanks around it. */
  text: string;
  /** The scheme in lower case, or null when there is none. */
  scheme: string | null;
  kind: 'mailto' | 'other' | 'invalid';
  /** For a mailto address: the mailbox (the part before any ?), as written. */
  address: string | null;
  /** For a mailto address: the domain of the mailbox in lower case. */
  host: string | null;
  /** The obsolete report size suffix, such as !10m, or null (RFC 9989 sections 4.8 and C.4). */
  obsoleteSize: string | null;
  /** A fixed sentence when the address is not usable, else null. Never holds typed text. */
  problem: string | null;
}

export interface DmarcTag {
  /** The tag name as written. */
  name: string;
  /** The value as written, or null for a tag that is not in the record. */
  value: string | null;
  status: DmarcStatus;
  /** What the tag does with this value, in a fixed sentence. */
  meaning: string;
  /** The default shown in the Default column (RFC 9989 section 4.7), or an empty string for a tag with none. */
  default: string;
  /** The 1-based character where the tag starts in the record, or 0 for a tag that is not in the record. */
  position: number;
  /** The addresses of a rua or ruf tag in order, else an empty list. */
  uris: DmarcUri[];
  /** A fixed sentence saying what is wrong, else null. Never holds typed text. */
  problem: string | null;
}

export interface DmarcRecord {
  text: string;
  length: number;
  /** True when the text starts with the tag v=DMARC1 (RFC 9989 section 4.7). */
  isDmarc: boolean;
  /** Why the whole record is ignored, or null. */
  ignored: string | null;
  /** The tags in record order, then the tags that are absent in the order of RFC 9989 Table 2. */
  tags: DmarcTag[];
  /** The first copy of each tag of the record, by its name as written. A Map, so no tag name is special. */
  byName: ReadonlyMap<string, DmarcTag>;
  /** Things worth saying about how the record was read. */
  notes: string[];
}

/** The tags of RFC 9989 Table 2, in the order of the table. The version tag v always comes first and is not in the table. */
export const TABLE_2_ORDER: readonly string[] = ['p', 't', 'psd', 'np', 'sp', 'adkim', 'aspf', 'rua', 'ruf', 'fo'];

interface TagInfo {
  /** The default as the Default column shows it. */
  default: string;
  /** What the tag means when it is not in the record. */
  absent: string;
  /** What the tag means for a value (the value is as written). */
  describe: (value: string) => string;
}

function policyWords(value: string): string {
  const v = value.toLowerCase();
  if (v === 'none') return 'no action is requested for mail that fails DMARC (monitoring)';
  if (v === 'quarantine') return 'mail that fails DMARC is treated as suspicious';
  if (v === 'reject') return 'mail that fails DMARC is treated as not valid';
  return 'not one of none, quarantine or reject';
}

function alignment(value: string, what: string): string {
  const v = value.toLowerCase();
  if (v === 'r') return `Relaxed ${what} alignment: the domains only need the same organizational domain.`;
  if (v === 's') return `Strict ${what} alignment: the domains must be identical.`;
  return 'Not r or s.';
}

const TAGS: ReadonlyMap<string, TagInfo> = new Map<string, TagInfo>([
  [
    'v',
    {
      default: '',
      absent: 'Required: a record without v=DMARC1 first is ignored.',
      describe: () => 'Version. It must be the first tag and its only value is DMARC1.',
    },
  ],
  [
    'p',
    {
      default: 'none',
      absent: 'Not in the record, so the record is treated as p=none.',
      describe: (value) => `Policy for the domain itself: ${policyWords(value)}.`,
    },
  ],
  [
    't',
    {
      default: 'n',
      absent: 'Not in the record: the policy is applied as written.',
      describe: (value) =>
        value.toLowerCase() === 'y'
          ? 'Testing: the policy is not applied, and failing mail gets the policy one level below it.'
          : 'Not testing: the policy is applied as written.',
    },
  ],
  [
    'psd',
    {
      default: 'u',
      absent: 'Not in the record: the domain is not marked as a public suffix domain.',
      describe: (value) => {
        const v = value.toLowerCase();
        if (v === 'y') return 'The domain is a public suffix domain (PSD).';
        if (v === 'n') return 'Not a PSD, and it is the organizational domain for itself and its subdomains.';
        return 'Not a PSD, and it may or may not be the organizational domain; the tree walk decides.';
      },
    },
  ],
  [
    'np',
    {
      default: 'sp, then p',
      absent: 'Not in the record: non-existent subdomains follow sp, or p when there is no sp.',
      describe: (value) => `Policy for non-existent subdomains: ${policyWords(value)}.`,
    },
  ],
  [
    'sp',
    {
      default: 'p',
      absent: 'Not in the record: existing subdomains follow p.',
      describe: (value) => `Policy for existing subdomains: ${policyWords(value)}.`,
    },
  ],
  [
    'adkim',
    {
      default: 'r',
      absent: 'Not in the record: relaxed DKIM alignment.',
      describe: (value) => alignment(value, 'DKIM'),
    },
  ],
  [
    'aspf',
    {
      default: 'r',
      absent: 'Not in the record: relaxed SPF alignment.',
      describe: (value) => alignment(value, 'SPF'),
    },
  ],
  [
    'rua',
    {
      default: 'none (no reports requested)',
      absent: 'Not in the record: no aggregate reports are requested.',
      describe: () => 'Where aggregate reports are requested.',
    },
  ],
  [
    'ruf',
    {
      default: 'none (no reports requested)',
      absent: 'Not in the record: no failure reports are requested.',
      describe: () => 'Where failure reports are requested.',
    },
  ],
  [
    'fo',
    {
      default: '0',
      absent: 'Not in the record: a failure report is asked for only when every mechanism fails.',
      describe: () => 'Which failures a failure report is requested for.',
    },
  ],
]);

/** The tags RFC 9989 removed (Appendix C.5.2), with what RFC 7489 used them for. */
const RETIRED: ReadonlyMap<string, string> = new Map<string, string>([
  [
    'pct',
    'The percentage of failing mail the policy applies to in RFC 7489. Retired in RFC 9989: t=y replaces some of it.',
  ],
  ['rf', 'The format of failure reports in RFC 7489. Retired in RFC 9989.'],
  ['ri', 'The interval between aggregate reports in RFC 7489. Retired in RFC 9989.'],
]);

const RETIRED_SUFFIX = ' Receivers that still follow RFC 7489 read it; others ignore it.';

function isWsp(code: number): boolean {
  return code === 32 || code === 9;
}

function isAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** The text between two positions with the blanks (space and tab) taken off both ends. */
function trimmed(text: string, from: number, to: number): { value: string; start: number } {
  let a = from;
  let b = to;
  while (a < b && isWsp(text.charCodeAt(a))) a++;
  while (b > a && isWsp(text.charCodeAt(b - 1))) b--;
  return { value: text.slice(a, b), start: a };
}

/** The obsolete size suffix at the end of an address (an exclamation mark, digits and k, m, g or t), or null. */
function sizeSuffixAt(entry: string): number {
  let j = entry.length;
  if (j > 0 && 'kmgtKMGT'.includes(entry.charAt(j - 1))) j--;
  const digitsEnd = j;
  while (j > 0 && isDigit(entry.charCodeAt(j - 1))) j--;
  if (j === digitsEnd || j === 0 || entry.charCodeAt(j - 1) !== 33) return -1;
  return j - 1;
}

/**
 * Reads the value of a rua or ruf tag: addresses separated by commas with blanks allowed around each comma (RFC 9989
 * section 4.8, dmarc-urilist). Nothing is looked up.
 */
export function parseUriList(value: string): DmarcUri[] {
  const out: DmarcUri[] = [];
  let i = 0;
  const n = value.length;
  while (i <= n) {
    let end = value.indexOf(',', i);
    if (end < 0) end = n;
    const entry = trimmed(value, i, end).value;
    let text = entry;
    let obsoleteSize: string | null = null;
    const bang = sizeSuffixAt(entry);
    if (bang >= 0) {
      obsoleteSize = entry.slice(bang);
      text = entry.slice(0, bang);
    }
    let scheme: string | null = null;
    let k = 0;
    while (
      k < text.length &&
      (isAlpha(text.charCodeAt(k)) || (k > 0 && (isDigit(text.charCodeAt(k)) || '+-.'.includes(text.charAt(k)))))
    )
      k++;
    if (k > 0 && text.charCodeAt(k) === 58) scheme = text.slice(0, k).toLowerCase();
    if (scheme === 'mailto') {
      const rest = text.slice(k + 1);
      const q = rest.indexOf('?');
      const address = q < 0 ? rest : rest.slice(0, q);
      const at = address.lastIndexOf('@');
      out.push({
        text: entry,
        scheme,
        kind: 'mailto',
        address,
        host: at >= 0 ? address.slice(at + 1).toLowerCase() : null,
        obsoleteSize,
        problem: null,
      });
    } else {
      out.push({
        text: entry,
        scheme,
        kind: scheme === null ? 'invalid' : 'other',
        address: null,
        host: null,
        obsoleteSize,
        problem: scheme === null ? 'This is not a URI: it has no scheme such as mailto:.' : null,
      });
    }
    i = end + 1;
    if (end === n) break;
  }
  return out;
}

const IGNORED_NOT_DMARC =
  'This text is not read as a DMARC record: it must start with v=DMARC1 (RFC 9989 section 4.7).';

/**
 * Reads one DMARC record in a single pass. The tags come out in record order, then every tag the record does not hold with
 * its default, in the order of RFC 9989 Table 2. A record that does not start with v=DMARC1 is ignored as a whole.
 */
export function parseDmarc(text: string): DmarcRecord {
  checkRecordLength(text, 'dmarc');
  const record: DmarcRecord = {
    text,
    length: text.length,
    isDmarc: false,
    ignored: null,
    tags: [],
    byName: new Map<string, DmarcTag>(),
    notes: [],
  };
  const byName = record.byName as Map<string, DmarcTag>;
  const n = text.length;
  let i = 0;
  while (i < n && isWsp(text.charCodeAt(i))) i++;
  let element = 0;
  for (;;) {
    let end = text.indexOf(';', i);
    if (end < 0) end = n;
    const { value: part, start } = trimmed(text, i, end);
    const eq = part.indexOf('=');
    const name = eq < 0 ? part : trimmed(part, 0, eq).value;
    const value = eq < 0 ? '' : trimmed(part, eq + 1, part.length).value;
    if (element === 0) {
      if (name !== 'v' || value !== 'DMARC1') {
        record.ignored = IGNORED_NOT_DMARC;
        return record;
      }
      record.isDmarc = true;
    }
    if (part !== '') {
      const info = TAGS.get(name);
      const retired = RETIRED.get(name);
      const tag: DmarcTag = {
        name,
        value,
        status: info !== undefined ? 'ok' : retired !== undefined ? 'retired' : 'unknown',
        meaning:
          info !== undefined
            ? info.describe(value)
            : retired !== undefined
              ? retired + RETIRED_SUFFIX
              : 'Not a tag of RFC 9989, so it is ignored.',
        default: info?.default ?? '',
        position: start + 1,
        uris: name === 'rua' || name === 'ruf' ? parseUriList(value) : [],
        problem: null,
      };
      record.tags.push(tag);
      if (!byName.has(name)) byName.set(name, tag);
    }
    element++;
    if (end === n) break;
    i = end + 1;
  }
  for (const name of TABLE_2_ORDER) {
    const info = TAGS.get(name);
    if (info === undefined || byName.has(name)) continue;
    record.tags.push({
      name,
      value: null,
      status: 'default-used',
      meaning: info.absent,
      default: info.default,
      position: 0,
      uris: [],
      problem: null,
    });
  }
  return record;
}
