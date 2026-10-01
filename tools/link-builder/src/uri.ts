/**
 * Percent-encoding and grammar checks for email links (RFC 6068), phone links (RFC 3966) and text message links
 * (RFC 5724).
 *
 * - RFC 3986 section 2.3: letters, digits and - . _ ~ never need encoding; every other character is written as the
 *   percent sign and the two uppercase hexadecimal digits of each UTF-8 byte (RFC 6068 section 2, point 4 and 5).
 * - RFC 6068 section 5: a line break in the body is encoded as a carriage return and line feed, and a line break in any
 *   other header field is never written, so a typed value cannot start a new header.
 * - RFC 3966 sections 3 and 5: the grammar of a telephone number, with erratum 4376 (a visual separator is one of
 *   - . ( ) and never empty) applied.
 * - RFC 5724 section 2.2: the body of a text message link is escaped-value, everything except unreserved characters
 *   percent-encoded.
 *
 * Pure functions only: no DOM, no clock, no network, no storage. `new URL` is used only to convert a domain to punycode.
 */
import { MarkupError } from './markup';

/** The label each field has on the page; a refusal names the field by this text. */
export const URI_FIELD_LABELS = {
  to: 'To',
  cc: 'Cc',
  bcc: 'Bcc',
  subject: 'Subject',
  body: 'Body',
  phone: 'Phone number',
  ext: 'Extension',
  phoneContext: 'Phone context',
  recipients: 'Recipients',
  smsBody: 'Message',
} as const;

/** More recipients than this across To, Cc and Bcc are refused, so a link stays usable. */
export const MAX_MAILTO_RECIPIENTS = 50;

/** More recipients than this in a text message link are refused. */
export const MAX_SMS_RECIPIENTS = 20;

const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** RFC 6068 section 2 some-delims without the plus sign, which this encoder always writes as an encoded plus. */
const HEADER_KEPT = "!$'(),*;:@";

/** The delimiters kept literal inside the local part and domain of an address (RFC 6068 section 2, point 1). */
const ADDRESS_KEPT = "!$'()*";

function toHex(byte: number): string {
  return '%' + byte.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Writes `text` as UTF-8 bytes, each one percent-encoded with uppercase hex, except the characters `keep` accepts.
 * Iterating by code point keeps a surrogate pair together, so an emoji becomes four bytes.
 */
export function percentEncode(text: string, keep: (ch: string) => boolean): string {
  const encoder = new TextEncoder();
  let out = '';
  for (const ch of text) {
    if (ch.length === 1 && keep(ch)) {
      out += ch;
      continue;
    }
    for (const byte of encoder.encode(ch)) out += toHex(byte);
  }
  return out;
}

/**
 * A header field value or body of an email link (RFC 6068 hfvalue): unreserved characters and the delimiters of
 * section 2 are kept, a plus sign is written as an encoded plus (section 5 allows it, and no handler can then read it as
 * a space), and everything else, including a space, a question mark, an equals sign, an ampersand and a number sign,
 * is percent-encoded.
 */
export function encodeHeaderValue(text: string): string {
  return percentEncode(text, (ch) => UNRESERVED.test(ch) || HEADER_KEPT.includes(ch));
}

/**
 * The local part of an address (RFC 6068 section 2, point 1 and 5): only unreserved characters and ! $ ' ( ) * are kept,
 * so a percent sign, an ampersand, a question mark, a quote, a backslash, a space, an at sign, a number sign, a
 * slash, a bracket, an equals sign and a comma inside a quoted local part are all encoded.
 */
export function encodeLocalPart(text: string): string {
  return percentEncode(text, (ch) => UNRESERVED.test(ch) || ADDRESS_KEPT.includes(ch));
}

/** Line breaks (carriage return and line feed, a lone line feed, a lone carriage return) as the one form given. */
function normalizeBreaks(text: string, to: string): string {
  return text.replace(/\r\n|\r|\n/g, to);
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return false;
  return true;
}

/** Refuses a line break in a field that is a header, naming the field (RFC 6068 section 5). */
function refuseLineBreak(value: string, field: string): void {
  if (/[\r\n]/.test(value)) {
    throw new MarkupError(
      field,
      'a line break here would start a new mail header; only the body may have line breaks (RFC 6068 section 5)',
    );
  }
}

/**
 * The domain of an address. An ASCII domain is kept. A non-ASCII domain is converted to punycode by the URL parser
 * (the default, which RFC 6068 section 2 point 4 recommends), or written as percent-encoded UTF-8 when asked.
 */
function encodeDomain(domain: string, field: string, mode: 'punycode' | 'percent'): string {
  if (isAscii(domain) || mode === 'percent') return encodeLocalPart(domain);
  let host = '';
  if (!/[\s/\\?#:@%[\]]/.test(domain)) {
    try {
      host = new URL('http://' + domain).hostname;
    } catch {
      host = '';
    }
  }
  if (host === '') {
    throw new MarkupError(field, `the domain "${domain}" cannot be converted to punycode, so it is refused`);
  }
  return encodeLocalPart(host);
}

/**
 * One address written for the address part of an email link: split at its last at sign, each side encoded. An address
 * is always written as typed (encoded); whether it is a valid address is for the caller to warn about.
 */
function encodeAddress(address: string, field: string, mode: 'punycode' | 'percent'): string {
  const at = address.lastIndexOf('@');
  if (at === -1) return encodeLocalPart(address);
  return `${encodeLocalPart(address.slice(0, at))}@${encodeDomain(address.slice(at + 1), field, mode)}`;
}

export interface MailtoParts {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
}

export interface MailtoOptions {
  /** How a non-ASCII domain is written: punycode (the default) or the percent-encoded UTF-8 form of RFC 6068 section 6.3. */
  domainEncoding?: 'punycode' | 'percent';
}

/**
 * The address of an email link, as RFC 6068 section 2 writes it, with the ampersands between header fields left bare
 * (the markup writer turns them into entities). Header fields are written once each, in the order cc, bcc, subject,
 * body. A line break in a recipient or the subject is refused; the body's line breaks become an encoded carriage
 * return and line feed.
 */
export function buildMailto(parts: MailtoParts, options: MailtoOptions = {}): string {
  const mode = options.domainEncoding ?? 'punycode';
  const lists: [keyof typeof URI_FIELD_LABELS, string[]][] = [
    ['to', parts.to ?? []],
    ['cc', parts.cc ?? []],
    ['bcc', parts.bcc ?? []],
  ];
  let total = 0;
  const encoded: Record<string, string> = {};
  for (const [key, list] of lists) {
    const label = URI_FIELD_LABELS[key];
    total += list.length;
    if (total > MAX_MAILTO_RECIPIENTS) {
      throw new MarkupError(
        label,
        `more than ${MAX_MAILTO_RECIPIENTS} recipients across To, Cc and Bcc, so it is refused`,
      );
    }
    encoded[key] = list
      .map((address) => {
        refuseLineBreak(address, label);
        return encodeAddress(address, label, mode);
      })
      .join(',');
  }
  const subject = parts.subject ?? '';
  refuseLineBreak(subject, URI_FIELD_LABELS.subject);
  const body = parts.body ?? '';

  const fields: string[] = [];
  if (encoded.cc) fields.push(`cc=${encoded.cc}`);
  if (encoded.bcc) fields.push(`bcc=${encoded.bcc}`);
  if (subject !== '') fields.push(`subject=${encodeHeaderValue(subject)}`);
  if (body !== '') fields.push(`body=${encodeHeaderValue(normalizeBreaks(body, '\r\n'))}`);
  return `mailto:${encoded.to}${fields.length > 0 ? '?' + fields.join('&') : ''}`;
}

// ---- tel (RFC 3966) and sms (RFC 5724) -----------------------------------------------------------------------------

export interface UriResult {
  uri: string;
  /** Things that were changed or that need saying, never refusals. */
  notes: string[];
}

export interface TelOptions {
  /** The extension (RFC 3966 section 5.3): digits and visual separators. */
  ext?: string;
  /** The phone-context a local number needs (RFC 3966 section 5.1.5): a domain name or a global number. */
  phoneContext?: string;
}

const SPACES_NOTE =
  'spaces are not allowed in tel numbers (RFC 3966 section 5.1.1), so each run of spaces became a hyphen';

const DOMAIN_NAME = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)*[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.?$/;

/** A run of spaces becomes one hyphen, and a note says so once. */
function spacesToHyphens(value: string, notes: string[]): string {
  if (!/\s/.test(value)) return value;
  if (!notes.includes(SPACES_NOTE)) notes.push(SPACES_NOTE);
  return value.replace(/\s+/g, '-');
}

/** The digits and visual separators of RFC 3966 (phonedigit with erratum 4376), with at least one digit. */
function isPhoneDigits(value: string): boolean {
  return /^[0-9\-.()]+$/.test(value) && /[0-9]/.test(value);
}

function refuseLetters(value: string, field: string): void {
  if (/[A-Za-z]/.test(value)) {
    throw new MarkupError(
      field,
      'letters are not supported in tel numbers (RFC 3966 section 5.1.2); write each letter as the digit it stands for',
    );
  }
}

/** One telephone-subscriber (RFC 3966 section 3): a global or local number with its extension and phone-context. */
function buildSubscriber(
  number: string,
  options: TelOptions,
  numberField: string,
  notes: string[],
  contextField: string = URI_FIELD_LABELS.phoneContext,
  extField: string = URI_FIELD_LABELS.ext,
): string {
  const typed = number.trim();
  if (typed === '') throw new MarkupError(numberField, 'missing, type a phone number');
  refuseLetters(typed, numberField);
  const digits = spacesToHyphens(typed, notes);
  const global = digits.startsWith('+');
  const context = (options.phoneContext ?? '').trim();
  let writtenContext = '';

  if (global) {
    if (!isPhoneDigits(digits.slice(1))) {
      throw new MarkupError(
        numberField,
        'a global number is a plus sign, then digits with optional - . ( ) separators, and needs at least one digit (RFC 3966 section 3)',
      );
    }
    if (context !== '') {
      throw new MarkupError(
        contextField,
        'a global number (one that starts with +) works everywhere, so it takes no phone-context (RFC 3966 section 5.1.4)',
      );
    }
  } else {
    if (!/^[0-9*#\-.()]+$/.test(digits) || !/[0-9*#]/.test(digits)) {
      throw new MarkupError(
        numberField,
        'a local number is digits, * and #, with optional - . ( ) separators, and needs at least one of them (RFC 3966 section 3)',
      );
    }
    if (context === '') {
      throw new MarkupError(
        contextField,
        'a local number needs a phone-context, a domain such as example.com or a global prefix such as +1-914-555 (RFC 3966 section 5.1.5); or start the number with + to make it global',
      );
    }
    // Spaces are turned into hyphens only in a global-number context; a domain name never has a space.
    const spaced = context.startsWith('+') ? spacesToHyphens(context, notes) : context;
    const isGlobalContext = spaced.startsWith('+') && isPhoneDigits(spaced.slice(1));
    if (!isGlobalContext && !DOMAIN_NAME.test(spaced)) {
      throw new MarkupError(
        contextField,
        'the phone-context must be a domain name (for example example.com) or a global number (for example +1-914-555) (RFC 3966 section 5.1.5)',
      );
    }
    writtenContext = spaced;
  }

  const typedExt = (options.ext ?? '').trim();
  let writtenExt = '';
  if (typedExt !== '') {
    const spacedExt = spacesToHyphens(typedExt, notes);
    if (!isPhoneDigits(spacedExt)) {
      throw new MarkupError(
        extField,
        'an extension is digits with optional - . ( ) separators, and needs at least one digit (RFC 3966 section 5.3)',
      );
    }
    writtenExt = spacedExt;
  }

  // RFC 3966 section 3: the extension comes first, then the phone-context.
  const written = digits.replace(/#/g, '%23');
  return `${written}${writtenExt ? ';ext=' + writtenExt : ''}${writtenContext ? ';phone-context=' + writtenContext : ''}`;
}

/** The address of a phone link, as RFC 3966 section 3 writes it. A space typed in a number becomes a hyphen, with a note. */
export function buildTel(number: string, options: TelOptions = {}): UriResult {
  const notes: string[] = [];
  const subscriber = buildSubscriber(number, options, URI_FIELD_LABELS.phone, notes);
  return { uri: `tel:${subscriber}`, notes };
}

/** A recipient as typed: a number, optionally followed by ;ext=... and ;phone-context=... as RFC 3966 writes them. */
function parseRecipient(text: string, notes: string[]): string {
  const [number = '', ...params] = text.split(';');
  const options: TelOptions = {};
  for (const param of params) {
    const eq = param.indexOf('=');
    const name = (eq === -1 ? param : param.slice(0, eq)).trim().toLowerCase();
    const value = eq === -1 ? '' : param.slice(eq + 1);
    if (name === 'ext') options.ext = value;
    else if (name === 'phone-context') options.phoneContext = value;
    else {
      throw new MarkupError(
        URI_FIELD_LABELS.recipients,
        `"${param.trim()}" is not offered: after a number only ;ext= and ;phone-context= are written`,
      );
    }
  }
  return buildSubscriber(
    number,
    options,
    URI_FIELD_LABELS.recipients,
    notes,
    URI_FIELD_LABELS.recipients,
    URI_FIELD_LABELS.recipients,
  );
}

/**
 * The address of a text message link (RFC 5724 section 2.2): recipients joined by commas, each an RFC 3966
 * telephone-subscriber, then the body once. The body is written with everything except unreserved characters
 * percent-encoded, and each line break as an encoded line feed (RFC 5724 does not say; the SMS character set has LF).
 */
export function buildSms(recipients: string[], body = ''): UriResult {
  const list = recipients.map((r) => r.trim()).filter((r) => r !== '');
  if (list.length === 0) throw new MarkupError(URI_FIELD_LABELS.recipients, 'missing, type at least one phone number');
  if (list.length > MAX_SMS_RECIPIENTS) {
    throw new MarkupError(URI_FIELD_LABELS.recipients, `more than ${MAX_SMS_RECIPIENTS} recipients, so it is refused`);
  }
  const notes: string[] = [];
  const subscribers = list.map((r) => parseRecipient(r, notes));
  const encodedBody = percentEncode(normalizeBreaks(body, '\n'), (ch) => UNRESERVED.test(ch));
  return { uri: `sms:${subscribers.join(',')}${encodedBody !== '' ? '?body=' + encodedBody : ''}`, notes };
}
