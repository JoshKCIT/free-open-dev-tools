/**
 * Turns a paste or a file into the DER bytes of the certificates and requests in it: PEM blocks, or text with no armour read
 * as Base64 or hex, or a file that is DER itself.
 *
 * Private key blocks are counted and skipped without being looked at; a block with any other label is refused by the name
 * of its label only. Every sentence here describes the shape of the problem, never a pasted value.
 *
 * RULE (as in der.ts): no message from this file may hold a fragment of a pasted value.
 */
import { PemError, base64ToBytes, hexToBytes, pemBlocks } from './pem';

export class CertificateError extends Error {
  /** The line of the pasted text where the problem was found, when there is one. */
  readonly line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'CertificateError';
    if (line !== undefined) this.line = line;
  }
}

/** What a text came from, so a sentence can say `paste` or `file`. */
export type Source = 'paste' | 'file';

export const NO_CERTIFICATE_MESSAGE =
  'No certificate was found in this paste. Paste PEM text that starts with a BEGIN CERTIFICATE or BEGIN CERTIFICATE REQUEST line, or one certificate or request as Base64 or hex DER.';

/** The sentence for text that holds nothing readable; a file gets its own wording (both start with the same words). */
export function noCertificateMessage(source: Source): string {
  return source === 'paste'
    ? NO_CERTIFICATE_MESSAGE
    : 'No certificate or request was found in this file. Open a PEM file that starts with a BEGIN CERTIFICATE or BEGIN CERTIFICATE REQUEST line, a DER file, or a text file holding one certificate or request as Base64 or hex DER.';
}

export interface SplitItem {
  der: Uint8Array;
  /** Known from a PEM label; absent for bytes whose shape decides. */
  kind?: 'certificate' | 'request';
}

export interface SplitResult {
  items: SplitItem[];
  ignored: { label: string; count: number }[];
}

/** The line (counted from 1) that holds the character at `position`. */
export function lineOf(text: string, position: number): number {
  let line = 1;
  const end = Math.min(Math.max(position, 0), text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** A PEM problem described by its line, which the page shows in front of the sentence, instead of a character position. */
function pemFailure(text: string, err: PemError): CertificateError {
  const line = err.position === undefined ? undefined : lineOf(text, err.position);
  return new CertificateError(err.message.replace(/ at position \d+/g, ''), line);
}

function isHexPaste(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const digit = (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
    if (!digit && code !== 58 && code !== 32 && code !== 9 && code !== 10 && code !== 13) return false;
  }
  return true;
}

function isBase64Paste(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const ok =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 43 ||
      code === 47 ||
      code === 61 ||
      code === 32 ||
      code === 9 ||
      code === 10 ||
      code === 13;
    if (!ok) return false;
  }
  return true;
}

const CERTIFICATE_LABELS = new Set(['CERTIFICATE', 'X509 CERTIFICATE']);
const REQUEST_LABELS = new Set(['CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST']);

/** A label that belongs to a secret or to the parameters that travel beside one. */
function isIgnoredLabel(label: string): boolean {
  return label.endsWith('PRIVATE KEY') || label.endsWith(' PARAMETERS');
}

/** Reads a paste with no armour as Base64 or hex. Anything else, or bytes that do not begin a DER sequence, is refused. */
function rawBytes(text: string, source: Source): Uint8Array {
  if (!isHexPaste(text) && !isBase64Paste(text)) throw new CertificateError(noCertificateMessage(source));
  let bytes: Uint8Array;
  try {
    bytes = isHexPaste(text) ? hexToBytes(text) : base64ToBytes(text);
  } catch (err) {
    if (err instanceof PemError) throw new CertificateError(noCertificateMessage(source));
    throw err;
  }
  // A certificate is one DER SEQUENCE, so its first byte is 0x30; anything else is not worth reading as DER.
  if (bytes.length === 0 || bytes[0] !== 0x30) throw new CertificateError(noCertificateMessage(source));
  return bytes;
}

/** Splits a paste into certificate DER bytes, counting the private key blocks it skips. */
export function splitInput(text: string, source: Source = 'paste'): SplitResult {
  let blocks;
  try {
    // The count of blocks is checked by the caller against its own limit, so no cap is asked for here.
    blocks = pemBlocks(text, Number.MAX_SAFE_INTEGER);
  } catch (err) {
    if (err instanceof PemError) throw pemFailure(text, err);
    throw err;
  }
  if (blocks.length === 0) return { items: [{ der: rawBytes(text, source) }], ignored: [] };
  const items: SplitItem[] = [];
  const counts = new Map<string, number>();
  for (const block of blocks) {
    if (CERTIFICATE_LABELS.has(block.label)) {
      items.push({ der: block.body, kind: 'certificate' });
    } else if (REQUEST_LABELS.has(block.label)) {
      items.push({ der: block.body, kind: 'request' });
    } else if (isIgnoredLabel(block.label)) {
      counts.set(block.label, (counts.get(block.label) ?? 0) + 1);
    } else {
      throw new CertificateError(
        `This paste holds a block labelled ${block.label}, which this page does not read.`,
        lineOf(text, block.start),
      );
    }
  }
  return { items, ignored: Array.from(counts, ([label, count]) => ({ label, count })) };
}

/** The bytes of a UTF-8 byte order mark, which a text file saved on some systems begins with. */
const BOM = [0xef, 0xbb, 0xbf];

/**
 * Splits the bytes of a file. A file that begins with 0x30, the first byte of every DER certificate or request, is DER
 * itself; anything else is text (PEM, or Base64 or hex), read as UTF-8 after an optional byte order mark. An empty file, and
 * a text file holding only white space, give no items.
 */
export function splitFile(bytes: Uint8Array): SplitResult {
  if (bytes[0] === 0x30) return { items: [{ der: bytes }], ignored: [] };
  const start = BOM.every((octet, at) => bytes[at] === octet) ? BOM.length : 0;
  const text = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes.subarray(start));
  if (text.trim() === '') return { items: [], ignored: [] };
  return splitInput(text, 'file');
}
