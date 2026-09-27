import meta from './meta.json';

export { meta };

export * from './file-sniff';
export * from './own-property';
export * from './read';
export * from './orientation';
export * from './describe';
export { stripJpeg, JpegStripError, type StripJpegOptions, type StripJpegResult } from './strip-jpeg';
export { stripPng, PngStripError, PNG_KEPT_CHUNKS, type StripPngOptions, type StripPngResult } from './strip-png';
export { stripWebp, WebpStripError, readWebpChunks, type StripWebpOptions, type StripWebpResult } from './strip-webp';

import { assertFileKind, MAX_HEADER_BYTES } from './file-sniff';
import { readMetadata, ExifViewerError, MAX_EXIF_BYTES, type ReadMetadataResult } from './read';
import { stripJpeg } from './strip-jpeg';
import { stripPng } from './strip-png';
import { stripWebp } from './strip-webp';

export interface StripMetadataOptions {
  /** Keep the embedded colour profile. Default true: removing it can change how colours look. */
  keepColourProfile?: boolean;
  /** Keep a single Orientation tag when the source is rotated. Default true: removing it can show the picture sideways. */
  keepOrientation?: boolean;
}

export interface StripMetadataResult {
  bytes: Uint8Array;
  removed: { what: string; bytes: number }[];
  /** What the re-read of the output copy still finds, in plain words. Empty when nothing does. */
  kept: string[];
  warnings: string[];
}

function describeKept(reread: ReadMetadataResult): string[] {
  const kept: string[] = [];
  for (const block of reread.blocks) {
    // JFIF (JPEG's own APP0 header) and the PNG header block are always
    // kept regardless of either option -- basic structural information
    // (density units, bit depth) with nothing privacy-sensitive in it, not
    // a leftover metadata block worth reporting to the visitor.
    if (block.name === 'JFIF' || block.name === 'PNG Header') continue;
    if (block.name === 'ICC Profile') kept.push('the colour profile');
    else if (block.name === 'EXIF' || block.name === 'Image (IFD0)') {
      // Only the Orientation tag is expected to survive; anything else
      // surviving here would be a real bug in one of the strip-*.ts
      // walkers, so it is still reported plainly rather than hidden.
      const onlyOrientation = block.rows.every(([tag]) => tag === 'Orientation');
      kept.push(onlyOrientation ? 'the orientation tag' : `unexpected data in ${block.name}`);
    } else {
      kept.push(`unexpected data in ${block.name}`);
    }
  }
  if (reread.gps) kept.push('the GPS location');
  return kept;
}

/**
 * Reads a JPEG, PNG or WebP file's header first (`assertFileKind`), removes
 * every metadata block it can by rewriting the container losslessly --
 * cutting JPEG marker segments, PNG chunks or WebP RIFF chunks -- so the
 * picture's own pixel and scan data is never re-encoded, then re-reads its
 * own output with `readMetadata` to report plainly what -- if anything --
 * still remains, so the page can state what the copy still carries rather
 * than merely claim it removed everything.
 */
export async function stripMetadata(
  bytes: Uint8Array,
  options: StripMetadataOptions = {},
): Promise<StripMetadataResult> {
  const keepColourProfile = options.keepColourProfile ?? true;
  const keepOrientation = options.keepOrientation ?? true;

  const header = bytes.length > MAX_HEADER_BYTES ? bytes.subarray(0, MAX_HEADER_BYTES) : bytes;
  const sniff = assertFileKind(header, ['jpeg', 'png', 'webp'], { maxBytes: MAX_EXIF_BYTES });

  const stripOptions = { keepColourProfile, keepOrientation };
  const result =
    sniff.kind === 'jpeg'
      ? stripJpeg(bytes, stripOptions)
      : sniff.kind === 'png'
        ? stripPng(bytes, stripOptions)
        : stripWebp(bytes, stripOptions);

  let kept: string[] = [];
  const warnings = [...result.warnings];
  try {
    const reread = await readMetadata(result.bytes);
    kept = describeKept(reread);
  } catch (err) {
    // The copy no longer parses as a file carrying any metadata at all --
    // the strongest possible confirmation that nothing remains. Recorded as
    // a warning only if it is not the expected "no header found" shape a
    // metadata-free file naturally produces once every marker is gone; in
    // practice a stripped JPEG/PNG/WebP still has a valid header (its
    // picture data was never touched), so this branch is not expected to
    // run in ordinary use and exists only so a genuine surprise is visible
    // rather than silently swallowed.
    warnings.push(`could not confirm the copy is clean: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { bytes: result.bytes, removed: result.removed, kept, warnings };
}

/** `photo.jpg` -> `photo-no-metadata.jpg`; a name with no extension gets the suffix appended plainly. */
export function outputFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return `${fileName}-no-metadata`;
  return `${fileName.slice(0, dot)}-no-metadata${fileName.slice(dot)}`;
}

export { ExifViewerError };
