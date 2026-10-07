import { decodeHeaderBytes } from './charset';
import { MAX_HEADERS, MAX_HEADER_BYTES, withCommas } from './limits';

const LF = 10;
const CR = 13;
const SP = 32;
const HT = 9;
const COLON = 58;

/** One header field as written: its name as written, and its value with the folds taken out and the ends trimmed. */
export interface RawField {
  name: string;
  /** The unfolded value: each line break that was followed by white space is removed, the white space stays. */
  value: string;
  /** The byte offsets of the whole field in the message, folds included, line ends excluded from `end`. */
  start: number;
  end: number;
}

/** The result of reading one header block. */
export interface HeaderBlock {
  fields: RawField[];
  /** Where the body starts: after the empty line, or the end of the data when there was none. */
  bodyStart: number;
  /** True when an empty line ended the block. */
  blankLine: boolean;
  /** True when a field cap stopped the reading of fields (the body start is still found). */
  stopped: boolean;
  notes: string[];
}

/** Where the line that starts at `pos` ends: the index of its CR or LF, or `end` when it has no line end. */
export function lineEndAt(bytes: Uint8Array, pos: number, end: number): number {
  let i = pos;
  while (i < end) {
    const byte = bytes[i];
    if (byte === LF || byte === CR) return i;
    i++;
  }
  return end;
}

/** Where the next line starts, given the index of a line's terminator: CRLF is one terminator, so are LF and CR alone. */
export function afterLineEnd(bytes: Uint8Array, lineEnd: number, end: number): number {
  if (lineEnd >= end) return end;
  if (bytes[lineEnd] === CR && lineEnd + 1 < end && bytes[lineEnd + 1] === LF) return lineEnd + 2;
  return lineEnd + 1;
}

/** Removes spaces and tabs from both ends (not the other white space characters a text may hold). */
export function trimWsp(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && (text.charCodeAt(start) === SP || text.charCodeAt(start) === HT)) start++;
  while (end > start && (text.charCodeAt(end - 1) === SP || text.charCodeAt(end - 1) === HT)) end--;
  return start === 0 && end === text.length ? text : text.slice(start, end);
}

function isFieldNameByte(byte: number): boolean {
  return byte >= 33 && byte <= 126 && byte !== COLON;
}

function startsWithFromSpace(bytes: Uint8Array, pos: number, end: number): boolean {
  return (
    pos + 5 <= end &&
    bytes[pos] === 0x46 &&
    bytes[pos + 1] === 0x72 &&
    bytes[pos + 2] === 0x6f &&
    bytes[pos + 3] === 0x6d &&
    bytes[pos + 4] === SP
  );
}

/**
 * Reads the header block that starts at `start`: fields in message order with repeats kept, folded lines unfolded,
 * stopping at the first empty line (CRLF CRLF, LF LF or CR CR) or at the first line that cannot be a header. A leading
 * mbox From line is skipped and said when `allowMbox` is set. A field over 64 KiB or more than 2,000 fields stop the
 * reading of fields with a note, and the body start is still found by reading the lines without keeping them. One pass.
 */
export function splitHeaderBlock(
  bytes: Uint8Array,
  start: number = 0,
  end: number = bytes.length,
  allowMbox = false,
): HeaderBlock {
  const fields: RawField[] = [];
  const notes: string[] = [];
  let pos = start;
  let stopped = false;
  let bodyStart = end;
  let blankLine = false;

  // The field being read: the offsets of each of its lines' content, so a folded field is joined once at its end.
  let name = '';
  let fieldStart = -1;
  let valueStarts: number[] = [];
  let valueEnds: number[] = [];
  let rawBytes = 0;
  let tooLong = false;

  const finish = (fieldEnd: number): void => {
    if (fieldStart < 0) return;
    if (!tooLong && !stopped) {
      let value: string;
      if (valueStarts.length === 1) {
        value = decodeHeaderBytes(bytes.subarray(valueStarts[0] ?? 0, valueEnds[0] ?? 0));
      } else {
        let total = 0;
        for (let i = 0; i < valueStarts.length; i++) total += (valueEnds[i] ?? 0) - (valueStarts[i] ?? 0);
        const joined = new Uint8Array(total);
        let at = 0;
        for (let i = 0; i < valueStarts.length; i++) {
          const piece = bytes.subarray(valueStarts[i] ?? 0, valueEnds[i] ?? 0);
          joined.set(piece, at);
          at += piece.length;
        }
        value = decodeHeaderBytes(joined);
      }
      fields.push({ name, value: trimWsp(value), start: fieldStart, end: fieldEnd });
    }
    fieldStart = -1;
    valueStarts = [];
    valueEnds = [];
    rawBytes = 0;
    tooLong = false;
  };

  let first = true;
  let lastLineEnd = pos;
  while (pos < end) {
    const lineEnd = lineEndAt(bytes, pos, end);
    const next = afterLineEnd(bytes, lineEnd, end);

    if (lineEnd === pos) {
      // The empty line that ends the block.
      finish(lastLineEnd);
      bodyStart = next;
      blankLine = true;
      pos = end;
      break;
    }

    const lead = bytes[pos];
    if (lead === SP || lead === HT) {
      if (fieldStart < 0 && fields.length === 0 && !stopped) {
        // A continuation line with nothing to continue: the block ends here and this line starts the body.
        notes.push(
          'The first line of the message starts with white space, so it is not a header; the rest is read as the body.',
        );
        bodyStart = pos;
        pos = end;
        break;
      }
      if (fieldStart >= 0 && !stopped) {
        rawBytes += lineEnd - pos;
        if (rawBytes > MAX_HEADER_BYTES && !tooLong) {
          tooLong = true;
          notes.push(
            `A header is longer than ${withCommas(MAX_HEADER_BYTES)} bytes (64 KiB), so it and the headers after it were not read.`,
          );
          stopped = true;
        }
        if (!tooLong) {
          valueStarts.push(pos);
          valueEnds.push(lineEnd);
        }
      }
      lastLineEnd = lineEnd;
      pos = next;
      continue;
    }

    // A new field. First close the one before it.
    finish(lastLineEnd);

    let colon = -1;
    let valid = true;
    for (let i = pos; i < lineEnd; i++) {
      const byte = bytes[i] ?? 0;
      if (byte === COLON) {
        colon = i;
        break;
      }
      if (!isFieldNameByte(byte)) {
        valid = false;
        break;
      }
    }

    if (colon <= pos || !valid) {
      if (first && allowMbox && startsWithFromSpace(bytes, pos, end)) {
        notes.push('The first line is an mbox From line, not a header, so it was skipped.');
        first = false;
        lastLineEnd = lineEnd;
        pos = next;
        continue;
      }
      // Not a header: the block ends here and this line starts the body.
      if (fields.length > 0 || stopped) {
        notes.push('A line that is not a header ended the header block, so the rest is read as the body.');
      } else {
        notes.push('The first line is not a header, so all of it is read as a body.');
      }
      bodyStart = pos;
      pos = end;
      break;
    }
    first = false;

    if (stopped) {
      // Reading continues only to find where the body starts.
      fieldStart = pos;
      lastLineEnd = lineEnd;
      pos = next;
      continue;
    }
    if (fields.length >= MAX_HEADERS) {
      stopped = true;
      notes.push(`The message has more than ${withCommas(MAX_HEADERS)} headers, so the rest were not read.`);
      fieldStart = pos;
      lastLineEnd = lineEnd;
      pos = next;
      continue;
    }

    name = decodeHeaderBytes(bytes.subarray(pos, colon));
    fieldStart = pos;
    valueStarts = [colon + 1];
    valueEnds = [lineEnd];
    rawBytes = lineEnd - pos;
    if (rawBytes > MAX_HEADER_BYTES) {
      tooLong = true;
      stopped = true;
      notes.push(
        `A header is longer than ${withCommas(MAX_HEADER_BYTES)} bytes (64 KiB), so it and the headers after it were not read.`,
      );
    }
    lastLineEnd = lineEnd;
    pos = next;
  }

  if (!blankLine) finish(lastLineEnd);

  return { fields, bodyStart, blankLine, stopped, notes };
}
