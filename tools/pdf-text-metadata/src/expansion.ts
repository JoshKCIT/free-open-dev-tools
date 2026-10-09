/**
 * Bounding how much a PDF expands before a reader sees it.
 *
 * Why this exists: Flate (zlib) data can expand about a thousand times, so a PDF under one megabyte can hold a content
 * stream or an object stream that decodes to hundreds of megabytes. PDF.js decodes a page's content stream when its text
 * is read, and pdf-lib decodes every object stream when it loads a file, so such a file can exhaust the memory of the tab
 * long before a time limit fires. The 100 MB limit of this tool is on the compressed file only. `checkExpansion` finds
 * every stream in the bytes, runs it through the filters its dictionary names, and counts the decoded bytes without
 * keeping them, stopping the moment a cap is passed.
 *
 * What it reads: ISO 32000-1:2008 section 7.3.8 (a stream is a dictionary, the keyword `stream`, an end-of-line, the
 * data and `endstream`), section 7.4 (the filters: `/Filter` is a name or an array of names applied in order, and a
 * filter can also be written with its abbreviation), section 7.4.4 (FlateDecode, RFC 1950 and RFC 1951), section 7.4.4.2
 * (LZWDecode and its `/EarlyChange` entry), sections 7.4.2, 7.4.3 and 7.4.5 (ASCIIHexDecode, ASCII85Decode,
 * RunLengthDecode). Every stage of a chain is counted, so a doubled filter (`/Filter [/FlateDecode /FlateDecode]`) costs
 * both stages. A stream whose dictionary says `/Subtype /Image` is not counted while it is only an image: neither library
 * decodes an image to read text or metadata, and a large photograph is a legitimate file. The label is read the way a
 * reader reads the dictionary (section 7.3.7): only the dictionary's own `/Subtype` entries count, every one of them must
 * say `/Image`, and a label written inside a string, a nested dictionary or an array is no label, so a form, the metadata
 * or any other stream that only carries such text is counted like every other stream. But the readers do not look at
 * that label when they decode a stream a page, a font or the file's own structure uses (PDF.js was run on a picture-
 * labelled stream under each of these keys and decoded all of them), so a picture-labelled stream is counted when:
 * a page's `/Contents` points at it, as one reference, an array of references or an indirect array (section 7.8.2); a
 * `/FontFile`, `/FontFile2`, `/FontFile3`, `/ToUnicode`, `/CIDToGIDMap` or `/Encoding` entry points at it, or a
 * `/CharProcs` dictionary does (sections 9.6 to 9.10); or its own dictionary says `/Type /ObjStm` or `/Type /XRef`
 * (sections 7.5.7 and 7.5.8), which is counted whether anything points at it or not. Pictures used only as images, soft
 * masks or masks stay free. The image filters (DCT, CCITT, JBIG2, JPX) are never run; a chain stops at the first filter
 * this module does not decode.
 *
 * How a picture is found to be used: the first pass over the file's streams notes each stream's object number (the
 * `number generation obj` just before its dictionary), holds every picture-labelled stream as a view of the file (no
 * copy, at most `MAX_HELD_PICTURES` = 20,000), keeps the decoded data of every object stream (at most 8 MiB each and
 * 32 MiB in all, at most 20,000 streams) and joins the bytes outside stream data with a space (at most 32 MiB), so
 * binary stream data can never produce a reference. The reference scan then reads that text and the object stream data,
 * with name escapes undone (section 7.3.5), using bounded patterns and a forward-only search for the closing bracket so a
 * hostile file cannot make it slow. A second pass decodes the used pictures through the same filters, the same meter and
 * the same caps. A picture used twice is decoded once. A picture whose object number cannot be read (a comment or a long
 * run of white space between `obj` and its dictionary, which a reader allows, section 7.2.3) can never be matched to a
 * use, so it is counted whether anything uses it or not: the check fails closed.
 *
 * How streams are found: by their keyword, with the dictionary read back from the `>>` just before it. When that
 * dictionary's own text ends inside a string or a comment, the keyword is text and not a stream (a page string may hold
 * `>> stream`). A stream is trusted only when an object header stands before its dictionary and its `/Length` lands on
 * `endstream`; the data of a trusted stream is skipped. Any other stream (no header, no usable length, or a dictionary
 * that could not be read back, as in a string longer than the 64 KiB the search reads back) may be text that only looks
 * like a stream, so it hides nothing: the search goes on inside its data and its bytes stay in the text searched for
 * references, each byte once. The search for `endstream` remembers its last answer, so the whole search stays linear.
 *
 * What it does not do: it is a bound, not a parser of everything PDF.js and pdf-lib read. It finds streams by their
 * keyword and reads the dictionary just before it, so a deliberately crafted file can still hide a stream from it: text
 * in a string written as a whole object, with an object header, a dictionary whose `/Length` is right and the word
 * `stream`, a reference past the first 32 MiB of text outside streams or the first
 * 8 MiB (32 MiB in all) of object stream data, a picture among more than 20,000 picture streams, an array of references
 * longer than 64 KiB, or a reference written in a way no pattern here reads. A page string that literally reads
 * `/Contents 12 0 R` where object 12 is a picture makes that picture count, so a file can be refused for it (accepted:
 * a legitimate file does not do this). A stream that fails to inflate is left for the library to judge and is not
 * refused here. The decoded bytes of the stages are counted as they are produced and never held, except the object
 * stream data above, so the check itself needs only a few chunks of memory.
 *
 * Inflation is done by the platform's `DecompressionStream`; where a browser has none the check cannot run and
 * `expansionCheckAvailable()` says so. This file imports only the shared module, so the removal worker can import it by
 * path without pulling PDF.js in.
 */
import { PdfToolError } from './shared';

/** One stream may decode to at most this many bytes at any one stage of its filters. */
export const MAX_STREAM_DECODED_BYTES = 64 * 1024 * 1024;

/** Every stage of every stream together may decode to at most this many bytes. */
export const MAX_TOTAL_DECODED_BYTES = 256 * 1024 * 1024;

/** The plain sentence a visitor sees. It never holds a byte of the file. */
export const EXPANSION_MESSAGE = 'This PDF expands to more data than this page can hold in memory.';

/** The bytes outside stream data that are searched for references to pictures; the rest of the file is not searched. */
const MAX_REFERENCE_TEXT_BYTES = 32 * 1024 * 1024;

/** Picture-labelled streams held (as views of the file) while the references are found; the rest stay exempt. */
const MAX_HELD_PICTURES = 20_000;

/** An array or dictionary of references is read only when its end is within this many characters. */
const MAX_ARRAY_WINDOW = 64 * 1024;

/** The decoded data of one object stream is kept for the reference scan up to this many bytes. */
const MAX_OBJECT_STREAM_TEXT_BYTES = 8 * 1024 * 1024;

/** The decoded data of all object streams together is kept up to this many bytes. */
const MAX_RETAINED_BYTES = 32 * 1024 * 1024;

/** At most this many object streams are kept. */
const MAX_RETAINED_OBJECT_STREAMS = 20_000;

/** At most this many `/Contents` references are remembered while the objects they name are looked up. */
const MAX_INDIRECT_CANDIDATES = 100_000;

/** Of an object stream's header, at most this many characters and this many pairs are read. */
const MAX_OBJECT_STREAM_HEADER = 1024 * 1024;
const MAX_OBJECT_STREAM_OBJECTS = 100_000;

export interface ExpansionLimits {
  /** The most one stage of one stream may decode to. */
  perStream: number;
  /** The most all stages of all streams may decode to. */
  total: number;
}

export interface ExpansionOptions {
  /** Smaller caps than the defaults, for tests. */
  limits?: Partial<ExpansionLimits>;
  /** Stops the check; the rejection is the signal's own reason. */
  signal?: AbortSignal;
  /** Called now and then while the check runs, so a caller's stall watchdog can see progress. */
  onProgress?: () => void;
}

export interface ExpansionReport {
  /** Streams found. */
  streams: number;
  /** Streams that were decoded to count them (those with a decoding filter that were not images). */
  decoded: number;
  /** Streams left out because their dictionary says they are images and nothing but an image uses them. */
  images: number;
  /**
   * Picture-labelled streams that were counted after all because page content, a font, a map or an object stream uses
   * them. They are also in `decoded`, and never in `images`.
   */
  picturesCounted: number;
  /** The bytes counted, over every stage of every decoded stream. */
  decodedBytes: number;
}

class ExpansionExceeded extends Error {
  constructor() {
    super(EXPANSION_MESSAGE);
    this.name = 'ExpansionExceeded';
  }
}

/** True where the platform can inflate Flate data as a stream, which the check needs. */
export function expansionCheckAvailable(): boolean {
  return typeof DecompressionStream === 'function' && typeof TextDecoder === 'function';
}

/** What the stages of one run share: the running total, the caps and the callbacks. */
interface Counter {
  total: number;
  exceeded: boolean;
  sinceProgress: number;
  readonly perStream: number;
  readonly totalLimit: number;
  readonly signal: AbortSignal | undefined;
  readonly onProgress: (() => void) | undefined;
}

interface Meter {
  add(bytes: number): void;
}

/** A meter for one stage of one stream: it counts toward that stage's cap and toward the shared total. */
function stageMeter(counter: Counter): Meter {
  let own = 0;
  return {
    add(bytes) {
      if (counter.signal?.aborted) throw counter.signal.reason ?? new Error('The check was cancelled.');
      own += bytes;
      counter.total += bytes;
      if (own > counter.perStream || counter.total > counter.totalLimit) {
        counter.exceeded = true;
        throw new ExpansionExceeded();
      }
      counter.sinceProgress += bytes;
      if (counter.sinceProgress >= 1024 * 1024) {
        counter.sinceProgress = 0;
        counter.onProgress?.();
      }
    },
  };
}

type Chunks = AsyncIterable<Uint8Array>;
type Stage = (source: Chunks, meter: Meter, params: StageParams) => Chunks;

interface StageParams {
  earlyChange: number;
}

/** The input is handed to the inflater in pieces this big, so one write never decodes more than a few megabytes. */
const INFLATE_INPUT_CHUNK = 16 * 1024;

/** Stages that produce output do so in pieces of at most this many bytes. */
const OUTPUT_CHUNK = 64 * 1024;

async function* inflate(source: Chunks, meter: Meter): Chunks {
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let stopped = false;
  let pumpError: unknown;
  let pumpFailed = false;
  const pump = (async () => {
    try {
      for await (const chunk of source) {
        for (let at = 0; at < chunk.length && !stopped; at += INFLATE_INPUT_CHUNK) {
          await writer.write(
            chunk.subarray(at, Math.min(chunk.length, at + INFLATE_INPUT_CHUNK)) as Uint8Array<ArrayBuffer>,
          );
        }
        if (stopped) break;
      }
      await writer.close();
    } catch (err) {
      pumpFailed = true;
      pumpError = err;
      await writer.abort(err).catch(() => undefined);
    }
  })();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      meter.add(value.length);
      yield value;
    }
  } finally {
    // No more input is written, and what the inflater still holds is read and thrown away. The reader is not cancelled
    // while data is flowing: Node's own implementation of DecompressionStream can throw from an event handler it cannot
    // catch when a stream is cancelled mid-flow. What is left to read is at most what one 16 KiB piece decodes to.
    stopped = true;
    try {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // A stream that ends in an error has nothing more to give.
    }
    await pump;
  }
  if (pumpFailed) throw pumpError;
}

/** ASCIIHexDecode: pairs of hexadecimal digits, white space ignored, `>` ends the data, a last odd digit is padded. */
async function* asciiHex(source: Chunks, meter: Meter): Chunks {
  let out = new Uint8Array(OUTPUT_CHUNK);
  let used = 0;
  let high = -1;
  let ended = false;
  for await (const chunk of source) {
    for (let i = 0; i < chunk.length && !ended; i++) {
      const c = chunk[i]!;
      let digit = -1;
      if (c >= 0x30 && c <= 0x39) digit = c - 0x30;
      else if (c >= 0x41 && c <= 0x46) digit = c - 0x41 + 10;
      else if (c >= 0x61 && c <= 0x66) digit = c - 0x61 + 10;
      else if (c === 0x3e) ended = true;
      if (digit < 0) continue;
      if (high < 0) {
        high = digit;
        continue;
      }
      out[used++] = (high << 4) | digit;
      high = -1;
      if (used === out.length) {
        meter.add(used);
        yield out;
        out = new Uint8Array(OUTPUT_CHUNK);
        used = 0;
      }
    }
    if (ended) break;
  }
  if (high >= 0) out[used++] = high << 4;
  if (used > 0) {
    meter.add(used);
    yield out.subarray(0, used);
  }
}

/** ASCII85Decode: groups of five characters from `!` to `u` give four bytes, `z` gives four zeros, `~>` ends the data. */
async function* ascii85(source: Chunks, meter: Meter): Chunks {
  let out = new Uint8Array(OUTPUT_CHUNK);
  let used = 0;
  const group = [0, 0, 0, 0, 0];
  let held = 0;
  let ended = false;
  let tilde = false;
  const emit = (value: number, count: number) => {
    for (let k = 0; k < count; k++) out[used++] = (value >>> (24 - 8 * k)) & 0xff;
  };
  for await (const chunk of source) {
    for (let i = 0; i < chunk.length && !ended; i++) {
      const c = chunk[i]!;
      if (tilde) {
        ended = true;
        break;
      }
      if (c === 0x7e) {
        tilde = true;
        continue;
      }
      if (used + 4 > out.length) {
        meter.add(used);
        yield out.subarray(0, used);
        out = new Uint8Array(OUTPUT_CHUNK);
        used = 0;
      }
      if (c === 0x7a && held === 0) {
        emit(0, 4);
      } else if (c >= 0x21 && c <= 0x75) {
        group[held++] = c - 0x21;
        if (held === 5) {
          let value = 0;
          for (let k = 0; k < 5; k++) value = (value * 85 + group[k]!) >>> 0;
          emit(value, 4);
          held = 0;
        }
      }
    }
    if (ended) break;
  }
  if (held > 1) {
    for (let k = held; k < 5; k++) group[k] = 84;
    let value = 0;
    for (let k = 0; k < 5; k++) value = (value * 85 + group[k]!) >>> 0;
    emit(value, held - 1);
  }
  if (used > 0) {
    meter.add(used);
    yield out.subarray(0, used);
  }
}

/** RunLengthDecode: a length byte of 0 to 127 copies that many plus one bytes, 129 to 255 repeats the next byte, 128 ends. */
async function* runLength(source: Chunks, meter: Meter): Chunks {
  let out = new Uint8Array(OUTPUT_CHUNK);
  let used = 0;
  let literal = 0;
  let repeat = 0;
  let ended = false;
  for await (const chunk of source) {
    for (let i = 0; i < chunk.length && !ended; i++) {
      const c = chunk[i]!;
      if (literal > 0) {
        out[used++] = c;
        literal--;
      } else if (repeat > 0) {
        for (let k = 0; k < repeat; k++) {
          out[used++] = c;
          if (used === out.length) {
            meter.add(used);
            yield out;
            out = new Uint8Array(OUTPUT_CHUNK);
            used = 0;
          }
        }
        repeat = 0;
      } else if (c === 128) {
        ended = true;
      } else if (c < 128) {
        literal = c + 1;
      } else {
        repeat = 257 - c;
      }
      if (used + 128 > out.length) {
        meter.add(used);
        yield out.subarray(0, used);
        out = new Uint8Array(OUTPUT_CHUNK);
        used = 0;
      }
    }
    if (ended) break;
  }
  if (used > 0) {
    meter.add(used);
    yield out.subarray(0, used);
  }
}

/**
 * LZWDecode (ISO 32000-1:2008 section 7.4.4.2): codes of 9 to 12 bits written most significant bit first, 256 clears the
 * table, 257 ends the data, the first new code is 258, and with `/EarlyChange` 1 (the default) the code width grows one
 * code early. The table is kept as prefix, last byte and length arrays; a code is written out by walking back through it.
 */
async function* lzw(source: Chunks, meter: Meter, params: StageParams): Chunks {
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Int32Array(4096);
  for (let i = 0; i < 256; i++) {
    suffix[i] = i;
    length[i] = 1;
    prefix[i] = -1;
  }
  const early = params.earlyChange === 0 ? 0 : 1;
  let out = new Uint8Array(OUTPUT_CHUNK);
  let used = 0;
  let next = 258;
  let width = 9;
  let previous = -1;
  let buffer = 0;
  let bits = 0;
  let ended = false;

  const widthFor = (count: number): number => {
    const reach = count + early;
    if (reach >= 2048) return 12;
    if (reach >= 1024) return 11;
    if (reach >= 512) return 10;
    return 9;
  };
  // The first byte of the string a code stands for.
  const firstByte = (code: number): number => {
    let at = code;
    while (prefix[at]! >= 0) at = prefix[at]!;
    return suffix[at]!;
  };

  for await (const chunk of source) {
    for (let i = 0; i < chunk.length && !ended; i++) {
      buffer = ((buffer << 8) | chunk[i]!) & 0xfffff;
      bits += 8;
      while (bits >= width && !ended) {
        const code = (buffer >> (bits - width)) & ((1 << width) - 1);
        bits -= width;
        if (code === 256) {
          next = 258;
          width = 9;
          previous = -1;
          continue;
        }
        if (code === 257) {
          ended = true;
          break;
        }
        if (code < next) {
          if (previous >= 0 && next < 4096) {
            prefix[next] = previous;
            suffix[next] = firstByte(code);
            length[next] = length[previous]! + 1;
            next++;
          }
        } else if (code === next && previous >= 0 && next < 4096) {
          // The code being defined by this very step: the previous string followed by its own first byte.
          prefix[next] = previous;
          suffix[next] = firstByte(previous);
          length[next] = length[previous]! + 1;
          next++;
        } else {
          // A code that is not in the table: the data is damaged, so counting this stream stops here.
          ended = true;
          break;
        }
        const size = length[code]!;
        if (used + size > out.length) {
          meter.add(used);
          yield out.subarray(0, used);
          out = new Uint8Array(OUTPUT_CHUNK);
          used = 0;
        }
        let at = used + size - 1;
        for (let node = code; node >= 0; node = prefix[node]!) out[at--] = suffix[node]!;
        used += size;
        previous = code;
        width = widthFor(next);
      }
    }
    if (ended) break;
  }
  if (used > 0) {
    meter.add(used);
    yield out.subarray(0, used);
  }
}

const STAGES = new Map<string, Stage>([
  ['FlateDecode', inflate],
  ['Fl', inflate],
  ['LZWDecode', lzw],
  ['LZW', lzw],
  ['ASCII85Decode', ascii85],
  ['A85', ascii85],
  ['ASCIIHexDecode', asciiHex],
  ['AHx', asciiHex],
  ['RunLengthDecode', runLength],
  ['RL', runLength],
]);

// --- Finding the streams --------------------------------------------------------------------------------------------

const latin1 = typeof TextDecoder === 'function' ? new TextDecoder('latin1') : null;

/** Dictionaries are looked for this far back from the `stream` keyword, and no further. */
const MAX_DICT_BYTES = 64 * 1024;

function isSpace(c: number | undefined): boolean {
  return c === 0x00 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
}

/** True when the bytes at `at` spell `word`. */
function spells(bytes: Uint8Array, at: number, word: string): boolean {
  if (at < 0 || at + word.length > bytes.length) return false;
  for (let i = 0; i < word.length; i++) if (bytes[at + i] !== word.charCodeAt(i)) return false;
  return true;
}

/** The position of the next `word` at or after `from`, or -1. */
function find(bytes: Uint8Array, word: string, from: number): number {
  const first = word.charCodeAt(0);
  let at = bytes.indexOf(first, from);
  while (at >= 0) {
    if (spells(bytes, at, word)) return at;
    at = bytes.indexOf(first, at + 1);
  }
  return -1;
}

interface StreamDict {
  image: boolean;
  /** The dictionary says `/Type /ObjStm` (section 7.5.7): readers decode the stream whatever its other entries say. */
  objectStream: boolean;
  /** The dictionary says `/Type /XRef` (section 7.5.8): readers decode the stream whatever its other entries say. */
  xref: boolean;
  /** An object stream's `/First` (where its first object starts) and `/N` (how many it holds), when plain numbers. */
  first: number | null;
  count: number | null;
  /** The filter names in order, `[]` when the dictionary has no filter, `null` when they cannot be told. */
  filters: string[] | null;
  /** The `/Length` when it is a plain number. */
  length: number | null;
  earlyChange: number;
}

const UNKNOWN_DICT: StreamDict = {
  image: false,
  objectStream: false,
  xref: false,
  first: null,
  count: null,
  filters: null,
  length: null,
  earlyChange: 1,
};

/** The characters that end a name or a keyword besides white space (ISO 32000-1:2008 section 7.2.2). */
function isDelimiter(c: number): boolean {
  return (
    c === 0x28 ||
    c === 0x29 ||
    c === 0x3c ||
    c === 0x3e ||
    c === 0x5b ||
    c === 0x5d ||
    c === 0x7b ||
    c === 0x7d ||
    c === 0x2f ||
    c === 0x25
  );
}

/** What one forward reading of a dictionary's text finds. */
interface DictShape {
  /**
   * The text ends inside a string or a comment, so the `>>` it ends with is not the end of a dictionary to a reader and
   * the `stream` keyword after it is not the start of a stream.
   */
  endsInsideText: boolean;
  /**
   * The value of every `/Subtype` key of the outermost dictionary, with name escapes undone: the name, or `''` when the
   * value is not a name. Null when the text cannot be read the way a reader reads it: a `)` with no `(` before it, a
   * backslash outside a string, a comment, or an outermost dictionary that does not end exactly where the text ends.
   */
  subtypes: string[] | null;
}

/**
 * Reads a dictionary's text from its `<<` forward the way a reader does (ISO 32000-1:2008 sections 7.2 and 7.3): a
 * literal string runs to its balancing `)` with backslash escapes, a hexadecimal string to the next `>`, a comment to the
 * end of the line, and a nested dictionary or array is stepped over, so a `/Subtype /Image` inside any of them is not
 * one of this dictionary's own entries. Every character is looked at once or twice, so the work is linear.
 */
function shapeOf(text: string): DictShape {
  /** The open brackets, `<` for a dictionary and `[` for an array, outermost first. */
  const open: number[] = [];
  const subtypes: string[] = [];
  let readable = true;
  let closedAt = -1;
  let awaitingSubtype = false;
  const takeValue = (name: string): void => {
    if (!awaitingSubtype) return;
    subtypes.push(name);
    awaitingSubtype = false;
  };
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    // At the top level of the outermost dictionary: where its own keys and values are.
    const top = open.length === 1 && open[0] === 0x3c;
    if (c === 0x28) {
      if (top) takeValue('');
      let depth = 1;
      i++;
      while (i < text.length && depth > 0) {
        const d = text.charCodeAt(i);
        if (d === 0x5c) i++;
        else if (d === 0x28) depth++;
        else if (d === 0x29) depth--;
        i++;
      }
      if (depth > 0) return { endsInsideText: true, subtypes: null };
    } else if (c === 0x25) {
      readable = false;
      while (i < text.length && text.charCodeAt(i) !== 0x0a && text.charCodeAt(i) !== 0x0d) i++;
      if (i >= text.length) return { endsInsideText: true, subtypes: null };
    } else if (c === 0x29 || c === 0x5c) {
      readable = false;
      i++;
    } else if (c === 0x3c && text.charCodeAt(i + 1) === 0x3c) {
      if (top) takeValue('');
      open.push(0x3c);
      i += 2;
    } else if (c === 0x3c) {
      if (top) takeValue('');
      const end = text.indexOf('>', i + 1);
      if (end < 0) {
        readable = false;
        break;
      }
      i = end + 1;
    } else if (c === 0x3e && text.charCodeAt(i + 1) === 0x3e) {
      // A reader closes a dictionary only with `>>` and an array only with `]`; a stray one is not a close.
      if (open[open.length - 1] === 0x3c) {
        if (top) takeValue('');
        open.pop();
        if (open.length === 0 && closedAt < 0) closedAt = i + 2;
      }
      i += 2;
    } else if (c === 0x5b) {
      if (top) takeValue('');
      open.push(0x5b);
      i++;
    } else if (c === 0x5d) {
      if (open[open.length - 1] === 0x5b) open.pop();
      i++;
    } else if (c === 0x2f) {
      let end = i + 1;
      while (end < text.length && !isSpace(text.charCodeAt(end)) && !isDelimiter(text.charCodeAt(end))) end++;
      if (top) {
        const name = undoNameEscapes(text.slice(i + 1, end));
        if (awaitingSubtype) takeValue(name);
        else if (name === 'Subtype') awaitingSubtype = true;
      }
      i = end;
    } else if (isSpace(c)) {
      i++;
    } else {
      // A number, a keyword or any other run of regular characters: a value that is not a name.
      if (top) takeValue('');
      i++;
      while (i < text.length && !isSpace(text.charCodeAt(i)) && !isDelimiter(text.charCodeAt(i))) i++;
    }
  }
  if (awaitingSubtype) subtypes.push('');
  return { endsInsideText: false, subtypes: readable && closedAt === text.length ? subtypes : null };
}

/**
 * Reads the entries this check needs from the text of a stream's dictionary. The picture label is read from the
 * dictionary's own `/Subtype` entries only, as a reader reads them (`shape` is `shapeOf(text)`); the other entries are
 * found by pattern.
 */
function readDict(text: string, shape: DictShape): StreamDict {
  const { subtypes } = shape;
  // Every own Subtype says Image, so whichever one a reader keeps, it is a picture. A label inside a string, a nested
  // dictionary or an array, or a dictionary that cannot be read, is no label: such a stream is counted.
  const image = subtypes !== null && subtypes.length > 0 && subtypes.every((subtype) => subtype === 'Image');
  // The type of a stream may be written with name escapes too (section 7.3.5); the readers undo them.
  const plain = undoNameEscapes(text);
  const objectStream = /\/Type\s*\/ObjStm(?![A-Za-z0-9#])/.test(plain);
  const xref = /\/Type\s*\/XRef(?![A-Za-z0-9#])/.test(plain);
  const first = objectStream ? /\/First(?![A-Za-z0-9#])\s+(\d{1,10})/.exec(plain) : null;
  const count = objectStream ? /\/N(?![A-Za-z0-9#])\s+(\d{1,10})/.exec(plain) : null;
  let filters: string[] | null = [];
  const filter = /\/Filter(?![A-Za-z0-9#])\s*(\[[^\]]*\]|\/[^\s/[\]<>()%]+|\d+\s+\d+\s+R)/.exec(text);
  if (filter) {
    const value = filter[1]!;
    if (value.endsWith('R') && !value.startsWith('/') && !value.startsWith('[')) {
      filters = null; // an indirect reference: not followed
    } else {
      // A name may write any character as `#` and two hexadecimal digits (section 7.3.5), so `/F#6Cate#44ecode` is FlateDecode.
      filters = (value.match(/\/[^\s/[\]<>()%]+/g) ?? []).map((name) =>
        name.slice(1).replace(/#([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16))),
      );
    }
  }
  const lengthMatch = /\/Length(?![A-Za-z0-9#])\s+(\d{1,12})(?!\s+\d+\s+R)(?![\d])/.exec(text);
  const early = /\/EarlyChange(?![A-Za-z0-9#])\s+(\d)/.exec(text);
  return {
    image,
    objectStream,
    xref,
    first: first ? Number(first[1]) : null,
    count: count ? Number(count[1]) : null,
    filters,
    length: lengthMatch ? Number(lengthMatch[1]) : null,
    earlyChange: early ? Number(early[1]) : 1,
  };
}

/** What `dictBefore` answers when the `>>` before a `stream` keyword is inside a string or a comment. */
const NOT_A_STREAM = 'not a stream';

/**
 * The dictionary that ends just before `keyword` (white space aside) and where it starts, or null when none can be
 * found, or `NOT_A_STREAM` when the dictionary's own text shows that its `>>` and the keyword sit inside a string or a
 * comment (section 7.3.4: a string holds any characters, `>> stream` among them).
 */
function dictBefore(
  bytes: Uint8Array,
  keyword: number,
  budget: { left: number },
): { dict: StreamDict; start: number } | typeof NOT_A_STREAM | null {
  let end = keyword - 1;
  while (end >= 0 && isSpace(bytes[end])) end--;
  if (end < 1 || bytes[end] !== 0x3e || bytes[end - 1] !== 0x3e) return null;
  const stop = Math.max(0, end - MAX_DICT_BYTES);
  let depth = 0;
  for (let at = end; at >= stop && budget.left > 0; at--, budget.left--) {
    if (bytes[at] === 0x3e && bytes[at - 1] === 0x3e) {
      depth++;
      at--;
    } else if (bytes[at] === 0x3c && bytes[at - 1] === 0x3c) {
      depth--;
      at--;
      if (depth === 0) {
        if (!latin1) return null;
        const text = latin1.decode(bytes.subarray(at, end + 1));
        const shape = shapeOf(text);
        return shape.endsInsideText ? NOT_A_STREAM : { dict: readDict(text, shape), start: at };
      }
    }
  }
  return null;
}

/** Digits read backwards from `end` (exclusive) as a number, with the position they start at; null when there are none. */
function digitsBefore(bytes: Uint8Array, end: number, longest: number): { value: number; start: number } | null {
  let start = end;
  while (start > 0 && end - start < longest && bytes[start - 1]! >= 0x30 && bytes[start - 1]! <= 0x39) start--;
  if (start === end) return null;
  let value = 0;
  for (let i = start; i < end; i++) value = value * 10 + (bytes[i]! - 0x30);
  return { value, start };
}

/**
 * The object number of the `number generation obj` that ends just before `dictStart` (white space aside), or null when
 * the dictionary does not follow an object header (ISO 32000-1:2008 section 7.3.10).
 */
function objectNumberBefore(bytes: Uint8Array, dictStart: number): number | null {
  let q = dictStart;
  let steps = 0;
  while (q > 0 && isSpace(bytes[q - 1]) && steps++ < 1024) q--;
  if (!spells(bytes, q - 3, 'obj')) return null;
  q -= 3;
  let gap = 0;
  while (q > 0 && isSpace(bytes[q - 1]) && gap++ < 1024) q--;
  const generation = digitsBefore(bytes, q, 5);
  if (!generation) return null;
  q = generation.start;
  gap = 0;
  while (q > 0 && isSpace(bytes[q - 1]) && gap++ < 1024) q--;
  const number = digitsBefore(bytes, q, 10);
  return number ? number.value : null;
}

/** True when the first two bytes are a valid zlib header (RFC 1950): deflate, a window of at most 32 KiB, a good check. */
function looksLikeZlib(body: Uint8Array): boolean {
  if (body.length < 2) return false;
  return (body[0]! & 0x0f) === 8 && body[0]! >> 4 <= 7 && ((body[0]! << 8) | body[1]!) % 31 === 0;
}

interface FoundStream {
  body: Uint8Array;
  dict: StreamDict;
  /** The `number` of the `number generation obj` just before the dictionary, or null when there is none. */
  objectNumber: number | null;
  /** Where the data starts and ends in the file; the bytes between one stream's end and the next one's start are not data. */
  start: number;
  end: number;
  /** An object header stands before the dictionary and the `/Length` lands on `endstream`, so the data is data. */
  trusted: boolean;
}

/**
 * A search for `word` that is called with ever larger positions: it remembers the last answer, so the bytes are
 * searched once from start to end however many times it is called.
 */
function forwardByteFinder(bytes: Uint8Array, word: string): (at: number) => number {
  let from = 0;
  let found = -2;
  return (at) => {
    if (found !== -2 && at >= from && (found === -1 || found >= at)) return found;
    from = at;
    found = find(bytes, word, at);
    return found;
  };
}

/** Every stream in the file, in file order, without decoding any of them. */
function* streamsIn(bytes: Uint8Array): Generator<FoundStream> {
  const budget = { left: 16 * 1024 * 1024 + bytes.length };
  const nextEndstream = forwardByteFinder(bytes, 'endstream');
  let from = 0;
  while (from < bytes.length) {
    const s = find(bytes, 'stream', from);
    if (s < 0) return;
    from = s + 6;
    // `endstream` ends a stream and is not the start of one.
    if (s >= 3 && spells(bytes, s - 3, 'end')) continue;
    // The keyword is followed by an end-of-line, with spaces allowed before it.
    let data = s + 6;
    while (bytes[data] === 0x20 || bytes[data] === 0x09) data++;
    if (bytes[data] === 0x0d) {
      data++;
      if (bytes[data] === 0x0a) data++;
    } else if (bytes[data] === 0x0a) {
      data++;
    } else {
      continue;
    }
    // And it follows the end of a dictionary.
    let q = s - 1;
    while (q >= 0 && isSpace(bytes[q])) q--;
    if (q < 1 || bytes[q] !== 0x3e || bytes[q - 1] !== 0x3e) continue;

    const found = dictBefore(bytes, s, budget);
    // Text inside a string or a comment that only looks like a stream: the search goes on after the keyword, so the
    // streams after it are still found.
    if (found === NOT_A_STREAM) continue;
    const dict = found?.dict ?? UNKNOWN_DICT;
    const objectNumber = found ? objectNumberBefore(bytes, found.start) : null;
    let end = -1;
    if (dict.length !== null && data + dict.length <= bytes.length) {
      let probe = data + dict.length;
      while (probe < bytes.length && probe < data + dict.length + 8 && isSpace(bytes[probe])) probe++;
      if (spells(bytes, probe, 'endstream')) end = data + dict.length;
    }
    // A stream whose object header stands before its dictionary and whose `/Length` lands on `endstream` is trusted: its
    // data is skipped. Any other one may be text inside a string that only looks like a stream (a string longer than the
    // dictionary search can read back, or one that holds a whole `<< ... >>`), so it hides nothing: the search goes on
    // inside it, and its bytes stay in the text searched for references.
    const trusted = end >= 0 && objectNumber !== null;
    let next: number;
    if (end >= 0) {
      next = end;
    } else {
      const marker = nextEndstream(data);
      if (marker < 0) {
        end = bytes.length;
        next = bytes.length;
      } else {
        end = marker;
        // The end-of-line before `endstream` is not part of the data.
        if (end > data && bytes[end - 1] === 0x0a) end--;
        if (end > data && bytes[end - 1] === 0x0d) end--;
        next = marker;
      }
    }
    yield { body: bytes.subarray(data, end), dict, objectNumber, start: data, end, trusted };
    from = trusted ? Math.max(from, next) : Math.max(from, data);
  }
}

/** The body as chunks, so a stage never sees more than a megabyte at once. */
async function* chunksOf(body: Uint8Array): Chunks {
  const size = 1024 * 1024;
  for (let at = 0; at < body.length; at += size) yield body.subarray(at, Math.min(body.length, at + size));
}

/**
 * The filters of a stream that this module decodes, in order, and whether they are the stream's whole chain (so that what
 * they produce is the stream's real data and not the output of a half-decoded chain).
 */
function stagesFor(dict: StreamDict, body: Uint8Array): { stages: Stage[]; complete: boolean } {
  // A dictionary that could not be read, or a filter written as a reference, is treated as Flate when the data starts
  // like zlib data; any other stream with no decoding filter costs nothing to decode.
  const names = dict.filters ?? (looksLikeZlib(body) ? ['FlateDecode'] : []);
  const stages: Stage[] = [];
  for (const name of names) {
    const stage = STAGES.get(name);
    if (!stage) break;
    stages.push(stage);
  }
  return { stages, complete: stages.length === names.length };
}

/**
 * Runs the body through the stages and counts what they produce; throws the plain refusal when a cap is passed. Each
 * chunk the last stage produces is handed to `sink` when there is one.
 */
async function countThrough(
  body: Uint8Array,
  dict: StreamDict,
  stages: Stage[],
  counter: Counter,
  options: ExpansionOptions,
  sink?: (chunk: Uint8Array) => void,
): Promise<void> {
  let output: Chunks = chunksOf(body);
  for (const stage of stages) output = stage(output, stageMeter(counter), { earlyChange: dict.earlyChange });
  try {
    for await (const chunk of output) sink?.(chunk);
  } catch (err) {
    if (counter.exceeded) throw new PdfToolError('size', EXPANSION_MESSAGE);
    if (options.signal?.aborted) throw err;
    // The stream did not decode (damaged data, or not the format its dictionary names): the reader judges it.
  }
}

// --- Finding the pictures that something uses ------------------------------------------------------------------------

interface HeldPicture {
  objectNumber: number;
  body: Uint8Array;
  dict: StreamDict;
}

/** The bytes outside stream data, each piece followed by a space, kept up to a cap; one string at the end. */
class GapText {
  private buffer = new Uint8Array(0);
  private used = 0;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  add(part: Uint8Array): void {
    const take = Math.min(part.length, this.limit - this.used - 1);
    if (take < 0) return;
    const needed = this.used + take + 1;
    if (needed > this.buffer.length) {
      const grown = new Uint8Array(Math.min(this.limit, Math.max(needed, this.buffer.length * 2, 64 * 1024)));
      grown.set(this.buffer.subarray(0, this.used));
      this.buffer = grown;
    }
    this.buffer.set(part.subarray(0, take), this.used);
    this.used += take;
    this.buffer[this.used++] = 0x20;
  }

  text(): string {
    return latin1 ? latin1.decode(this.buffer.subarray(0, this.used)) : '';
  }
}

/** The decoded data of an object stream (section 7.5.7), kept so the references inside it can be read. */
interface RetainedObjectStream {
  bytes: Uint8Array;
  first: number | null;
  count: number | null;
}

interface Retained {
  items: RetainedObjectStream[];
  /** The bytes kept over all of the items. */
  total: number;
}

/**
 * A place to collect what an object stream decodes to, up to `MAX_OBJECT_STREAM_TEXT_BYTES` for this stream and
 * `MAX_RETAINED_BYTES` for all of them, or null when `MAX_RETAINED_OBJECT_STREAMS` are kept already. What passes the
 * caps is still decoded and counted by the caller; it is only not kept.
 */
function retainObjectStream(
  retained: Retained,
  dict: StreamDict,
): { add(chunk: Uint8Array): void; finish(): void } | null {
  if (retained.items.length >= MAX_RETAINED_OBJECT_STREAMS) return null;
  const parts: Uint8Array[] = [];
  let size = 0;
  return {
    add(chunk) {
      const room = Math.min(MAX_OBJECT_STREAM_TEXT_BYTES - size, MAX_RETAINED_BYTES - retained.total);
      if (room <= 0 || chunk.length === 0) return;
      // A copy: the chunk belongs to the stage that produced it.
      const part = chunk.slice(0, room);
      parts.push(part);
      size += part.length;
      retained.total += part.length;
    },
    finish() {
      if (size === 0) return;
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const part of parts) {
        bytes.set(part, at);
        at += part.length;
      }
      retained.items.push({ bytes, first: dict.first, count: dict.count });
    },
  };
}

const NUL = String.fromCharCode(0);
/** PDF white space (ISO 32000-1:2008 section 7.2.2): NUL, tab, line feed, form feed, carriage return and space. */
const WS = `[${NUL}\\t\\n\\f\\r ]`;
/** The next character ends a name or a keyword: white space, a delimiter or the end of the text. */
const ENDS_TOKEN = `(?=[${NUL}\\t\\n\\f\\r ()<>\\[\\]{}/%]|$)`;
/** `number generation R` (section 7.3.10). Every repeat is bounded or runs over white space only. */
const REFERENCE_SOURCE = `(\\d{1,10})${WS}+\\d{1,5}${WS}+R${ENDS_TOKEN}`;
const REFERENCES_IN_TEXT = new RegExp(REFERENCE_SOURCE, 'g');
const REFERENCE_HERE = new RegExp(REFERENCE_SOURCE, 'y');
/** `number generation obj` followed by the `[` that opens an array object (sections 7.3.6 and 7.3.10). */
const ARRAY_OBJECT = new RegExp(`(\\d{1,10})${WS}+\\d{1,5}${WS}+obj${WS}*\\[`, 'g');
/** One `object-number offset` pair of an object stream's header (section 7.5.7). */
const HEADER_PAIR = new RegExp(`(\\d{1,10})${WS}+(\\d{1,10})`, 'g');
/**
 * The entries whose value is a reference to a stream a reader decodes, an array of references or (for `CharProcs`) a
 * dictionary of references: a page's content (section 7.8.2), the embedded font programs, the `ToUnicode` map, the
 * `CIDToGIDMap`, a CMap named by `Encoding` and the glyph descriptions of a Type 3 font (sections 9.6 to 9.10).
 */
const KEY_NAMES = 'Contents|FontFile[23]?|ToUnicode|CIDToGIDMap|Encoding|CharProcs';
const KEY = `/(${KEY_NAMES})${ENDS_TOKEN}`;
const NAME_ESCAPE = /#([0-9A-Fa-f]{2})/g;

function isPdfSpaceCode(c: number): boolean {
  return c === 0x00 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
}

/** A name may write any character as `#` and two hexadecimal digits (section 7.3.5). */
function undoNameEscapes(text: string): string {
  if (!text.includes('#')) return text;
  return text.replace(NAME_ESCAPE, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * A search for `token` that is called with ever larger positions: it remembers the last answer, so a text with no token
 * after some point is searched once and the whole run is linear, whatever the text.
 */
function forwardFinder(text: string, token: string): (at: number) => number {
  let from = 0;
  let found = -2;
  return (at) => {
    if (found !== -2 && at >= from && (found === -1 || found >= at)) return found;
    from = at;
    found = text.indexOf(token, at);
    return found;
  };
}

/** Every `number generation R` in `part`, except one that starts in the middle of a longer number. */
function referencesIn(part: string, onReference: (objectNumber: number) => void): void {
  REFERENCES_IN_TEXT.lastIndex = 0;
  for (let m = REFERENCES_IN_TEXT.exec(part); m; m = REFERENCES_IN_TEXT.exec(part)) {
    const before = m.index > 0 ? part.charCodeAt(m.index - 1) : 0;
    if (before >= 0x30 && before <= 0x39) continue;
    onReference(Number(m[1]));
  }
}

/**
 * Calls `onReference` with the object number of every reference that the entries named in `KEY_NAMES` point at: one
 * reference (`/Contents 4 0 R`), an array of them (`/Contents [4 0 R 5 0 R]`) or a dictionary of them
 * (`/CharProcs << /a 4 0 R >>`) whose closing bracket is within `MAX_ARRAY_WINDOW` characters. `onContents` is also
 * called for a single reference given to `/Contents`, which may name an array object instead of a stream. Name escapes
 * are undone first, so `/Cont#65nts` is found. The text is searched once from start to end; an array or dictionary
 * nested inside the span of an earlier one is not read again, so the work is linear.
 */
function collectReferences(
  raw: string,
  onReference: (objectNumber: number) => void,
  onContents: (objectNumber: number) => void,
): void {
  const text = undoNameEscapes(raw);
  const keys = new RegExp(KEY, 'g');
  const closeBracket = forwardFinder(text, ']');
  const closeDictionary = forwardFinder(text, '>>');
  let scannedArray = 0;
  let scannedDictionary = 0;
  for (let m = keys.exec(text); m; m = keys.exec(text)) {
    let at = m.index + m[0].length;
    while (at < text.length && isPdfSpaceCode(text.charCodeAt(at))) at++;
    const c = text.charCodeAt(at);
    if (c === 0x5b) {
      const close = closeBracket(at);
      if (close < 0 || close - at > MAX_ARRAY_WINDOW) continue;
      const from = Math.max(at, scannedArray);
      if (close > from) referencesIn(text.slice(from, close), onReference);
      if (close > scannedArray) scannedArray = close;
    } else if (c === 0x3c && text.charCodeAt(at + 1) === 0x3c) {
      const close = closeDictionary(at + 2);
      if (close < 0 || close - at > MAX_ARRAY_WINDOW) continue;
      const from = Math.max(at + 2, scannedDictionary);
      if (close > from) referencesIn(text.slice(from, close), onReference);
      if (close > scannedDictionary) scannedDictionary = close;
    } else if (c >= 0x30 && c <= 0x39) {
      REFERENCE_HERE.lastIndex = at;
      const reference = REFERENCE_HERE.exec(text);
      if (!reference) continue;
      onReference(Number(reference[1]));
      if (m[1] === 'Contents') onContents(Number(reference[1]));
    }
  }
}

/**
 * One step of indirection (section 7.8.2: `/Contents` may be a reference to an array object): for every object in
 * `candidates` that is written in `text` as `number generation obj [ ... ]`, calls `onReference` with the references
 * inside the array. Linear, for the same reasons as `collectReferences`.
 */
function referencesOfArrayObjects(
  text: string,
  candidates: ReadonlySet<number>,
  onReference: (objectNumber: number) => void,
): void {
  const closeBracket = forwardFinder(text, ']');
  let scanned = 0;
  ARRAY_OBJECT.lastIndex = 0;
  for (let m = ARRAY_OBJECT.exec(text); m; m = ARRAY_OBJECT.exec(text)) {
    const before = m.index > 0 ? text.charCodeAt(m.index - 1) : 0;
    if ((before >= 0x30 && before <= 0x39) || !candidates.has(Number(m[1]))) continue;
    const open = m.index + m[0].length - 1;
    const close = closeBracket(open);
    if (close < 0 || close - open > MAX_ARRAY_WINDOW) continue;
    const from = Math.max(open + 1, scanned);
    if (close > from) referencesIn(text.slice(from, close), onReference);
    if (close > scanned) scanned = close;
  }
}

/**
 * The same one step of indirection for the objects held inside an object stream: its header lists `number offset`
 * pairs and each offset is counted from `/First` (section 7.5.7). At most `MAX_OBJECT_STREAM_OBJECTS` pairs are read.
 */
function referencesOfHeldArrays(
  text: string,
  stream: RetainedObjectStream,
  candidates: ReadonlySet<number>,
  onReference: (objectNumber: number) => void,
): void {
  if (stream.first === null || stream.count === null) return;
  const header = text.slice(0, Math.min(stream.first, MAX_OBJECT_STREAM_HEADER));
  const offsets: number[] = [];
  const pairs = Math.min(stream.count, MAX_OBJECT_STREAM_OBJECTS);
  HEADER_PAIR.lastIndex = 0;
  let m = HEADER_PAIR.exec(header);
  for (let read = 0; m && read < pairs; read++) {
    if (candidates.has(Number(m[1]))) offsets.push(stream.first + Number(m[2]));
    m = HEADER_PAIR.exec(header);
  }
  offsets.sort((a, b) => a - b);
  const closeBracket = forwardFinder(text, ']');
  let scanned = 0;
  for (const offset of offsets) {
    let at = offset;
    let steps = 0;
    while (at < text.length && isPdfSpaceCode(text.charCodeAt(at)) && steps++ < 1024) at++;
    if (text.charCodeAt(at) !== 0x5b) continue;
    const close = closeBracket(at);
    if (close < 0 || close - at > MAX_ARRAY_WINDOW) continue;
    const from = Math.max(at + 1, scanned);
    if (close > from) referencesIn(text.slice(from, close), onReference);
    if (close > scanned) scanned = close;
  }
}

/**
 * Counts what the streams of a PDF decode to, and throws `PdfToolError` with kind `size` and the plain sentence the
 * moment one stage of one stream passes `limits.perStream` (default 64 MiB) or all stages together pass `limits.total`
 * (default 256 MiB). Resolves with a report when neither is passed. Where the platform has no `DecompressionStream`
 * the check cannot run and resolves at once with nothing counted. A stream that fails to decode is not refused here:
 * the bytes it did produce are counted and the reader that opens the file judges the rest.
 *
 * A stream labelled as a picture is counted only when something uses it (see the header of this file), except an
 * object stream or a cross-reference stream, which is counted whatever it is labelled.
 */
export async function checkExpansion(bytes: Uint8Array, options: ExpansionOptions = {}): Promise<ExpansionReport> {
  const report: ExpansionReport = { streams: 0, decoded: 0, images: 0, picturesCounted: 0, decodedBytes: 0 };
  if (!expansionCheckAvailable()) return report;
  const counter: Counter = {
    total: 0,
    exceeded: false,
    sinceProgress: 0,
    perStream: options.limits?.perStream ?? MAX_STREAM_DECODED_BYTES,
    totalLimit: options.limits?.total ?? MAX_TOTAL_DECODED_BYTES,
    signal: options.signal,
    onProgress: options.onProgress,
  };

  const held: HeldPicture[] = [];
  const retained: Retained = { items: [], total: 0 };
  const gaps = new GapText(MAX_REFERENCE_TEXT_BYTES);
  let gapFrom = 0;

  for (const { body, dict, objectNumber, start, end, trusted } of streamsIn(bytes)) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('The check was cancelled.');
    report.streams++;
    if (report.streams % 2000 === 0) options.onProgress?.();
    gaps.add(bytes.subarray(Math.min(gapFrom, start), start));
    // The data of a stream that is not trusted may be the rest of a dictionary, so it stays in the searched text: the
    // next piece starts where this data starts, and every byte is added once.
    gapFrom = Math.max(gapFrom, trusted ? end : start);
    // A picture whose object number cannot be read can never be matched to a use, so it is not held but counted below:
    // the check fails closed. Ordinary writers put `number generation obj` straight before the dictionary.
    if (dict.image && !dict.objectStream && !dict.xref && objectNumber !== null) {
      // Whether something a reader decodes uses this picture is known only once the whole file has been read.
      report.images++;
      if (held.length < MAX_HELD_PICTURES) held.push({ objectNumber, body, dict });
      continue;
    }
    const { stages, complete } = stagesFor(dict, body);
    if (stages.length === 0) {
      // An object stream with nothing to decode holds its objects as they are.
      if (dict.objectStream && complete && retained.items.length < MAX_RETAINED_OBJECT_STREAMS) {
        const room = Math.min(MAX_OBJECT_STREAM_TEXT_BYTES, MAX_RETAINED_BYTES - retained.total);
        if (room > 0 && body.length > 0) {
          const kept = body.subarray(0, room);
          retained.items.push({ bytes: kept, first: dict.first, count: dict.count });
          retained.total += kept.length;
        }
      }
      continue;
    }
    report.decoded++;
    // A picture label does not exempt an object stream or a cross-reference stream (the readers decode them regardless),
    // nor a picture whose object number cannot be read.
    if (dict.image) report.picturesCounted++;
    const keeping = dict.objectStream && complete ? retainObjectStream(retained, dict) : null;
    await countThrough(body, dict, stages, counter, options, keeping?.add);
    keeping?.finish();
  }

  if (held.length > 0) {
    gaps.add(bytes.subarray(Math.min(gapFrom, bytes.length)));
    options.onProgress?.();
    const wanted = new Set<number>();
    for (const picture of held) wanted.add(picture.objectNumber);
    const used = new Set<number>();
    const candidates = new Set<number>();
    const noteReference = (n: number): void => {
      if (wanted.has(n)) used.add(n);
    };
    const noteContents = (n: number): void => {
      if (!wanted.has(n) && candidates.size < MAX_INDIRECT_CANDIDATES) candidates.add(n);
    };
    const fileText = gaps.text();
    const objectStreamTexts = latin1 ? retained.items.map((item) => latin1.decode(item.bytes)) : [];
    collectReferences(fileText, noteReference, noteContents);
    for (const text of objectStreamTexts) collectReferences(text, noteReference, noteContents);
    if (candidates.size > 0) {
      referencesOfArrayObjects(fileText, candidates, noteReference);
      retained.items.forEach((item, i) => {
        referencesOfHeldArrays(objectStreamTexts[i]!, item, candidates, noteReference);
      });
    }
    options.onProgress?.();

    for (const picture of held) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('The check was cancelled.');
      if (!used.has(picture.objectNumber)) continue;
      const { stages } = stagesFor(picture.dict, picture.body);
      if (stages.length === 0) continue;
      // Counted as used, no longer as an image.
      report.images--;
      report.decoded++;
      report.picturesCounted++;
      await countThrough(picture.body, picture.dict, stages, counter, options);
    }
  }
  report.decodedBytes = counter.total;
  return report;
}
