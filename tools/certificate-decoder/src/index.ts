import meta from './meta.json';
import { DerError } from './der';
import { CertificateError, NO_CERTIFICATE_MESSAGE, splitInput } from './input';
import { PemError } from './pem';
import { readCertificate, type CertificateInfo } from './x509';

export { meta };
export { CertificateError, NO_CERTIFICATE_MESSAGE };
export { DerError, PemError };
export type { CertificateInfo };
export type { ExtensionInfo } from './extensions';
export type { NameInfo } from './names';

/** The longest paste read, in characters. */
export const MAX_PASTE_CHARS = 1048576;
/** The most certificates read from one paste. */
export const MAX_ITEMS = 100;
/** The most rows one table shows across the whole page, counting every certificate in the paste. */
export const MAX_TABLE_ROWS = 5000;

export const UNREADABLE_MESSAGE = 'This does not look like a certificate or request (it could not be read as DER).';

export interface DecodeResult {
  items: CertificateInfo[];
  ignored: { label: string; count: number }[];
  warnings: string[];
}

function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Cuts the two long tables to their limit, counting the rows of every certificate in the paste together, and says in each
 * certificate's warnings how many rows were left out.
 */
function capRows(items: CertificateInfo[]): void {
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

/**
 * Reads every certificate in a paste. An empty or blank paste gives nothing and no error. The paste is measured, and the
 * number of certificates counted, before any of them is parsed. Any failure that is not one of this package's own
 * sentences becomes one plain sentence, so a hostile paste never surfaces a raw exception.
 */
export function decodeInput(input: string, options: { nowMs: number }): DecodeResult {
  try {
    if (input.length > MAX_PASTE_CHARS) {
      throw new CertificateError(
        `This paste is ${withCommas(input.length)} characters. The limit is ${withCommas(MAX_PASTE_CHARS)} because larger pastes are not certificates.`,
      );
    }
    if (input.trim() === '') return { items: [], ignored: [], warnings: [] };
    const split = splitInput(input);
    if (split.items.length > MAX_ITEMS) {
      throw new CertificateError(
        `This paste holds ${withCommas(split.items.length)} certificates or requests. The limit is ${MAX_ITEMS}.`,
      );
    }
    if (split.items.length === 0) {
      throw new CertificateError(
        `${NO_CERTIFICATE_MESSAGE} Private key blocks in a paste are ignored and never shown.`,
      );
    }
    const items: CertificateInfo[] = [];
    split.items.forEach((der, index) => {
      try {
        items.push(readCertificate(der, options.nowMs));
      } catch (err) {
        if (err instanceof DerError || err instanceof PemError) {
          const which =
            split.items.length > 1 ? `Certificate ${index + 1} of ${split.items.length}` : 'The certificate';
          throw new CertificateError(`${which} could not be read: ${err.message}`);
        }
        throw err;
      }
    });
    capRows(items);
    return { items, ignored: split.ignored, warnings: [] };
  } catch (err) {
    if (err instanceof CertificateError) throw err;
    if (err instanceof DerError || err instanceof PemError) throw err;
    throw new CertificateError(UNREADABLE_MESSAGE);
  }
}
