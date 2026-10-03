/**
 * Turns a paste into the DER bytes of the certificates in it: PEM blocks, or a paste with no armour read as Base64 or hex.
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

export const NO_CERTIFICATE_MESSAGE =
  'No certificate was found in this paste. Paste PEM text that starts with a BEGIN CERTIFICATE line, or one certificate as Base64 or hex DER.';

export interface SplitResult {
  items: Uint8Array[];
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

/** A label that belongs to a secret or to the parameters that travel beside one. */
function isIgnoredLabel(label: string): boolean {
  return label.endsWith('PRIVATE KEY') || label.endsWith(' PARAMETERS');
}

/** Reads a paste with no armour as Base64 or hex. Anything else, or bytes that do not begin a DER sequence, is refused. */
function rawBytes(text: string): Uint8Array {
  if (!isHexPaste(text) && !isBase64Paste(text)) throw new CertificateError(NO_CERTIFICATE_MESSAGE);
  let bytes: Uint8Array;
  try {
    bytes = isHexPaste(text) ? hexToBytes(text) : base64ToBytes(text);
  } catch (err) {
    if (err instanceof PemError) throw new CertificateError(NO_CERTIFICATE_MESSAGE);
    throw err;
  }
  // A certificate is one DER SEQUENCE, so its first byte is 0x30; anything else is not worth reading as DER.
  if (bytes.length === 0 || bytes[0] !== 0x30) throw new CertificateError(NO_CERTIFICATE_MESSAGE);
  return bytes;
}

/** Splits a paste into certificate DER bytes, counting the private key blocks it skips. */
export function splitInput(text: string): SplitResult {
  let blocks;
  try {
    // The count of blocks is checked by the caller against its own limit, so no cap is asked for here.
    blocks = pemBlocks(text, Number.MAX_SAFE_INTEGER);
  } catch (err) {
    if (err instanceof PemError) throw pemFailure(text, err);
    throw err;
  }
  if (blocks.length === 0) return { items: [rawBytes(text)], ignored: [] };
  const items: Uint8Array[] = [];
  const counts = new Map<string, number>();
  for (const block of blocks) {
    if (CERTIFICATE_LABELS.has(block.label)) {
      items.push(block.body);
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
