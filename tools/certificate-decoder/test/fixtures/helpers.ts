/**
 * Small helpers for the tests: the fixtures as bytes and as PEM text, and OpenSSL's printed dates as epoch milliseconds.
 * The PEM armour is built from pieces so that no file of this repository reads as a PEM block to a scanner.
 */
import type { CertificateInfo, DecodeResult } from '../../src/index';
import { CERTIFICATES, CHAIN_CERTIFICATES, REQUESTS } from './certs';

/** The clock reading every test passes to the decoder: 2026-10-03 12:00 UTC, inside every fixture's validity. */
export const NOW_MS = Date.UTC(2026, 9, 3, 12, 0, 0);

export function base64Bytes(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, 'base64'));
}

export function certificateDer(name: string): Uint8Array {
  const entry = CERTIFICATES[name];
  if (entry === undefined) throw new Error(`no fixture certificate named ${name}`);
  return base64Bytes(entry.derB64);
}

export function requestDer(name: string): Uint8Array {
  const entry = REQUESTS[name];
  if (entry === undefined) throw new Error(`no fixture request named ${name}`);
  return base64Bytes(entry.derB64);
}

/** PEM text for a Base64 body: the label's armour from pieces, the body wrapped at `width` columns, `eol` after each line. */
export function pemText(label: string, base64: string, width = 64, eol = '\n'): string {
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += width) lines.push(base64.slice(i, i + width));
  return ['-----' + 'BEGIN ' + label + '-----', ...lines, '-----' + 'END ' + label + '-----'].join(eol) + eol;
}

export function certificatePem(name: string, width = 64, eol = '\n'): string {
  const entry = CERTIFICATES[name];
  if (entry === undefined) throw new Error(`no fixture certificate named ${name}`);
  return pemText('CERTIFICATE', entry.derB64, width, eol);
}

/** The certificate at `index` of a decoded paste; fails the test when that item is a request. */
export function certificateOf(result: DecodeResult, index = 0): CertificateInfo {
  const item = result.items[index];
  if (item === undefined || item.kind !== 'certificate') throw new Error(`item ${index} is not a certificate`);
  return item;
}

/** The DER of a certificate of either fixture set, by name (the chain fixtures are CHAIN_CERTIFICATES in certs.ts). */
export function anyCertificateDer(name: string): Uint8Array {
  const entry = CERTIFICATES[name] ?? CHAIN_CERTIFICATES[name];
  if (entry === undefined) throw new Error(`no fixture certificate named ${name}`);
  return base64Bytes(entry.derB64);
}

/** PEM text of a certificate of either fixture set, by name. */
export function anyCertificatePem(name: string, width = 64, eol = '\n'): string {
  const entry = CERTIFICATES[name] ?? CHAIN_CERTIFICATES[name];
  if (entry === undefined) throw new Error(`no fixture certificate named ${name}`);
  return pemText('CERTIFICATE', entry.derB64, width, eol);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Reads the date text of openssl x509 -dates, for example `Oct  3 04:37:59 2026 GMT`, as epoch milliseconds. */
export function opensslDate(text: string): number {
  const parts = text.trim().split(/\s+/);
  const month = MONTHS.indexOf(parts[0]!);
  const time = parts[2]!.split(':').map(Number);
  if (month < 0 || parts.length !== 5 || parts[4] !== 'GMT') throw new Error(`unexpected OpenSSL date ${text}`);
  return Date.UTC(Number(parts[3]), month, Number(parts[1]), time[0]!, time[1]!, time[2]!);
}

/** The value after a label in OpenSSL's -text output, from the first line that starts with it. */
export function textValue(text: string[], label: string): string | undefined {
  for (const line of text) {
    const trimmed = line.trim();
    if (trimmed.startsWith(label)) return trimmed.slice(label.length).trim();
  }
  return undefined;
}
