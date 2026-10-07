import { decodeBytes } from './charset';
import { formatDelay, formatUtc } from './dates';
import { decodeEncodedWords } from './encoded-words';
import { EmlViewerError } from './errors';
import {
  MAX_CID_IMAGE_BYTES,
  MAX_HOPS,
  MAX_HTML_PREVIEW_BYTES,
  MAX_MESSAGE_BYTES,
  MAX_TEXT_BODY_SHOWN,
  withCommas,
} from './limits';
import { decodePartBody, parseMime, type PartNode } from './mime';
import { safeAttachmentName } from './names';
import { findParam, type ParsedValue } from './params';
import { parseReceived } from './received';
import { visible } from './visible';

/** One header as read: the value with encoded words decoded, and the unfolded text as written. */
export interface HeaderRow {
  /** The 1-based position in the message. */
  index: number;
  name: string;
  value: string;
  raw: string;
  /** True when decoding changed the text. */
  decoded: boolean;
}

/** One node of the MIME structure: the media type, and a short description of the part. */
export interface TreeOut {
  label: string;
  detail: string;
  children: TreeOut[];
}

export interface TextBody {
  /** The first plain text part, decoded, cut at 256 KiB. */
  text: string;
  /** The character set the part declared, or an empty string. */
  charset: string;
  /** Where it is in the tree. */
  path: string;
  /** True when the text was cut. */
  cut: boolean;
  /** True when the part says format=flowed. */
  flowed: boolean;
}

export interface AttachmentInfo {
  /** The 1-based position in the list of attachments. */
  index: number;
  path: string;
  /** The name to save under: cleaned and unique. */
  name: string;
  /** The name the message gave, exactly as decoded (empty when it gave none). Shown escaped by the page. */
  rawName: string;
  /** True when the cleaned name differs from the raw one. */
  nameChanged: boolean;
  /** Other names the part gave (for example a name that differs from the file name). */
  otherNames: string[];
  /** The type the message declared. It never decides what is saved or how. */
  declaredType: string;
  /** The decoded size in bytes. */
  size: number;
  /** SHA-256 of the decoded bytes, in lower case hexadecimal. */
  sha256: string;
  bytes: Uint8Array;
}

/** One Received line read as a delivery hop. Everything in it is what the server that wrote the line chose to say. */
export interface Hop {
  /** The 1-based position among the listed hops, oldest first. */
  index: number;
  from: string;
  /** The first comment in the from clause, usually the address the server saw. */
  fromComment: string;
  by: string;
  via: string;
  with: string;
  id: string;
  for: string;
  /** The stated time in UTC as `YYYY-MM-DD HH:MM:SS`, or an empty string when the line states no readable date. */
  time: string;
  timeMs: number | null;
  /** The time since the previous listed hop, as `N s` or `N min N s`, or an empty string for the first hop. */
  delay: string;
  delaySeconds: number | null;
  /** What is worth knowing about this line: an assumption made reading its date, a missing date, a clock that disagrees. */
  note: string;
}

/** A part a cid address may name: its Content-ID without the angle brackets, and its decoded bytes. */
export interface CidPart {
  id: string;
  bytes: Uint8Array;
}

export interface EmlAnalysis {
  /** The message size in bytes. */
  size: number;
  summary: [string, string][];
  headers: HeaderRow[];
  /** The Received lines as delivery hops, oldest first (the line at the bottom of the headers is the first hop). */
  hops: Hop[];
  /** The MIME structure, or null when the message has headers and no body. */
  tree: TreeOut | null;
  textBody: TextBody | null;
  /** The HTML body, decoded, cut after 1 MiB plus one character (the preview refuses anything over 1 MiB). */
  htmlBody: string | null;
  cidParts: CidPart[];
  attachments: AttachmentInfo[];
  /** The number of data parts: 0 for a message with headers only. */
  partCount: number;
  notes: string[];
}

const MAX_NOTES = 50;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  let out = '';
  for (const byte of digest) out += (byte < 16 ? '0' : '') + byte.toString(16);
  return out;
}

function hasOnlyWhiteSpace(bytes: Uint8Array, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const byte = bytes[i] ?? 0;
    if (byte > 32) return false;
  }
  return true;
}

function firstHeader(rows: readonly HeaderRow[], lowerName: string): HeaderRow | undefined {
  for (const row of rows) if (row.name.toLowerCase() === lowerName) return row;
  return undefined;
}

/**
 * The names a part gives, best first: filename* then filename of the disposition, then name* then name of the type. The
 * first is used and the rest are listed beside it.
 */
function nameCandidates(node: PartNode): { raw: string; others: string[] } {
  const found: string[] = [];
  const add = (parsed: ParsedValue | null, name: string, extended: boolean): void => {
    if (parsed === null) return;
    for (const entry of parsed.params) {
      if (entry.raw || entry.name !== name || entry.extended !== extended || entry.value === '') continue;
      // RFC 2047 words in a plain name are not allowed by the standard but are common, so they are read as a courtesy.
      const value = extended ? entry.value : decodeEncodedWords(entry.value).text;
      if (!found.includes(value)) found.push(value);
      return;
    }
  };
  add(node.dispositionParams, 'filename', true);
  add(node.dispositionParams, 'filename', false);
  add(node.type, 'name', true);
  add(node.type, 'name', false);
  const raw = found[0] ?? '';
  return { raw, others: found.slice(1) };
}

/** The clock note shown when a line states a time before the line before it. */
const CLOCK_NOTE =
  'This line states a time earlier than the line before it, so the clocks of the two servers disagree, or one of the lines was written by the sender.';

/**
 * Lists the Received lines oldest first: the line at the bottom of the headers is the first hop (RFC 5321 section 4.4: a
 * server prepends its line). The delay of a hop is the whole seconds between its stated date and the previous listed hop's,
 * each date read with its own zone applied; a negative delay is a clock note and never an error. At most 200 hops are
 * listed, the oldest ones, and a note says how many were left out.
 */
function buildHops(headers: readonly HeaderRow[], addNote: (note: string) => void): Hop[] {
  const lines: HeaderRow[] = [];
  for (const row of headers) if (row.name.toLowerCase() === 'received') lines.push(row);
  lines.reverse();
  if (lines.length > MAX_HOPS) {
    addNote(
      `The message has ${withCommas(lines.length)} Received lines. Only the oldest ${MAX_HOPS} are listed as hops; the other ${withCommas(lines.length - MAX_HOPS)} were not read.`,
    );
    lines.length = MAX_HOPS;
  }
  const hops: Hop[] = [];
  let previousMs: number | null = null;
  for (const line of lines) {
    const read = parseReceived(line.raw);
    const timeMs = read.date === null ? null : read.date.ms;
    const notes = [...read.notes];
    let delaySeconds: number | null = null;
    if (hops.length > 0 && timeMs !== null && previousMs !== null) {
      delaySeconds = Math.round((timeMs - previousMs) / 1000);
      if (delaySeconds < 0) notes.push(CLOCK_NOTE);
    }
    hops.push({
      index: hops.length + 1,
      from: read.from,
      fromComment: read.fromComment,
      by: read.by,
      via: read.via,
      with: read.with,
      id: read.id,
      for: read.for,
      time: timeMs === null ? '' : formatUtc(timeMs),
      timeMs,
      delay: delaySeconds === null ? '' : formatDelay(delaySeconds),
      delaySeconds,
      note: notes.join(' '),
    });
    previousMs = timeMs;
  }
  return hops;
}

function isTextBodyType(contentType: string): boolean {
  return contentType === 'text/plain' || contentType === 'text/html';
}

const SMIME_TYPES = new Set([
  'application/pkcs7-mime',
  'application/x-pkcs7-mime',
  'application/pkcs7-signature',
  'application/x-pkcs7-signature',
]);
const PGP_TYPES = new Set([
  'multipart/encrypted',
  'application/pgp-encrypted',
  'application/pgp-signature',
  'application/pgp-keys',
]);

function describePart(node: PartNode, size: number, name: string): string {
  const pieces: string[] = [];
  pieces.push(node.path === '' ? 'the message' : `part ${node.path}`);
  if (node.container === 'multipart')
    pieces.push(node.children.length === 1 ? '1 part' : `${node.children.length} parts`);
  else if (node.container === 'message') pieces.push('a message');
  else pieces.push(`${withCommas(size)} bytes`);
  const charset = findParam(node.type, 'charset');
  if (charset !== undefined && node.contentType.startsWith('text/'))
    pieces.push(`charset ${visible(charset.value, 40)}`);
  if (node.container === 'leaf' && node.transferEncoding !== '7bit') pieces.push(visible(node.transferEncoding, 40));
  if (node.disposition !== '') pieces.push(visible(node.disposition, 40));
  if (name !== '') pieces.push(`named ${name}`);
  return pieces.join(', ');
}

/**
 * Reads a whole message: the decoded headers, the MIME tree, the first plain text and HTML bodies, every attachment
 * with its cleaned name, size and SHA-256, the parts a cid address can name, and notes about what was cut or not read.
 * Nothing is opened, previewed or verified. A message over 25 MiB or with nothing in it is refused. The attachment
 * bytes are fresh copies, so a caller may hand their buffers on.
 */
export async function analyzeMessage(bytes: Uint8Array): Promise<EmlAnalysis> {
  if (bytes.length > MAX_MESSAGE_BYTES) {
    throw new EmlViewerError(
      `The message is ${withCommas(bytes.length)} bytes. The limit is ${withCommas(MAX_MESSAGE_BYTES)} (25 MiB), so it was not read.`,
      'message',
    );
  }
  if (hasOnlyWhiteSpace(bytes, 0, bytes.length)) {
    throw new EmlViewerError('The message is empty, so there is nothing to read.', 'message');
  }

  const root = parseMime(bytes);
  const notes: string[] = [];
  const addNote = (note: string): void => {
    if (notes.length < MAX_NOTES && !notes.includes(note)) notes.push(note);
  };

  // Headers, in message order with repeats kept.
  const headers: HeaderRow[] = [];
  const unknownLabels: string[] = [];
  let cutWords = false;
  root.fields.forEach((field, i) => {
    const result = decodeEncodedWords(field.value);
    if (result.cut) cutWords = true;
    for (const label of result.unknownCharsets) if (!unknownLabels.includes(label)) unknownLabels.push(label);
    headers.push({
      index: i + 1,
      name: field.name,
      value: result.text,
      raw: field.value,
      decoded: result.text !== field.value,
    });
  });
  if (cutWords) addNote('A header has more than 200 encoded words, so the words after the 200th are shown as written.');
  for (const label of unknownLabels) {
    addNote(
      `The character set ${visible(label, 40)} in a header is not one this page can read, so that text is shown as escaped bytes.`,
    );
  }

  const hops = buildHops(headers, addNote);

  const summary: [string, string][] = [];
  const pick = (label: string, lowerName: string): void => {
    const row = firstHeader(headers, lowerName);
    if (row !== undefined) summary.push([label, row.value]);
  };
  pick('From', 'from');
  pick('To', 'to');
  pick('Cc', 'cc');
  pick('Subject', 'subject');
  pick('Date', 'date');
  pick('Message-ID', 'message-id');

  const bodyEmpty = root.container === 'leaf' && hasOnlyWhiteSpace(bytes, root.bodyStart, root.bodyEnd);

  // Walk the tree in part order with an explicit stack.
  const attachments: AttachmentInfo[] = [];
  const cidParts: CidPart[] = [];
  const taken = new Set<string>();
  let textBody: TextBody | null = null;
  let htmlBody: string | null = null;
  let partCount = 0;
  let sawSmime = false;
  let sawPgp = false;
  let sawTnef = false;
  const unknownBodyLabels: string[] = [];

  const rootOut: TreeOut = { label: root.contentType, detail: '', children: [] };
  interface Frame {
    node: PartNode;
    out: TreeOut;
    insideMessage: boolean;
  }
  const stack: Frame[] = [{ node: root, out: rootOut, insideMessage: false }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;
    const { node, out } = frame;
    for (const note of node.notes) addNote(node.path === '' ? note : `Part ${node.path}: ${note}`);

    if (
      SMIME_TYPES.has(node.contentType) ||
      (node.contentType === 'multipart/signed' && /pkcs7/i.test(findParam(node.type, 'protocol')?.value ?? ''))
    ) {
      sawSmime = true;
    }
    if (
      PGP_TYPES.has(node.contentType) ||
      (node.contentType === 'multipart/signed' && /pgp/i.test(findParam(node.type, 'protocol')?.value ?? ''))
    ) {
      sawPgp = true;
    }
    if (node.contentType === 'application/ms-tnef') sawTnef = true;

    const named = nameCandidates(node);
    const isAttachmentLike = node.disposition === 'attachment' || named.raw !== '';
    let size = 0;
    let decodedBytes: Uint8Array | null = null;

    if (node.container !== 'multipart' && !(bodyEmpty && node === root)) {
      // A leaf is decoded once, for its size and, when kept, its bytes. A nested message is listed only when it is an attachment.
      if (node.container === 'leaf' || isAttachmentLike) {
        const body = decodePartBody(bytes, node);
        decodedBytes = body.bytes;
        size = body.bytes.length;
        if (body.note !== null) addNote(node.path === '' ? body.note : `Part ${node.path}: ${body.note}`);
      }
    }

    let attachmentName = '';
    if (node.container === 'leaf' && !(bodyEmpty && node === root)) partCount++;

    if (decodedBytes !== null) {
      const isBodyType = isTextBodyType(node.contentType);
      const attachment =
        node.container === 'message'
          ? isAttachmentLike
          : !(isBodyType && node.disposition !== 'attachment' && named.raw === '');

      if (!attachment && !frame.insideMessage) {
        const charsetParam = findParam(node.type, 'charset')?.value ?? '';
        if (node.contentType === 'text/plain' && textBody === null) {
          const decoded = decodeBytes(decodedBytes, charsetParam);
          if (!decoded.known && !unknownBodyLabels.includes(decoded.label)) unknownBodyLabels.push(decoded.label);
          const cut = decoded.text.length > MAX_TEXT_BODY_SHOWN || decoded.cut;
          textBody = {
            text: decoded.text.length > MAX_TEXT_BODY_SHOWN ? decoded.text.slice(0, MAX_TEXT_BODY_SHOWN) : decoded.text,
            charset: decoded.label,
            path: node.path,
            cut,
            flowed: (findParam(node.type, 'format')?.value ?? '').toLowerCase() === 'flowed',
          };
          if (textBody.text.includes('-----BEGIN PGP')) sawPgp = true;
        } else if (node.contentType === 'text/html' && htmlBody === null) {
          const decoded = decodeBytes(decodedBytes, charsetParam, MAX_HTML_PREVIEW_BYTES + 1);
          if (!decoded.known && !unknownBodyLabels.includes(decoded.label)) unknownBodyLabels.push(decoded.label);
          htmlBody =
            decoded.text.length > MAX_HTML_PREVIEW_BYTES + 1
              ? decoded.text.slice(0, MAX_HTML_PREVIEW_BYTES + 1)
              : decoded.text;
        }
      }

      if (node.contentId !== '' && size <= MAX_CID_IMAGE_BYTES && node.container === 'leaf') {
        cidParts.push({ id: node.contentId, bytes: decodedBytes });
      }

      if (attachment) {
        const cleaned = safeAttachmentName(named.raw, attachments.length + 1, taken);
        attachmentName = cleaned.name;
        if (cleaned.name.toLowerCase() === 'winmail.dat') sawTnef = true;
        attachments.push({
          index: attachments.length + 1,
          path: node.path,
          name: cleaned.name,
          rawName: named.raw,
          nameChanged: cleaned.changed,
          otherNames: named.others,
          declaredType: node.contentType,
          size,
          sha256: await sha256Hex(decodedBytes),
          bytes: decodedBytes,
        });
      }
    }

    out.label = node.contentType;
    out.detail = describePart(node, size, attachmentName);

    // Children in part order: push them reversed so the first is read first.
    const insideMessage = frame.insideMessage || node.container === 'message';
    const childOuts: TreeOut[] = node.children.map((child) => ({ label: child.contentType, detail: '', children: [] }));
    out.children = childOuts;
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      const childOut = childOuts[i];
      if (child !== undefined && childOut !== undefined) stack.push({ node: child, out: childOut, insideMessage });
    }
  }

  for (const label of unknownBodyLabels) {
    addNote(
      `The character set ${visible(label, 40)} is not one this page can read, so that part is shown as escaped bytes.`,
    );
  }
  if (sawSmime)
    addNote('This message uses S/MIME. Its structure is shown, but nothing is verified, decrypted or opened.');
  if (sawPgp) addNote('This message uses PGP. Its structure is shown, but nothing is verified or decrypted.');
  if (sawTnef) addNote('A winmail.dat or TNEF part is listed as an attachment. It is not read.');
  if (bodyEmpty) addNote('The message has headers and no body.');
  if (textBody !== null && textBody.cut) addNote('The plain text body is cut at 256 KiB.');

  summary.push(['Size', `${withCommas(bytes.length)} bytes`]);
  summary.push(['Parts', String(partCount)]);
  summary.push(['Attachments', String(attachments.length)]);

  return {
    size: bytes.length,
    summary,
    headers,
    hops,
    tree: bodyEmpty ? null : rootOut,
    textBody,
    htmlBody,
    cidParts,
    attachments,
    partCount,
    notes,
  };
}
