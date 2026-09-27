/**
 * Reads every metadata block a JPEG, PNG or WebP file carries.
 *
 * JPEG and PNG are read with the installed `exifr` 7.1.3, with every block
 * its options expose turned on explicitly (never relying on its own
 * defaults, 05-01 Q): `tiff`, `exif`, `gps`, `xmp`, `iptc`, `icc`, `jfif` and
 * `ihdr`, `ifd1` and `interop` off, `makerNote` and `userComment` off (large,
 * rarely useful, and off by the library's own default), `mergeOutput: false`
 * so each block stays its own object rather than one flattened bag, values
 * translated to readable text (`translateKeys`/`translateValues`/
 * `reviveValues`, all the library's own default of `true`).
 *
 * The installed `exifr` has no WebP file parser at all (confirmed directly
 * against its own `src/file-parsers/` this session -- only `jpeg.mjs`,
 * `png.mjs`, `tiff.mjs` and `heif.mjs` exist): a WebP's `EXIF` chunk is a
 * raw TIFF stream (RFC 9649 section 2.7), which is handed to `exifr`
 * directly and recognised by its own TIFF file parser (its `canHandle` only
 * checks for the `II`/`MM` byte-order mark, confirmed directly against its
 * source); a WebP's `XMP ` chunk is a standalone XMP packet with no JPEG or
 * TIFF wrapper, which `exifr` has no path for at all (its XMP segment
 * parser only recognises XMP embedded inside a JPEG APP1 segment), so this
 * file reads it with a small, hand-written extractor instead (see
 * `xmpRowsFromPacket` below) -- documented in this package's own
 * `meta.json` ambiguities, not hidden.
 */
import * as exifr from 'exifr';
import { assertFileKind, type FileKind } from './file-sniff';
import { readWebpChunks } from './strip-webp';
import { getOwn } from './own-property';

export class ExifViewerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExifViewerError';
  }
}

/** Files up to this size are read; anything larger is refused before any parsing happens. */
export const MAX_EXIF_BYTES = 100 * 1024 * 1024;

export interface MetadataBlock {
  name: string;
  rows: [string, string][];
}

export interface GpsCoordinates {
  latitude: number;
  longitude: number;
}

export interface ReadMetadataResult {
  kind: Extract<FileKind, 'jpeg' | 'png' | 'webp'>;
  blocks: MetadataBlock[];
  gps?: GpsCoordinates;
  orientation?: number;
}

const EXIFR_OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  xmp: true,
  iptc: true,
  icc: true,
  jfif: true,
  ihdr: true,
  ifd1: false,
  interop: false,
  makerNote: false,
  userComment: false,
  mergeOutput: false,
  sanitize: true,
  translateKeys: true,
  translateValues: true,
  reviveValues: true,
} as const;

const BLOCK_LABELS: Record<string, string> = {
  ifd0: 'Image (IFD0)',
  ifd1: 'Thumbnail (IFD1)',
  exif: 'EXIF',
  gps: 'GPS',
  interop: 'Interoperability',
  iptc: 'IPTC',
  icc: 'ICC Profile',
  jfif: 'JFIF',
  ihdr: 'PNG Header',
};

const KNOWN_BLOCK_KEYS = new Set(Object.keys(BLOCK_LABELS));

function valueToText(value: unknown): string {
  if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && value instanceof Buffer)) {
    return `${(value as Uint8Array).length} bytes`;
  }
  if (Array.isArray(value)) return value.map(valueToText).join(', ');
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Turns exifr's own `mergeOutput: false` result shape into this tool's
 * `MetadataBlock[]`: a known segment or IFD name (`ifd0`, `exif`, `gps`,
 * `iptc`, `icc`, `jfif`, `ihdr`) becomes its own labelled block; every other
 * top-level key is an XMP namespace (exifr's own README: "Extracted XMP
 * tags are grouped by namespace. Each ns is separate object in output.") and
 * is folded into one combined `XMP` block, each row prefixed
 * `namespace:tag` so two namespaces that happen to share a tag name never
 * collide.
 */
function blocksFromExifrResult(result: Record<string, unknown> | undefined): MetadataBlock[] {
  const blocks: MetadataBlock[] = [];
  const xmpRows: [string, string][] = [];
  if (!result) return blocks;

  for (const key of Object.keys(result)) {
    if (key === 'errors') continue;
    const value = result[key];
    if (!value || typeof value !== 'object') continue;
    const entries = Object.entries(value as Record<string, unknown>);
    if (KNOWN_BLOCK_KEYS.has(key)) {
      const rows: [string, string][] = [];
      for (const [tag, tagValue] of entries) {
        rows.push([tag, valueToText(tagValue)]);
      }
      if (rows.length > 0) blocks.push({ name: BLOCK_LABELS[key]!, rows });
    } else {
      for (const [tag, tagValue] of entries) {
        xmpRows.push([`${key}:${tag}`, valueToText(tagValue)]);
      }
    }
  }

  if (xmpRows.length > 0) blocks.push({ name: 'XMP', rows: xmpRows });
  return blocks;
}

function gpsFromExifrResult(result: Record<string, unknown> | undefined): GpsCoordinates | undefined {
  const gps = result?.gps as Record<string, unknown> | undefined;
  const latitude = gps ? getOwn(gps, 'latitude') : undefined;
  const longitude = gps ? getOwn(gps, 'longitude') : undefined;
  if (typeof latitude === 'number' && typeof longitude === 'number') return { latitude, longitude };
  return undefined;
}

/**
 * The Adobe XMP Specification Part 3 defines XMP as RDF/XML: a value is
 * either a simple element's own text content (`<dc:description>text
 * </dc:description>`) or, very commonly for a localisable value, an
 * `rdf:Alt` container holding one `rdf:li` per language
 * (`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">text</rdf:li></rdf:Alt>
 * </dc:title>`). This extractor is not a general XML or RDF parser -- it
 * only reads these two common shapes, first collapsing an `rdf:Alt`
 * wrapper down to its first `rdf:li` value, then reading every remaining
 * `namespace:tag` element with plain text content. Anything more elaborate
 * (nested RDF containers of containers, resource references) is not
 * represented; this is a deliberate, documented simplification, not a bug.
 */
function xmpRowsFromPacket(xml: string): [string, string][] {
  const collapsed = xml.replace(
    /<rdf:Alt>\s*<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>\s*<\/rdf:Alt>/g,
    (_match, inner: string) => inner,
  );
  const rows: [string, string][] = [];
  const pattern = /<([a-zA-Z][\w-]*:[a-zA-Z][\w-]*)>([^<]*)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(collapsed)) !== null) {
    const tag = match[1]!;
    if (tag.startsWith('rdf:') || tag.startsWith('x:')) continue;
    const text = match[2]!.trim();
    if (text.length === 0) continue;
    rows.push([tag, text]);
  }
  return rows;
}

/**
 * Inflates a zlib-wrapped (RFC 1950) deflate stream with the platform's own
 * Compression Streams API, available as a global in every target browser
 * and in Node without an import -- unlike `node:zlib`, which does not exist
 * inside a browser worker. PNG's own zlib datastream (W3C PNG Third
 * Edition section 9.1) is exactly the `deflate` format token this API
 * defines, the same wrapping `zTXt` (section 11.3.4.4) and `iCCP` compress
 * their own payload with.
 */
async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const readable = new ReadableStream<BufferSource>({
    start(controller) {
      // `data` is always a plain array-backed view (never a SharedArrayBuffer
      // one); the DOM stream types require the narrower `ArrayBuffer` generic
      // TypeScript 5.7's own typed-array types no longer infer automatically.
      controller.enqueue(data as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
  const reader = readable.pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}
function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[offset + i]!);
  return s;
}

/**
 * The installed `exifr` reads PNG `tEXt` and `iTXt` chunks (the latter only
 * when it carries the fixed XMP keyword) but has no code path for `zTXt`
 * (compressed text) at all, confirmed directly against its own
 * `src/file-parsers/png.mjs`: its own `pngMetaChunks` list names `ihdr`,
 * `iccp`, `text`, `itxt` and `exif`, never `ztxt`. This tool reads `zTXt`
 * itself with a light, read-only chunk walk (no CRC check -- this is a
 * best-effort display read, not the removal path's own refuse-on-corruption
 * walker in `strip-png.ts`) and inflates each one with `inflateZlib`.
 */
async function readPngZtxtRows(bytes: Uint8Array): Promise<[string, string][]> {
  const rows: [string, string][] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = asciiAt(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    if (type === 'zTXt') {
      const data = bytes.subarray(dataStart, dataEnd);
      const nullIndex = data.indexOf(0);
      if (nullIndex !== -1 && nullIndex + 1 < data.length) {
        const keyword = asciiAt(data, 0, nullIndex);
        const compressed = data.subarray(nullIndex + 2); // one byte for the compression method, always 0 (zlib)
        try {
          const inflated = await inflateZlib(compressed);
          rows.push([keyword, new TextDecoder('latin1').decode(inflated)]);
        } catch {
          // A zTXt chunk whose own compressed data does not inflate is
          // skipped for this read-only display pass rather than refused --
          // strip-png.ts's own CRC check is what actually guards removal.
        }
      }
    }
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  return rows;
}

async function readWebpMetadata(bytes: Uint8Array): Promise<ReadMetadataResult> {
  const chunks = readWebpChunks(bytes);
  const exifChunk = chunks.find((c) => c.fourCc === 'EXIF');
  const xmpChunk = chunks.find((c) => c.fourCc === 'XMP ');

  const blocks: MetadataBlock[] = [];
  let gps: GpsCoordinates | undefined;
  let orientation: number | undefined;

  if (exifChunk) {
    let result: Record<string, unknown> | undefined;
    try {
      result = await exifr.parse(exifChunk.data, EXIFR_OPTIONS);
    } catch {
      result = undefined;
    }
    blocks.push(...blocksFromExifrResult(result));
    gps = gpsFromExifrResult(result);
    try {
      orientation = await exifr.orientation(exifChunk.data);
    } catch {
      orientation = undefined;
    }
  }

  if (xmpChunk) {
    const text = new TextDecoder().decode(xmpChunk.data);
    const rows = xmpRowsFromPacket(text);
    if (rows.length > 0) blocks.push({ name: 'XMP', rows });
  }

  return { kind: 'webp', blocks, gps, orientation };
}

/**
 * Reads every EXIF, GPS, XMP, IPTC and colour-profile block a JPEG, PNG or
 * WebP file carries, and its Exif Orientation if it has one. Refuses (via
 * `assertFileKind`) anything whose header does not match one of the three
 * accepted kinds before any real parsing happens.
 */
export async function readMetadata(bytes: Uint8Array): Promise<ReadMetadataResult> {
  const sniff = assertFileKind(bytes, ['jpeg', 'png', 'webp'], { maxBytes: MAX_EXIF_BYTES });

  if (sniff.kind === 'webp') return readWebpMetadata(bytes);

  let result: Record<string, unknown> | undefined;
  try {
    result = await exifr.parse(bytes, EXIFR_OPTIONS);
  } catch (err) {
    throw new ExifViewerError(
      `this ${sniff.kind === 'jpeg' ? 'JPEG' : 'PNG'} file's metadata could not be read: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const orientation = await exifr.orientation(bytes).catch(() => undefined);
  const blocks = blocksFromExifrResult(result);

  if (sniff.kind === 'png') {
    const ztxtRows = await readPngZtxtRows(bytes);
    if (ztxtRows.length > 0) {
      const header = blocks.find((b) => b.name === 'PNG Header');
      if (header) header.rows.push(...ztxtRows);
      else blocks.push({ name: 'PNG Header', rows: ztxtRows });
    }
  }

  return {
    kind: sniff.kind as 'jpeg' | 'png',
    blocks,
    gps: gpsFromExifrResult(result),
    orientation,
  };
}
