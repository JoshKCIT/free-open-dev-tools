import meta from './meta.json';
import { validateTextSource } from './favicon-set';

export { meta };
export { buildIco, readIcoDirectory, FaviconError, type IcoImage, type IcoDirectoryEntry } from './ico';
export {
  FAVICON_SET,
  ICO_SIZES,
  linkTags,
  manifestJson,
  validateTextSource,
  escapeHtmlAttribute,
  escapeJsonString,
  type FaviconSetEntry,
  type FaviconPurpose,
  type ManifestOptions,
  type TextSourceMode,
} from './favicon-set';
export { sniffFile, assertFileKind, FileSignatureError, FILE_KINDS, MAX_HEADER_BYTES } from './file-sniff';
export type { FileKind, SniffResult, FileKindLimits } from './file-sniff';

export type FaviconSource = 'text' | 'emoji' | 'image';
export type FaviconShape = 'square' | 'rounded' | 'circle';
export type FaviconFit = 'cover' | 'contain';
export type FontFamily = 'sans-serif' | 'serif' | 'monospace';

/** 25 MB and 100,000,000 declared pixels for the Image source, checked from the header before any decoding. */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 100_000_000;

/** The fraction of each size's own edge left as padding around a contained image, or around text/emoji when the drawn glyph is narrower than the box. Not a visitor-facing field: a fixed, sensible default. */
export const CONTAIN_PADDING_PERCENT = 10;

export interface FaviconOptions {
  source: FaviconSource;
  text: string;
  emoji: string;
  fit: FaviconFit;
  shape: FaviconShape;
  foreground: string;
  background: string;
  transparent: boolean;
  font: FontFamily;
  bold: boolean;
  appName: string;
}

export interface FaviconPlan {
  source: FaviconSource;
  text: string;
  emoji: string;
  fit: FaviconFit;
  shape: FaviconShape;
  foreground: string;
  background: string;
  transparent: boolean;
  font: FontFamily;
  bold: boolean;
  appName: string;
  paddingPercent: number;
  warnings: string[];
}

const HEX_COLOUR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function parseColour(raw: string, field: string, fallback: string, warnings: string[]): string {
  const trimmed = raw.trim();
  if (HEX_COLOUR.test(trimmed)) return trimmed;
  warnings.push(`'${field}' was not a valid #rgb or #rrggbb colour; ${fallback} was used instead.`);
  return fallback;
}

/**
 * Validates the text or emoji source's own grapheme count, parses both
 * colours, and returns the plan the worker draws every size from. Never
 * touches a canvas, a font or a picked file's own bytes: those live only in
 * the worker (image decoding) and the page (drawing).
 */
export function planFavicon(options: FaviconOptions): FaviconPlan {
  const warnings: string[] = [];

  if (options.source === 'text') {
    validateTextSource('text', options.text);
  } else if (options.source === 'emoji') {
    validateTextSource('emoji', options.emoji);
  }

  const foreground = parseColour(options.foreground, 'foreground', '#000000', warnings);
  const background = parseColour(options.background, 'background', '#ffffff', warnings);

  const appName = options.appName.trim() || 'My site';

  return {
    source: options.source,
    text: options.text,
    emoji: options.emoji,
    fit: options.fit === 'contain' ? 'contain' : 'cover',
    shape: options.shape,
    foreground,
    background,
    transparent: options.transparent,
    font: options.font,
    bold: options.bold,
    appName,
    paddingPercent: CONTAIN_PADDING_PERCENT,
    warnings,
  };
}
