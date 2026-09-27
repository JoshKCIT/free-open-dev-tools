/**
 * The four output formats this tool offers, and the one rule that decides
 * whether a browser can really write a given one: the returned blob's own
 * `type`, never a resolved promise alone and never a try/catch around the
 * encode call.
 *
 * The HTML Standard's own canvas encoding section states that when a
 * requested image type is not supported, the user agent must use its
 * default type (PNG) instead -- silently, with no rejection and no thrown
 * error. A capability check that only asks "did this resolve with a blob"
 * therefore reports every format as supported on every engine. The correct
 * check, used throughout this package and its worker, compares the blob's
 * own reported `type` against the type that was actually requested; a
 * mismatch means the browser substituted a different format, and this
 * package reports that plainly rather than writing a file under the wrong
 * extension.
 */

export type OutputFormatId = 'png' | 'jpeg' | 'webp' | 'avif';

export interface OutputFormatInfo {
  id: OutputFormatId;
  label: string;
  mediaType: string;
  extension: string;
}

export const OUTPUT_FORMATS: OutputFormatInfo[] = [
  { id: 'png', label: 'PNG', mediaType: 'image/png', extension: 'png' },
  { id: 'jpeg', label: 'JPEG', mediaType: 'image/jpeg', extension: 'jpg' },
  { id: 'webp', label: 'WebP', mediaType: 'image/webp', extension: 'webp' },
  { id: 'avif', label: 'AVIF', mediaType: 'image/avif', extension: 'avif' },
];

export function formatInfo(id: OutputFormatId): OutputFormatInfo {
  const info = OUTPUT_FORMATS.find((f) => f.id === id);
  if (!info) throw new Error(`Unknown output format '${id}'.`);
  return info;
}

export interface EncodeInterpretation {
  ok: boolean;
  /** The media type the browser actually returned, only present when it differs from what was requested. */
  substitutedType?: string;
}

/**
 * Compares a requested encode media type against the media type a real
 * `Blob` the browser handed back actually carries. Equal means the browser
 * wrote what was asked for; anything else means it silently substituted a
 * different format (most commonly PNG), which this package treats as that
 * format being unavailable in this browser, not as an error in the encode
 * call itself.
 */
export function interpretEncodeResult(requestedType: string, returnedType: string): EncodeInterpretation {
  if (requestedType === returnedType) return { ok: true };
  return { ok: false, substitutedType: returnedType };
}

/**
 * Turns a map of requested media type to the media type a real probe encode
 * actually returned (built by encoding a tiny canvas once per session, in
 * the worker, into every one of `OUTPUT_FORMATS`) into a simple
 * format-id-to-writable-or-not table for the page's own report.
 */
export function writableFormats(probeResults: Record<string, string>): Record<OutputFormatId, boolean> {
  const result = {} as Record<OutputFormatId, boolean>;
  for (const format of OUTPUT_FORMATS) {
    const returned = probeResults[format.mediaType];
    result[format.id] = returned !== undefined && interpretEncodeResult(format.mediaType, returned).ok;
  }
  return result;
}
