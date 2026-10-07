import { afterLineEnd, lineEndAt, splitHeaderBlock, trimWsp, type RawField } from './lines';
import { MAX_DEPTH, MAX_PARTS, withCommas } from './limits';
import { findParam, parseParameters, type ParsedValue } from './params';
import { copyRange, decodeBase64Lenient, decodeQuotedPrintable } from './transfer';

/** One part of a message, or the message itself (the root). Offsets point into the bytes the tree was read from. */
export interface PartNode {
  /** The position in the tree: empty for the message, then 1, 2, 1.1 and so on (a nested message adds .1). */
  path: string;
  /** How deep it is: 1 for the message itself. */
  depth: number;
  fields: RawField[];
  /** The media type in lower case, such as text/plain. */
  contentType: string;
  /** Content-Type read into its parameters (primary value included). */
  type: ParsedValue;
  /** The Content-Disposition value in lower case (attachment, inline), or an empty string. */
  disposition: string;
  dispositionParams: ParsedValue | null;
  /** The Content-Transfer-Encoding in lower case, defaulting to 7bit. */
  transferEncoding: string;
  /** The Content-ID without its angle brackets, or an empty string. */
  contentId: string;
  bodyStart: number;
  bodyEnd: number;
  /** What the part holds: other parts (multipart), one nested message, or data. */
  container: 'multipart' | 'message' | 'leaf';
  children: PartNode[];
  notes: string[];
}

export interface MimeOptions {
  maxDepth?: number;
  maxParts?: number;
}

const SP = 32;
const HT = 9;
const DASH = 45;

function firstField(fields: readonly RawField[], lowerName: string): RawField | undefined {
  for (const field of fields) if (field.name.toLowerCase() === lowerName) return field;
  return undefined;
}

function isMediaType(text: string): boolean {
  const slash = text.indexOf('/');
  return slash > 0 && slash < text.length - 1 && text.indexOf('/', slash + 1) === -1 && text.indexOf(' ') === -1;
}

/** Reads the headers of the part that spans [start, end) and the values every part needs. */
function makeNode(
  bytes: Uint8Array,
  start: number,
  end: number,
  depth: number,
  path: string,
  defaultType: string,
  allowMbox: boolean,
): PartNode {
  const block = splitHeaderBlock(bytes, start, end, allowMbox);
  const notes = [...block.notes];

  const typeField = firstField(block.fields, 'content-type');
  const type = parseParameters(typeField === undefined ? '' : typeField.value);
  let contentType = type.primary.toLowerCase();
  if (typeField === undefined || contentType === '') contentType = defaultType;
  else if (!isMediaType(contentType)) {
    notes.push(`A part has a Content-Type that is not a media type, so ${defaultType} is assumed.`);
    contentType = defaultType;
  }

  const dispositionField = firstField(block.fields, 'content-disposition');
  const dispositionParams = dispositionField === undefined ? null : parseParameters(dispositionField.value);
  const disposition = dispositionParams === null ? '' : dispositionParams.primary.toLowerCase();

  const encodingField = firstField(block.fields, 'content-transfer-encoding');
  let transferEncoding = '7bit';
  if (encodingField !== undefined) {
    const word = parseParameters(encodingField.value).primary.toLowerCase();
    if (word !== '') transferEncoding = word;
  }

  const idField = firstField(block.fields, 'content-id');
  let contentId = '';
  if (idField !== undefined) {
    contentId = trimWsp(idField.value);
    if (contentId.startsWith('<')) contentId = contentId.slice(1);
    const close = contentId.indexOf('>');
    if (close !== -1) contentId = contentId.slice(0, close);
    contentId = trimWsp(contentId);
  }

  const container = contentType.startsWith('multipart/')
    ? 'multipart'
    : contentType === 'message/rfc822' || contentType === 'message/global'
      ? 'message'
      : 'leaf';

  return {
    path,
    depth,
    fields: block.fields,
    contentType,
    type,
    disposition,
    dispositionParams,
    transferEncoding,
    contentId,
    bodyStart: block.bodyStart,
    bodyEnd: end,
    container,
    children: [],
    notes,
  };
}

/** The delimiter lines of a multipart body, found by comparing each line's start with the boundary. */
type DelimiterKind = 'none' | 'delimiter' | 'close';

function delimiterKind(bytes: Uint8Array, lineStart: number, lineEnd: number, boundary: Uint8Array): DelimiterKind {
  const length = boundary.length;
  if (lineEnd - lineStart < length + 2) return 'none';
  if (bytes[lineStart] !== DASH || bytes[lineStart + 1] !== DASH) return 'none';
  for (let i = 0; i < length; i++) if (bytes[lineStart + 2 + i] !== boundary[i]) return 'none';
  let at = lineStart + 2 + length;
  let kind: DelimiterKind = 'delimiter';
  if (at + 1 < lineEnd && bytes[at] === DASH && bytes[at + 1] === DASH) {
    kind = 'close';
    at += 2;
  }
  // Only transport padding (spaces and tabs) may follow: a longer boundary that starts the same is not a delimiter.
  while (at < lineEnd) {
    const byte = bytes[at];
    if (byte !== SP && byte !== HT) return 'none';
    at++;
  }
  return kind;
}

interface PartRange {
  start: number;
  end: number;
}

/** Finds the parts of a multipart body: one pass over its lines. */
function findParts(
  bytes: Uint8Array,
  bodyStart: number,
  bodyEnd: number,
  boundary: Uint8Array,
): { parts: PartRange[]; closed: boolean; sawDelimiter: boolean } {
  const parts: PartRange[] = [];
  let currentStart = -1;
  let previousContentEnd = bodyStart;
  let closed = false;
  let sawDelimiter = false;
  let pos = bodyStart;
  while (pos < bodyEnd) {
    const lineEnd = lineEndAt(bytes, pos, bodyEnd);
    const next = afterLineEnd(bytes, lineEnd, bodyEnd);
    const kind = delimiterKind(bytes, pos, lineEnd, boundary);
    if (kind !== 'none') {
      sawDelimiter = true;
      if (currentStart >= 0) parts.push({ start: currentStart, end: Math.max(currentStart, previousContentEnd) });
      if (kind === 'close') {
        closed = true;
        currentStart = -1;
        break;
      }
      currentStart = next;
    }
    previousContentEnd = lineEnd;
    pos = next;
  }
  if (!closed && currentStart >= 0)
    parts.push({ start: currentStart, end: Math.max(currentStart, previousContentEnd) });
  return { parts, closed, sawDelimiter };
}

/**
 * Reads the MIME structure of a message into a tree, with an explicit stack and no recursion over the input. A boundary
 * is found only as a whole line (so --BOUNDARY-10 is not a delimiter of BOUNDARY-1), with a closing delimiter that is
 * missing tolerated and said. A multipart/digest part with no Content-Type is a message. A nested message is read as its
 * own tree one level deeper. Nesting deeper than 16 levels and more than 1,000 parts stop the reading at that point with a
 * note, keeping what was read.
 */
export function parseMime(bytes: Uint8Array, options: MimeOptions = {}): PartNode {
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxParts = options.maxParts ?? MAX_PARTS;
  const root = makeNode(bytes, 0, bytes.length, 1, '', 'text/plain', true);
  let parts = 0;
  let depthNoted = false;
  let partsNoted = false;
  const encoder = new TextEncoder();

  const stack: PartNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || node.container === 'leaf') continue;

    if (node.depth + 1 > maxDepth) {
      if (!depthNoted) {
        depthNoted = true;
        root.notes.push(
          `Parts are nested deeper than ${maxDepth} levels, so the parts inside level ${node.depth} were not read.`,
        );
      }
      continue;
    }

    if (node.container === 'message') {
      if (parts >= maxParts) {
        if (!partsNoted) {
          partsNoted = true;
          root.notes.push(`The message has more than ${withCommas(maxParts)} parts, so the rest were not read.`);
        }
        continue;
      }
      parts++;
      const child = makeNode(
        bytes,
        node.bodyStart,
        node.bodyEnd,
        node.depth + 1,
        `${node.path === '' ? '' : node.path + '.'}1`,
        'text/plain',
        false,
      );
      node.children.push(child);
      stack.push(child);
      continue;
    }

    // A multipart.
    const boundaryText = findParam(node.type, 'boundary')?.value ?? '';
    if (boundaryText === '') {
      node.notes.push('A multipart part has no boundary, so its parts cannot be told apart.');
      continue;
    }
    const found = findParts(bytes, node.bodyStart, node.bodyEnd, encoder.encode(boundaryText));
    if (found.parts.length === 0) {
      node.notes.push(
        found.sawDelimiter
          ? 'A multipart part has no part in it.'
          : 'A multipart part has no part in it: its boundary line was not found.',
      );
      continue;
    }
    if (!found.closed)
      node.notes.push('The closing boundary line of a multipart part is missing, so the message may be cut.');
    const defaultType = node.contentType === 'multipart/digest' ? 'message/rfc822' : 'text/plain';
    let number = 0;
    for (const range of found.parts) {
      if (parts >= maxParts) {
        if (!partsNoted) {
          partsNoted = true;
          root.notes.push(`The message has more than ${withCommas(maxParts)} parts, so the rest were not read.`);
        }
        break;
      }
      parts++;
      number++;
      const child = makeNode(
        bytes,
        range.start,
        range.end,
        node.depth + 1,
        `${node.path === '' ? '' : node.path + '.'}${number}`,
        defaultType,
        false,
      );
      node.children.push(child);
      stack.push(child);
    }
  }
  return root;
}

/** The decoded bytes of a part's body after its Content-Transfer-Encoding, and a note when the encoding is not one of the six. */
export function decodePartBody(bytes: Uint8Array, node: PartNode): { bytes: Uint8Array; note: string | null } {
  const encoding = node.transferEncoding;
  if (encoding === 'base64') return { bytes: decodeBase64Lenient(bytes, node.bodyStart, node.bodyEnd), note: null };
  if (encoding === 'quoted-printable')
    return { bytes: decodeQuotedPrintable(bytes, node.bodyStart, node.bodyEnd), note: null };
  const known = encoding === '7bit' || encoding === '8bit' || encoding === 'binary';
  return {
    bytes: copyRange(bytes, node.bodyStart, node.bodyEnd),
    note: known
      ? null
      : 'A part names a Content-Transfer-Encoding this page does not know, so its bytes are used as they are.',
  };
}
