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
 * both stages. A stream whose dictionary says `/Subtype /Image` is not counted: neither library decodes an image to read
 * text or metadata, and a large photograph is a legitimate file. The image filters (DCT, CCITT, JBIG2, JPX) are never
 * run; a chain stops at the first filter this module does not decode.
 *
 * What it does not do: it is a bound, not a parser of everything PDF.js and pdf-lib read. It finds streams by their
 * keyword and reads the dictionary just before it, so a deliberately crafted file can hide a stream from it (a
 * dictionary written with an unbalanced string, a content stream labelled as an image). A stream that fails to inflate is
 * left for the library to judge and is not refused here. The decoded bytes of the stages are counted as they are
 * produced and never held, so the check itself needs only a few chunks of memory.
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
  /** Streams left out because their dictionary says they are images. */
  images: number;
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
  /** The filter names in order, `[]` when the dictionary has no filter, `null` when they cannot be told. */
  filters: string[] | null;
  /** The `/Length` when it is a plain number. */
  length: number | null;
  earlyChange: number;
}

const UNKNOWN_DICT: StreamDict = { image: false, filters: null, length: null, earlyChange: 1 };

/** Reads the three entries this check needs from the text of a stream's dictionary. */
function readDict(text: string): StreamDict {
  const image = /\/Subtype\s*\/Image(?![A-Za-z0-9#])/.test(text);
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
    filters,
    length: lengthMatch ? Number(lengthMatch[1]) : null,
    earlyChange: early ? Number(early[1]) : 1,
  };
}

/** The dictionary that ends just before `keyword` (white space aside), or null when none can be found. */
function dictBefore(bytes: Uint8Array, keyword: number, budget: { left: number }): StreamDict | null {
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
        return latin1 ? readDict(latin1.decode(bytes.subarray(at, end + 1))) : null;
      }
    }
  }
  return null;
}

/** True when the first two bytes are a valid zlib header (RFC 1950): deflate, a window of at most 32 KiB, a good check. */
function looksLikeZlib(body: Uint8Array): boolean {
  if (body.length < 2) return false;
  return (body[0]! & 0x0f) === 8 && body[0]! >> 4 <= 7 && ((body[0]! << 8) | body[1]!) % 31 === 0;
}

interface FoundStream {
  body: Uint8Array;
  dict: StreamDict;
}

/** Every stream in the file, in file order, without decoding any of them. */
function* streamsIn(bytes: Uint8Array): Generator<FoundStream> {
  const budget = { left: 16 * 1024 * 1024 + bytes.length };
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

    const dict = dictBefore(bytes, s, budget) ?? UNKNOWN_DICT;
    let end = -1;
    if (dict.length !== null && data + dict.length <= bytes.length) {
      let probe = data + dict.length;
      while (probe < bytes.length && probe < data + dict.length + 8 && isSpace(bytes[probe])) probe++;
      if (spells(bytes, probe, 'endstream')) end = data + dict.length;
    }
    let next: number;
    if (end >= 0) {
      next = end;
    } else {
      const marker = find(bytes, 'endstream', data);
      if (marker < 0) {
        yield { body: bytes.subarray(data), dict };
        return;
      }
      end = marker;
      // The end-of-line before `endstream` is not part of the data.
      if (end > data && bytes[end - 1] === 0x0a) end--;
      if (end > data && bytes[end - 1] === 0x0d) end--;
      next = marker;
    }
    yield { body: bytes.subarray(data, end), dict };
    from = Math.max(from, next);
  }
}

/** The body as chunks, so a stage never sees more than a megabyte at once. */
async function* chunksOf(body: Uint8Array): Chunks {
  const size = 1024 * 1024;
  for (let at = 0; at < body.length; at += size) yield body.subarray(at, Math.min(body.length, at + size));
}

/**
 * Counts what the streams of a PDF decode to, and throws `PdfToolError` with kind `size` and the plain sentence the
 * moment one stage of one stream passes `limits.perStream` (default 64 MiB) or all stages together pass `limits.total`
 * (default 256 MiB). Resolves with a report when neither is passed. Where the platform has no `DecompressionStream`
 * the check cannot run and resolves at once with nothing counted. A stream that fails to decode is not refused here:
 * the bytes it did produce are counted and the reader that opens the file judges the rest.
 */
export async function checkExpansion(bytes: Uint8Array, options: ExpansionOptions = {}): Promise<ExpansionReport> {
  const report: ExpansionReport = { streams: 0, decoded: 0, images: 0, decodedBytes: 0 };
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

  for (const { body, dict } of streamsIn(bytes)) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('The check was cancelled.');
    report.streams++;
    if (report.streams % 2000 === 0) options.onProgress?.();
    if (dict.image) {
      report.images++;
      continue;
    }
    // A dictionary that could not be read, or a filter written as a reference, is treated as Flate when the data starts
    // like zlib data; any other stream with no decoding filter costs nothing to decode.
    const names = dict.filters ?? (looksLikeZlib(body) ? ['FlateDecode'] : []);
    const stages: Stage[] = [];
    for (const name of names) {
      const stage = STAGES.get(name);
      if (!stage) break;
      stages.push(stage);
    }
    if (stages.length === 0) continue;

    report.decoded++;
    let output: Chunks = chunksOf(body);
    for (const stage of stages) output = stage(output, stageMeter(counter), { earlyChange: dict.earlyChange });
    try {
      for await (const chunk of output) void chunk;
    } catch (err) {
      if (counter.exceeded) throw new PdfToolError('size', EXPANSION_MESSAGE);
      if (options.signal?.aborted) throw err;
      // The stream did not decode (damaged data, or not the format its dictionary names): the reader judges it.
    }
  }
  report.decodedBytes = counter.total;
  return report;
}
