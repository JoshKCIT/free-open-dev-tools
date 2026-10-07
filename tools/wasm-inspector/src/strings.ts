import { MAX_SHOWN_NAME, MAX_STRINGS, MAX_STRING_SCAN_BYTES, MIN_STRING_LENGTH } from './limits';

/** A run of printable text found inside a data segment. */
export interface StringItem {
  /** The text, at most `MAX_SHOWN_NAME` characters (longer runs end with an ellipsis). */
  text: string;
  /** The offset in the file of the first byte of the run. */
  offset: number;
  /** The index of the data segment it was found in. */
  segment: number;
  /** The length of the whole run in bytes. */
  length: number;
}

export interface StringsReport {
  /** At most `MAX_STRINGS` runs, in file order. */
  items: StringItem[];
  /** How many runs were found in all (those not kept included). */
  total: number;
  /** How many data segment bytes were looked at. */
  scanned: number;
  /** True when some data segment bytes were not looked at because of the 8 MiB limit. */
  truncated: boolean;
}

function isPrintable(byte: number): boolean {
  return byte >= 0x20 && byte <= 0x7e;
}

/**
 * Finds runs of at least `MIN_STRING_LENGTH` printable ASCII bytes inside data segments. `spans` holds three numbers for
 * each segment worth looking at: its index, the offset of its first byte in the file, and its size. At most
 * `MAX_STRING_SCAN_BYTES` bytes are looked at in all; `skipped` is the number of segment bytes the caller left out of
 * `spans` for that same reason. A run never crosses a segment.
 */
export function findStrings(bytes: Uint8Array, spans: readonly number[], skipped = 0): StringsReport {
  const report: StringsReport = { items: [], total: 0, scanned: 0, truncated: skipped > 0 };
  for (let s = 0; s + 2 < spans.length; s += 3) {
    const segment = spans[s]!;
    const start = spans[s + 1]!;
    let size = spans[s + 2]!;
    const room = MAX_STRING_SCAN_BYTES - report.scanned;
    if (room <= 0) {
      report.truncated = true;
      break;
    }
    if (size > room) {
      size = room;
      report.truncated = true;
    }
    report.scanned += size;
    const end = start + size;
    let runStart = -1;
    for (let i = start; i <= end; i++) {
      const printable = i < end && isPrintable(bytes[i]!);
      if (printable) {
        if (runStart < 0) runStart = i;
        continue;
      }
      if (runStart >= 0) {
        const length = i - runStart;
        if (length >= MIN_STRING_LENGTH) {
          report.total++;
          if (report.items.length < MAX_STRINGS) {
            const shown = Math.min(length, MAX_SHOWN_NAME);
            let text = '';
            for (let k = 0; k < shown; k++) text += String.fromCharCode(bytes[runStart + k]!);
            if (length > shown) text += '…';
            report.items.push({ text, offset: runStart, segment, length });
          }
        }
        runStart = -1;
      }
    }
  }
  return report;
}
