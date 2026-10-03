/**
 * A ZIP of generated tiles, written by fflate's `zipSync` at level 0, which stores each entry as it is (method 0): PNG and
 * JPEG are already compressed, so a second pass would only cost time. The layout is the one PKWARE's APPNOTE.TXT
 * describes (4.3.7 local file header, 4.3.12 central directory header, 4.3.16 end of central directory record).
 *
 * The same tiles always give the same bytes. fflate writes an entry's modification time from the LOCAL fields of a Date
 * (its year, month, day, hours, minutes and seconds as the machine's time zone shows them), and refuses a date before
 * 1980, so the Date is built from local fields, `new Date(1980, 0, 1, 0, 0, 0)`: every time zone then writes the DOS date
 * 1980-01-01 and the time 00:00:00. (A Date made from `Date.UTC(1980, 0, 1)` would read as 31 December 1979 west of
 * Greenwich, which fflate refuses, and as 1 January at some later hour east of it, which would change the bytes.)
 *
 * Entry names are only ever the generated tile names, checked here against a short list of safe characters, so a name can
 * never hold a path, a drive or a way out of the folder the ZIP is opened in.
 */
import { zipSync, type Zippable } from 'fflate';
import { ImageSplitterError, MAX_TILES } from './tiles';

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/** The tiles of one ZIP may hold this many bytes together (the ZIP is built in memory, with no ZIP64 record). */
export const MAX_ZIP_BYTES = 1024 * 1024 * 1024;

/** Returns `total` when it is at most 1 GB, otherwise refuses it. Called as each tile is made, so a run stops early. */
export function checkZipTotal(total: number): number {
  if (total > MAX_ZIP_BYTES) {
    throw new ImageSplitterError('The tiles together are larger than 1 GB, which this page does not put in one ZIP.');
  }
  return total;
}

/**
 * A to z, A to Z, 0 to 9, hyphen, underscore and dot; 1 to 64 characters; not starting with a dot; and with a dot that is
 * neither first nor last, so the name has an extension. (A bare `__proto__` would be written by fflate onto the prototype
 * of its own working object, and every generated tile name has an extension anyway.)
 */
function isPlainName(name: string): boolean {
  if (name.length < 1 || name.length > 64 || name.charCodeAt(0) === 46) return false;
  const dot = name.lastIndexOf('.');
  if (dot < 1 || dot > name.length - 2) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const ok =
      (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 45 || c === 95 || c === 46;
    if (!ok) return false;
  }
  return true;
}

/**
 * Stores the entries, in the order given, in one ZIP. Refuses more than 400 entries, a name that is not a plain generated
 * name, two entries with the same name (compared without regard to case, because some systems would overwrite one with
 * the other) and more than 1 GB of bytes.
 */
export function zipTiles(entries: ZipEntry[]): Uint8Array {
  if (entries.length > MAX_TILES) {
    throw new ImageSplitterError(`A ZIP of tiles holds at most ${MAX_TILES} entries.`);
  }
  const seen = new Set<string>();
  let total = 0;
  // An object with no prototype, so even an entry named __proto__ is just a name.
  const files: Zippable = Object.create(null) as Zippable;
  for (const entry of entries) {
    if (!isPlainName(entry.name)) {
      throw new ImageSplitterError('A ZIP entry name may hold only letters, digits, hyphens, dots and underscores.');
    }
    const key = entry.name.toLowerCase();
    if (seen.has(key)) throw new ImageSplitterError('Two ZIP entries have the same name.');
    seen.add(key);
    total = checkZipTotal(total + entry.bytes.length);
    files[entry.name] = entry.bytes;
  }
  // Built here, at every call, from local fields: a Date made once would be one instant, and an instant is a different
  // local time when the time zone differs.
  return zipSync(files, { level: 0, mtime: new Date(1980, 0, 1, 0, 0, 0) });
}
