import meta from './meta.json';
import { orderChains, type ChainResult } from './chain';
import { isRequestDer, readCsr, type CsrInfo } from './csr';
import { DerError } from './der';
import {
  CertificateError,
  NO_CERTIFICATE_MESSAGE,
  noCertificateMessage,
  splitFile,
  splitInput,
  type Source,
  type SplitResult,
} from './input';
import { PemError } from './pem';
import { readCertificate, type CertificateInfo } from './x509';

export { meta };
export { CertificateError, NO_CERTIFICATE_MESSAGE };
export { DerError, PemError };
export { orderChains, readCsr };
export type { CertificateInfo, CsrInfo };
export type { ChainResult, ChainRole, StopReason } from './chain';
export type { CsrAttribute } from './csr';
export type { ExtensionInfo } from './extensions';
export type { NameInfo } from './names';

/** The longest paste read, in characters. */
export const MAX_PASTE_CHARS = 1048576;
/** The largest file read, in bytes (1 MiB). */
export const MAX_FILE_BYTES = 1048576;
/** The most certificates and requests read from one paste or file. */
export const MAX_ITEMS = 100;
/** The most rows one table shows across the whole page, counting every certificate in the paste. */
export const MAX_TABLE_ROWS = 5000;

export const UNREADABLE_MESSAGE = 'This does not look like a certificate or request (it could not be read as DER).';

export interface DecodeResult {
  items: (CertificateInfo | CsrInfo)[];
  /** The certificates in issuing order, by position in items; found by comparing names, not verified. */
  chains: ChainResult[];
  /** Positions in items of exact repeats of an earlier certificate. */
  duplicates: number[];
  ignored: { label: string; count: number }[];
  warnings: string[];
}

function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Refuses a file by its size, before any of it is read. The page calls this with the size the browser reports for the file,
 * so a file over the limit is never turned into bytes at all.
 */
export function checkFileSize(byteLength: number): void {
  if (byteLength > MAX_FILE_BYTES) {
    throw new CertificateError(
      `This file is ${withCommas(byteLength)} bytes. The limit is 1 MiB because larger files are not certificates.`,
    );
  }
}

/**
 * Cuts the two long tables to their limit, counting the rows of every certificate and request in the paste together, and
 * says in each item's warnings how many rows were left out.
 */
function capRows(items: (CertificateInfo | CsrInfo)[]): void {
  let names = MAX_TABLE_ROWS;
  let extensions = MAX_TABLE_ROWS;
  const limit = withCommas(MAX_TABLE_ROWS);
  for (const item of items) {
    if (item.sans.length > names) {
      const total = item.sans.length;
      item.sans = item.sans.slice(0, names);
      item.warnings.push(
        `${withCommas(total - names)} of ${withCommas(total)} subject alternative names are not shown, because a table shows at most ${limit} rows across the page.`,
      );
    }
    names -= item.sans.length;
    if (item.extensions.length > extensions) {
      const total = item.extensions.length;
      item.extensions = item.extensions.slice(0, extensions);
      item.warnings.push(
        `${withCommas(total - extensions)} of ${withCommas(total)} extensions are not shown, because a table shows at most ${limit} rows across the page.`,
      );
    }
    extensions -= item.extensions.length;
  }
}

function emptyResult(): DecodeResult {
  return { items: [], chains: [], duplicates: [], ignored: [], warnings: [] };
}

/**
 * Reads every certificate and request in a paste (a string) or a file (its bytes: DER, or text as in a paste). An empty or
 * blank input gives nothing and no error. The size is measured, and the number of items counted, before any of them is
 * parsed. Any failure that is not one of this package's own sentences becomes one plain sentence, so a hostile input never
 * surfaces a raw exception. Nothing is kept between calls: the same input always gives an equal, new result.
 */
export function decodeInput(input: string | Uint8Array, options: { nowMs: number }): DecodeResult {
  try {
    const source: Source = typeof input === 'string' ? 'paste' : 'file';
    let split: SplitResult;
    if (typeof input === 'string') {
      if (input.length > MAX_PASTE_CHARS) {
        throw new CertificateError(
          `This paste is ${withCommas(input.length)} characters. The limit is ${withCommas(MAX_PASTE_CHARS)} because larger pastes are not certificates.`,
        );
      }
      if (input.trim() === '') return emptyResult();
      split = splitInput(input, 'paste');
    } else {
      checkFileSize(input.length);
      if (input.length === 0) return emptyResult();
      split = splitFile(input);
      if (split.items.length === 0 && split.ignored.length === 0) return emptyResult();
    }
    if (split.items.length > MAX_ITEMS) {
      throw new CertificateError(
        `This ${source} holds ${withCommas(split.items.length)} certificates or requests. The limit is ${MAX_ITEMS}.`,
      );
    }
    if (split.items.length === 0) {
      const nothing = source === 'paste' ? NO_CERTIFICATE_MESSAGE : noCertificateMessage(source);
      throw new CertificateError(`${nothing} Private key blocks in a ${source} are ignored and never shown.`);
    }
    const items: (CertificateInfo | CsrInfo)[] = [];
    split.items.forEach((entry, index) => {
      const kind = entry.kind ?? (isRequestDer(entry.der) ? 'request' : 'certificate');
      try {
        items.push(kind === 'request' ? readCsr(entry.der) : readCertificate(entry.der, options.nowMs));
      } catch (err) {
        if (err instanceof DerError || err instanceof PemError) {
          const noun = kind === 'request' ? 'request' : 'certificate';
          const which =
            split.items.length > 1
              ? `${noun === 'request' ? 'Request' : 'Certificate'} ${index + 1} of ${split.items.length}`
              : `The ${noun}`;
          throw new CertificateError(`${which} could not be read: ${err.message}`);
        }
        throw err;
      }
    });
    capRows(items);
    // The order is found among the certificates only (a request is nobody's issuer); positions are those of items.
    const places: number[] = [];
    const certificates: CertificateInfo[] = [];
    items.forEach((item, at) => {
      if (item.kind === 'certificate') {
        places.push(at);
        certificates.push(item);
      }
    });
    const ordered = orderChains(certificates);
    const chains = ordered.chains.map((chain) => ({ ...chain, order: chain.order.map((at) => places[at]!) }));
    const duplicates = ordered.duplicates.map((at) => places[at]!);
    return { items, chains, duplicates, ignored: split.ignored, warnings: [] };
  } catch (err) {
    if (err instanceof CertificateError) throw err;
    if (err instanceof DerError || err instanceof PemError) throw err;
    throw new CertificateError(UNREADABLE_MESSAGE);
  }
}
