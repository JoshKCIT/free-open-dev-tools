/**
 * Payload builders for every QR code kind this tool supports.
 *
 * qrcode (the runtime encoder this package wraps) turns an arbitrary string
 * into a QR bitmap -- it has no opinion at all about what that string means.
 * Every payload scheme below is therefore hand-written directly against its
 * own cited source, fetched and quoted in the comments beside each builder,
 * never invented from memory and never delegated to the encoder.
 */

export const PAYLOAD_KINDS = ['text', 'url', 'wifi', 'vcard', 'email', 'sms'] as const;
export type PayloadKind = (typeof PAYLOAD_KINDS)[number];

export class QrPayloadError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'QrPayloadError';
    this.field = field;
  }
}

export interface BuiltPayload {
  payload: string;
  warnings: string[];
}

export interface TextFields {
  text: string;
}

export interface UrlFields {
  url: string;
}

export interface WifiFields {
  ssid: string;
  security: 'WPA' | 'WEP' | 'nopass';
  password?: string;
  hidden?: boolean;
}

export interface VCardFields {
  vcardVersion: '3.0' | '4.0';
  givenName?: string;
  familyName?: string;
  org?: string;
  title?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  note?: string;
}

export interface EmailFields {
  to: string;
  subject?: string;
  body?: string;
  cc?: string;
}

export interface SmsFields {
  number: string;
  message?: string;
  smsScheme: 'sms' | 'SMSTO';
}

export type PayloadFields = TextFields | UrlFields | WifiFields | VCardFields | EmailFields | SmsFields;

/**
 * The WIFI: convention has no RFC. Fetched and quoted directly from the
 * ZXing project's own wiki, "Barcode Contents" page
 * (raw.githubusercontent.com/wiki/zxing/zxing/Barcode-Contents.md, 2026-09-27):
 *
 *   "WIFI:T:WPA;S:mynetwork;P:mypass;;"
 *   "Special characters \, ;, , and " and : should be escaped with a
 *   backslash (\) as in MECARD encoding. For example, if an SSID was
 *   literally "foo;bar\baz" (with double quotes part of the SSID name
 *   itself) then it would be encoded like: WIFI:S:\"foo\;bar\\baz\";;"
 *
 * Every character is escaped in one left-to-right pass -- never a series of
 * global replacements, which would double-escape a backslash introduced by
 * an earlier escape.
 */
function escapeWifi(value: string): string {
  let out = '';
  for (const ch of value) {
    if (ch === '\\' || ch === ';' || ch === ',' || ch === ':' || ch === '"') out += '\\' + ch;
    else out += ch;
  }
  return out;
}

function buildWifi(fields: WifiFields): BuiltPayload {
  const warnings: string[] = [];
  const ssid = fields.ssid ?? '';
  if (!ssid) throw new QrPayloadError('A WiFi network name (SSID) is required.', 'ssid');
  const security = fields.security ?? 'nopass';
  let payload = `WIFI:T:${security};S:${escapeWifi(ssid)};`;
  if (security !== 'nopass') {
    payload += `P:${escapeWifi(fields.password ?? '')};`;
  }
  if (fields.hidden) payload += 'H:true;';
  payload += ';';
  return { payload, warnings };
}

/**
 * vCard 3.0 (RFC 2426) and 4.0 (RFC 6350) escaping and folding.
 *
 * RFC 6350 section 3.4 (fetched, www.rfc-editor.org/rfc/rfc6350.txt):
 *   "a COMMA character in a value MUST be escaped with a BACKSLASH
 *   character... a SEMICOLON in a field of such a "compound" property MUST
 *   be escaped with a BACKSLASH character... BACKSLASH characters in values
 *   MUST be escaped with a BACKSLASH character. NEWLINE (U+000A) characters
 *   in values MUST be encoded by two characters: a BACKSLASH followed by
 *   either an 'n' ... or an 'N'."
 *
 * RFC 2426 section 2.5 (fetched, www.rfc-editor.org/rfc/rfc2426.txt):
 *   "A SEMI-COLON in a component of a compound property value MUST be
 *   escaped with a BACKSLASH character... A COMMA character in a value MUST
 *   be escaped with a BACKSLASH character."
 * (RFC 2426 section 2.4.2 additionally requires escaping COLON, but only
 * inside the nested-vCard AGENT value type, which this tool never builds --
 * recorded in testNotes so the difference from RFC 6350 is not silently
 * assumed to be universal.)
 *
 * Folding: RFC 6350 section 3.2 requires folding at a maximum of 75 octets
 * (excluding the line break), continued with CRLF followed by one space,
 * "MUST NOT split... in the middle of a UTF-8 multi-octet character". RFC
 * 2426 section 2.6 says the same "75 characters" figure via [MIME-DIR];
 * this tool applies the octet-safe rule (never splitting a UTF-8 character)
 * to both versions for one consistent, safe implementation -- a documented
 * choice, not a silent guess (see meta.json ambiguities).
 */
function escapeVCardText(value: string): string {
  let out = '';
  for (const ch of value) {
    if (ch === '\\') out += '\\\\';
    else if (ch === ';') out += '\\;';
    else if (ch === ',') out += '\\,';
    else if (ch === '\n') out += '\\n';
    else out += ch;
  }
  return out;
}

/** Folds one already-built content line (no trailing CRLF) at 75 octets,
 * counted in UTF-8 bytes, never splitting a multi-byte character. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;
  const decoder = new TextDecoder();
  let out = '';
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    const limit = first ? 75 : 74; // continuation lines lose one octet to the leading space
    let end = Math.min(start + limit, bytes.length);
    // Never split a UTF-8 multi-octet character: back off while the next
    // byte is a continuation byte (10xxxxxx).
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    out += (first ? '' : '\r\n ') + decoder.decode(bytes.slice(start, end));
    start = end;
    first = false;
  }
  return out;
}

function buildVCard(fields: VCardFields): BuiltPayload {
  const warnings: string[] = [];
  const given = fields.givenName ?? '';
  const family = fields.familyName ?? '';
  if (!given && !family) throw new QrPayloadError('A name is required.', 'givenName');
  const version = fields.vcardVersion === '3.0' ? '3.0' : '4.0';
  const lines: string[] = [];
  lines.push('BEGIN:VCARD');
  lines.push(`VERSION:${version}`);
  lines.push(`N:${escapeVCardText(family)};${escapeVCardText(given)};;;`);
  const fn = `${given} ${family}`.trim();
  lines.push(`FN:${escapeVCardText(fn) || 'Unnamed'}`);
  if (fields.org) lines.push(`ORG:${escapeVCardText(fields.org)}`);
  if (fields.title) lines.push(`TITLE:${escapeVCardText(fields.title)}`);
  if (fields.phone) lines.push(`TEL;TYPE=CELL:${escapeVCardText(fields.phone)}`);
  if (fields.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardText(fields.email)}`);
  if (fields.website) lines.push(`URL:${escapeVCardText(fields.website)}`);
  if (fields.address) lines.push(`ADR:;;${escapeVCardText(fields.address)};;;;`);
  if (fields.note) lines.push(`NOTE:${escapeVCardText(fields.note)}`);
  lines.push('END:VCARD');
  const payload = lines.map(foldLine).join('\r\n') + '\r\n';
  return { payload, warnings };
}

/**
 * RFC 6068 (mailto:) sections 2 and 5, fetched
 * (www.rfc-editor.org/rfc/rfc6068.txt). Section 2's <hfvalue> production
 * requires percent-encoding of everything outside its own restricted
 * "qchar" set; encodeURIComponent's output is a safe (if slightly more
 * conservative) superset of that requirement for every character this tool
 * accepts. A line break inside "body" is written CRLF then percent-encoded,
 * matching the worked example at line 476 of the fetched text:
 * "body=send%20current-issue%0D%0Asend%20index".
 */
function buildEmail(fields: EmailFields): BuiltPayload {
  const warnings: string[] = [];
  const to = (fields.to ?? '').trim();
  if (!to) throw new QrPayloadError('A recipient address is required.', 'to');
  const params: string[] = [];
  if (fields.subject) params.push(`subject=${encodeURIComponent(fields.subject)}`);
  if (fields.cc) params.push(`cc=${encodeURIComponent(fields.cc)}`);
  if (fields.body) {
    const normalized = fields.body.replace(/\r\n|\r|\n/g, '\r\n');
    params.push(`body=${encodeURIComponent(normalized)}`);
  }
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return { payload: `mailto:${to}${query}`, warnings };
}

const PHONE_NUMBER_RE = /^\+?[0-9]+$/;

/**
 * RFC 5724 (fetched, www.rfc-editor.org/rfc/rfc5724.txt), section 2.5's own
 * example: "sms:+15105550101?body=hello%20there". SMSTO: is the older,
 * still widely-scanned convention this tool's own read_first sources
 * describe as plain (colon-delimited, not percent-encoded) -- disclosed as
 * an ambiguity since no normative text for it was found (see meta.json).
 */
function buildSms(fields: SmsFields): BuiltPayload {
  const warnings: string[] = [];
  const number = (fields.number ?? '').trim();
  if (!PHONE_NUMBER_RE.test(number)) {
    throw new QrPayloadError('The number must be digits with an optional leading plus sign.', 'number');
  }
  const message = fields.message ?? '';
  if (fields.smsScheme === 'SMSTO') {
    return { payload: message ? `SMSTO:${number}:${message}` : `SMSTO:${number}:`, warnings };
  }
  const query = message ? `?body=${encodeURIComponent(message)}` : '';
  return { payload: `sms:${number}${query}`, warnings };
}

function buildUrl(fields: UrlFields): BuiltPayload {
  const warnings: string[] = [];
  const url = (fields.url ?? '').trim();
  if (!url) throw new QrPayloadError('A URL is required.', 'url');
  if (!/^https?:\/\//i.test(url)) {
    warnings.push('This does not start with http:// or https://, so some scanners may not open it as a link.');
  }
  return { payload: url, warnings };
}

function buildText(fields: TextFields): BuiltPayload {
  const text = fields.text ?? '';
  if (!text) throw new QrPayloadError('Text is required.', 'text');
  return { payload: text, warnings: [] };
}

export function buildPayload(kind: PayloadKind, fields: Record<string, unknown>): BuiltPayload {
  switch (kind) {
    case 'text':
      return buildText(fields as unknown as TextFields);
    case 'url':
      return buildUrl(fields as unknown as UrlFields);
    case 'wifi':
      return buildWifi(fields as unknown as WifiFields);
    case 'vcard':
      return buildVCard(fields as unknown as VCardFields);
    case 'email':
      return buildEmail(fields as unknown as EmailFields);
    case 'sms':
      return buildSms(fields as unknown as SmsFields);
    default: {
      const exhaustive: never = kind;
      throw new QrPayloadError(`Unknown payload kind: ${String(exhaustive)}`);
    }
  }
}
