import { formatUtc } from './dates';

/** One row of the DKIM-Signature table: a tag, its value as read, what it means, and a note about it. */
export interface DkimTagRow {
  tag: string;
  value: string;
  meaning: string;
  note: string;
}

/** A DKIM-Signature header field read as claims: nothing here is checked against a key, a body or a name server. */
export interface DkimSignature {
  /** False when the text is not a tag list as RFC 6376 section 3.2 defines it, or a tag name is repeated. */
  wellFormed: boolean;
  tags: DkimTagRow[];
  /** The d tag as written, or an empty string. */
  domain: string;
  /** The s tag as written, or an empty string. */
  selector: string;
  /** The i tag, decoded, or an empty string. */
  identity: string;
  /** The DNS name a reader would ask for the key, as text only: `<s>._domainkey.<d>`. Nothing is looked up. */
  lookupName: string;
  /** How the signing domain and the From domain compare, in words that say it is approximate. Empty without a From domain. */
  alignment: string;
  /** The header names the h tag lists, in lower case, in order. */
  headersSigned: string[];
  /** True or false when the h tag is present, null when it is not. */
  fromSigned: boolean | null;
  /** What breaks an RFC 6376 rule, each as a plain sentence. Empty when nothing does. */
  issues: string[];
}

/** The result of reading a tag list. */
export interface TagList {
  /** Each tag-spec in order, as [name, value]. A repeated name appears each time. */
  entries: [string, string][];
  wellFormed: boolean;
  /** Names that occur more than once. */
  repeated: string[];
  /** True when there were more tag-specs than are read. */
  cut: boolean;
}

/** The most tag-specs read from one tag list. */
const MAX_TAGS = 200;

function isWhiteCode(code: number): boolean {
  return code === 32 || code === 9 || code === 13 || code === 10;
}

/** Removes space, tab, CR and LF from both ends. */
function trimWhite(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isWhiteCode(text.charCodeAt(start))) start++;
  while (end > start && isWhiteCode(text.charCodeAt(end - 1))) end--;
  return start === 0 && end === text.length ? text : text.slice(start, end);
}

/** Removes every space, tab, CR and LF. */
function removeWhite(text: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (isWhiteCode(text.charCodeAt(i))) {
      out += text.slice(from, i);
      from = i + 1;
    }
  }
  return out + text.slice(from);
}

/** RFC 6376 section 3.2: tag-name = ALPHA *ALNUMPUNC, where ALNUMPUNC is a letter, a digit or an underscore. */
function isTagName(name: string): boolean {
  if (name === '') return false;
  const first = name.charCodeAt(0);
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) return false;
  for (let i = 1; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;
    if (!ok) return false;
  }
  return true;
}

/**
 * Reads a tag list (RFC 6376 section 3.2): tag-specs separated by semicolons, one optional trailing semicolon, white space
 * allowed around each name and value. A tag name that is not a name, a tag-spec with no equals sign and an empty tag-spec
 * between two semicolons make it not well formed; so does a name that occurs more than once, as the RFC says. Names are
 * case sensitive. Names are kept in a Map while counting, never as keys of an object.
 */
export function parseTagList(value: string): TagList {
  const entries: [string, string][] = [];
  const counts = new Map<string, number>();
  let wellFormed = true;
  let cut = false;
  const n = value.length;
  let start = 0;
  while (start <= n) {
    let end = value.indexOf(';', start);
    const last = end < 0;
    if (last) end = n;
    const piece = trimWhite(value.slice(start, end));
    if (piece === '') {
      // Only the one after the final semicolon may be empty.
      if (!last || (start === 0 && entries.length === 0)) wellFormed = false;
    } else {
      const equals = piece.indexOf('=');
      const name = equals < 0 ? '' : trimWhite(piece.slice(0, equals));
      if (!isTagName(name)) {
        wellFormed = false;
      } else if (entries.length >= MAX_TAGS) {
        cut = true;
      } else {
        entries.push([name, trimWhite(piece.slice(equals + 1))]);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    if (last) break;
    start = end + 1;
  }
  const repeated: string[] = [];
  for (const [name, count] of counts) if (count > 1) repeated.push(name);
  if (repeated.length > 0) wellFormed = false;
  return { entries, wellFormed, repeated, cut };
}

function hexValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

/** RFC 6376 section 2.11: =XX with two upper case hexadecimal digits is that byte; white space is removed first. */
function decodeQuotedPrintable(text: string): string {
  const compact = removeWhite(text);
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  let literalFrom = 0;
  const flushLiteral = (end: number): void => {
    if (end > literalFrom) for (const byte of encoder.encode(compact.slice(literalFrom, end))) bytes.push(byte);
  };
  let i = 0;
  while (i < compact.length) {
    if (compact.charCodeAt(i) === 61 && i + 2 < compact.length) {
      const high = hexValue(compact.charCodeAt(i + 1));
      const low = hexValue(compact.charCodeAt(i + 2));
      if (high >= 0 && low >= 0) {
        flushLiteral(i);
        bytes.push(high * 16 + low);
        i += 3;
        literalFrom = i;
        continue;
      }
    }
    i++;
  }
  flushLiteral(compact.length);
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

const MEANINGS: ReadonlyMap<string, string> = new Map([
  ['v', 'The version of the signature format. RFC 6376 says it must be 1.'],
  ['a', 'The signing algorithm.'],
  ['b', 'The signature itself, in Base64. White space inside it is ignored.'],
  ['bh', 'The hash of the signed part of the body, in Base64. White space inside it is ignored.'],
  ['c', 'How the headers and the body are normalised before they are signed (headers/body).'],
  ['d', 'The signing domain, which with the selector names the key.'],
  ['h', 'The header fields the signature covers, in order.'],
  ['i', 'The signing identity, a user or agent on whose behalf the domain signs.'],
  ['l', 'How many bytes of the body are covered.'],
  ['q', 'How to look up the key.'],
  ['s', 'The selector, which with the signing domain names the key.'],
  ['t', 'When the signature was made.'],
  ['x', 'When the signature expires.'],
  ['z', 'Copies of the signed headers as they were when the message was signed.'],
]);

const REQUIRED_TAGS: readonly string[] = ['v', 'a', 'b', 'bh', 'd', 'h', 's'];

const BASE64 = /^[A-Za-z0-9+/=]*$/;

function describeAlgorithm(value: string): string {
  switch (value) {
    case 'rsa-sha256':
      return 'RSA with SHA-256.';
    case 'rsa-sha1':
      return 'RSA with SHA-1. RFC 8301 says signers must not use it.';
    case 'ed25519-sha256':
      return 'Ed25519 with SHA-256 (RFC 8463).';
    default:
      return 'An algorithm this page does not describe.';
  }
}

function describeCanonical(value: string): string {
  const slash = value.indexOf('/');
  const header = slash < 0 ? value : value.slice(0, slash);
  const body = slash < 0 ? 'simple' : value.slice(slash + 1);
  return `Headers are normalised as ${header === '' ? 'simple' : header} and the body as ${body === '' ? 'simple' : body}.`;
}

/** Whether `child` is `parent` or a name under it, compared in lower case on whole labels. */
function inDomain(child: string, parent: string): boolean {
  return child === parent || child.endsWith(`.${parent}`);
}

/**
 * Reads a DKIM-Signature header field value as RFC 6376 describes it and lists, tag by tag, what each says and what breaks
 * a rule. Tag names are case sensitive, a repeated tag makes the whole tag list invalid, unknown tags are ignored, x must
 * be greater than t, the domain of i must be d or under it, From must be in h, b and bh are read with white space removed,
 * i and z are dkim-quoted-printable and are decoded. The key lookup name is shown as text and nothing is looked up. No body
 * hash is computed and no signature is checked: that needs the key and DNS. `fromDomain` is the domain of the From address,
 * for the alignment words, which are approximate because no public suffix list is consulted; `messageDateMs` is the
 * message's own Date.
 */
export function parseDkimSignature(
  value: string,
  fromDomain: string = '',
  messageDateMs: number | null = null,
): DkimSignature {
  const list = parseTagList(value);
  const issues: string[] = [];
  const tags: DkimTagRow[] = [];
  const first = new Map<string, string>();
  for (const [name, raw] of list.entries) if (!first.has(name)) first.set(name, raw);

  if (list.entries.length === 0 && !list.wellFormed) {
    issues.push('This is not a tag list as RFC 6376 section 3.2 defines it, so it cannot be read as a signature.');
  } else if (!list.wellFormed && list.repeated.length === 0) {
    issues.push(
      'This is not a tag list as RFC 6376 section 3.2 defines it: a tag has no name or no equals sign, or a tag is empty.',
    );
  }
  for (const name of list.repeated) {
    issues.push(`The tag ${name} appears more than once, so RFC 6376 section 3.2 says the whole tag list is invalid.`);
  }
  if (list.cut) issues.push('The signature has more than 200 tags, so the rest were not read.');

  const timeNote = (raw: string): string => {
    if (!/^[0-9]+$/.test(raw)) return 'This is not a number of seconds.';
    if (raw.length > 12) {
      return 'This has more than 12 digits; RFC 6376 section 3.5 lets a reader treat such a value as no time at all.';
    }
    const seconds = Number(raw);
    if (seconds > 253_402_300_799) return 'This time is after the year 9999, so it is not shown as a date.';
    return `${formatUtc(seconds * 1000)} UTC`;
  };

  for (const [name, raw] of list.entries) {
    let displayValue = raw;
    let note = '';
    switch (name) {
      case 'b':
      case 'bh':
        displayValue = removeWhite(raw);
        if (!BASE64.test(displayValue)) {
          note = 'This is not Base64: it has characters outside A to Z, a to z, 0 to 9, +, / and =.';
        }
        break;
      case 'a':
        note = describeAlgorithm(raw);
        break;
      case 'c':
        note = describeCanonical(raw);
        break;
      case 't':
      case 'x':
        note = timeNote(raw);
        break;
      case 'i': {
        const decoded = decodeQuotedPrintable(raw);
        note = decoded === raw ? '' : `Decoded: ${decoded}`;
        break;
      }
      case 'z':
        note = `Decoded: ${decodeQuotedPrintable(raw)
          .split('|')
          .map((part) => part.trim())
          .join(' | ')}`;
        break;
      case 'l':
        note = /^[0-9]+$/.test(raw)
          ? `Only the first ${raw} bytes of the body are covered; anything added after them is not.`
          : 'This is not a number.';
        break;
      case 'q':
        note = raw === 'dns/txt' ? 'The key is looked up in DNS, which this page does not do.' : '';
        break;
      case 'v':
        note = raw === '1' ? '' : 'RFC 6376 says the version must be 1.';
        break;
      default:
        break;
    }
    const known = MEANINGS.get(name);
    if (known === undefined) {
      tags.push({
        tag: name,
        value: displayValue,
        meaning: 'A tag RFC 6376 does not define.',
        note: 'Unknown tags are ignored (RFC 6376 section 3.2).',
      });
    } else {
      tags.push({ tag: name, value: displayValue, meaning: known, note });
    }
  }

  const get = (name: string): string | undefined => first.get(name);
  const domain = get('d') ?? '';
  const selector = get('s') ?? '';
  const identityRaw = get('i');
  const identity = identityRaw === undefined ? '' : decodeQuotedPrintable(identityRaw);

  if (list.wellFormed) {
    for (const required of REQUIRED_TAGS) {
      if (!first.has(required)) issues.push(`The required tag ${required} is missing (RFC 6376 section 3.5).`);
    }
    const version = get('v');
    if (version !== undefined && version !== '1')
      issues.push('v is not 1, so this is not the version RFC 6376 describes.');
  }

  const t = get('t');
  const x = get('x');
  if (t !== undefined && x !== undefined && /^[0-9]{1,12}$/.test(t) && /^[0-9]{1,12}$/.test(x)) {
    if (!(Number(x) > Number(t))) {
      issues.push('x is not greater than t, but RFC 6376 section 3.5 says it must be.');
    }
  }
  if (x !== undefined && /^[0-9]{1,12}$/.test(x) && messageDateMs !== null && Number(x) * 1000 < messageDateMs) {
    issues.push(
      "x is before the message's own Date, so the signature had already expired when the message says it was written.",
    );
  }
  if (identityRaw !== undefined && domain !== '') {
    const at = identity.lastIndexOf('@');
    const identityDomain = at < 0 ? '' : identity.slice(at + 1).toLowerCase();
    if (!inDomain(identityDomain, domain.toLowerCase())) {
      issues.push('i is not in d: RFC 6376 section 3.5 says the domain of i must be d or a subdomain of it.');
    }
  }

  const h = get('h');
  const headersSigned: string[] = [];
  if (h !== undefined) {
    for (const part of h.split(':')) {
      const name = trimWhite(part).toLowerCase();
      if (name !== '') headersSigned.push(name);
    }
  }
  const fromSigned = h === undefined ? null : headersSigned.includes('from');
  if (fromSigned === false) {
    issues.push('h does not list From, but RFC 6376 section 5.4 says the From header must be signed.');
  }

  let alignment = '';
  const wanted = fromDomain.toLowerCase();
  const signing = domain.toLowerCase();
  if (wanted !== '' && signing !== '') {
    if (wanted === signing) {
      alignment = 'The signing domain is the same as the From domain, which is what strict alignment asks for.';
    } else if (inDomain(wanted, signing) || inDomain(signing, wanted)) {
      alignment =
        'The signing domain and the From domain are related by a subdomain, which relaxed alignment would accept. This is approximate: no public suffix list is consulted.';
    } else {
      alignment =
        'The signing domain and the From domain differ, so neither strict nor relaxed alignment would be met.';
    }
  }

  return {
    wellFormed: list.wellFormed,
    tags,
    domain,
    selector,
    identity,
    lookupName: domain !== '' && selector !== '' ? `${selector}._domainkey.${domain}` : '',
    alignment,
    headersSigned,
    fromSigned,
    issues,
  };
}
