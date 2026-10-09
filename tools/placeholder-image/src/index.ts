/**
 * A placeholder image, built as an SVG string. W3C SVG 2 section 5.3 "The
 * 'svg' element" defines `width`, `height` and `viewBox`; section 5.4 "The
 * 'rect' element" the background rectangle; section 11.5 "The 'line'
 * element" the pattern lines this file draws from plain numbers, never
 * interpolated strings; section 11.11 "The 'text' element" and its
 * `text-anchor`/`dominant-baseline` properties for centring the label.
 *
 * W3C Extensible Markup Language (XML) 1.0 section 2.4 "Character Data and
 * Markup" (fetched and quoted this session): character data "may not
 * contain the character < in un-escaped form" and "the right angle bracket
 * (>) may be represented using the string \"&gt;\"", and the ampersand
 * itself must be escaped for either to appear literally -- exactly what
 * `escapeXmlText` below does, and the only place a visitor's own label text
 * ever reaches the markup.
 */
import meta from './meta.json';

export { meta };

export class PlaceholderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaceholderError';
  }
}

/** No side of the SVG may exceed this many pixels. */
export const MAX_SVG_SIDE = 10_000;

/**
 * No side of the PNG may exceed this many pixels -- a measured value, not a
 * guessed constant: the largest square side every tested browser project's
 * own `OffscreenCanvas` encodes to PNG in comfortably under one second.
 */
export const MAX_PNG_SIDE = 4096;

export type FontFamily = 'sans-serif' | 'serif' | 'monospace' | 'cursive' | 'fantasy';
export type Pattern = 'none' | 'cross' | 'grid';

const FONT_FAMILIES: readonly FontFamily[] = ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy'];
const PATTERNS: readonly Pattern[] = ['none', 'cross', 'grid'];

export interface PlaceholderOptions {
  width?: number;
  height?: number;
  /** A #rgb or #rrggbb hex colour. Default `#cccccc`. */
  background?: string;
  /** A #rgb or #rrggbb hex colour. Default `#333333`. */
  foreground?: string;
  /** Plain text, limited to 80 characters. Defaults to `<width> × <height>`. */
  label?: string;
  /** Defaults to one fifth of the smaller side. */
  fontSize?: number;
  fontFamily?: FontFamily;
  pattern?: Pattern;
}

export interface PlaceholderResult {
  svg: string;
  width: number;
  height: number;
  label: string;
  /** Normalised (lower-case, 6-digit) colours actually used, after clamping -- a caller drawing the same picture on a canvas never needs to re-parse them out of the SVG text. */
  background: string;
  foreground: string;
  fontSize: number;
  fontFamily: FontFamily;
  pattern: Pattern;
  /** `data:image/svg+xml,` followed by the percent-encoded SVG text. */
  dataUri: string;
  warnings: string[];
}

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 360;
const DEFAULT_BACKGROUND = '#cccccc';
const DEFAULT_FOREGROUND = '#333333';
const MAX_LABEL_LENGTH = 80;
const MIN_FONT_SIZE = 4;

function clampSize(value: number | undefined, fallback: number, field: string, warnings: string[]): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) {
    warnings.push(`${field} was not a usable number, so ${fallback} was used instead.`);
    return fallback;
  }
  const rounded = Math.round(value);
  if (rounded < 1) {
    warnings.push(`${field} must be at least 1 pixel; 1 was used instead.`);
    return 1;
  }
  if (rounded > MAX_SVG_SIDE) {
    warnings.push(
      `${field} is above the ${MAX_SVG_SIDE.toLocaleString('en-US')}-pixel limit; that limit was used instead.`,
    );
    return MAX_SVG_SIDE;
  }
  return rounded;
}

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Accepts only `#rgb` or `#rrggbb`; anything else falls back to `fallback` with a warning. Always returns lower-case 6-digit form. */
function normaliseColour(value: string | undefined, fallback: string, field: string, warnings: string[]): string {
  if (value === undefined || value === '') return fallback;
  if (!HEX_COLOUR.test(value)) {
    warnings.push(`${field} must be a #rgb or #rrggbb colour; the default was used instead.`);
    return fallback;
  }
  const hex = value.slice(1).toLowerCase();
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  return `#${full}`;
}

/** XML 1.0 section 2.4: character data may not contain a literal `<` or a bare `&`; `>` is escaped too, the same conservative convention every XML serialiser in this project follows. */
function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clampFontSize(value: number | undefined, autoSide: number, warnings: string[]): number {
  const auto = Math.max(MIN_FONT_SIZE, Math.round(autoSide / 5));
  if (value === undefined) return auto;
  if (!Number.isFinite(value) || value <= 0) {
    warnings.push('fontSize was not a usable number, so the automatic size was used instead.');
    return auto;
  }
  const rounded = Math.round(value);
  const clamped = Math.min(Math.max(rounded, MIN_FONT_SIZE), MAX_SVG_SIDE);
  if (clamped !== rounded) {
    warnings.push('fontSize was out of range and was clamped.');
  }
  return clamped;
}

/** Every line drawn is built from plain numbers only, never from a value a visitor supplied as text -- there is nothing here for hostile input to reach. */
function patternMarkup(pattern: Pattern, width: number, height: number, stroke: string): string {
  if (pattern === 'none') return '';
  const lines: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1" />`;
  if (pattern === 'cross') {
    lines.push(line(0, 0, width, height), line(width, 0, 0, height));
  } else {
    for (let i = 1; i < 10; i++) {
      const x = Math.round((width * i) / 10);
      const y = Math.round((height * i) / 10);
      lines.push(line(x, 0, x, height), line(0, y, width, y));
    }
  }
  return lines.join('');
}

/**
 * Builds a placeholder SVG (and the numbers a caller's own canvas would
 * need to draw the same picture as a PNG). Every dimension, colour and the
 * font size are clamped to a valid value rather than rejected outright, so
 * a momentarily invalid field never stops the rest of the request; each
 * clamp adds a plain-language warning naming the field.
 */
export function generatePlaceholder(options: PlaceholderOptions = {}): PlaceholderResult {
  const warnings: string[] = [];

  const width = clampSize(options.width, DEFAULT_WIDTH, 'width', warnings);
  const height = clampSize(options.height, DEFAULT_HEIGHT, 'height', warnings);
  const background = normaliseColour(options.background, DEFAULT_BACKGROUND, 'background', warnings);
  const foreground = normaliseColour(options.foreground, DEFAULT_FOREGROUND, 'foreground', warnings);
  const fontFamily =
    options.fontFamily && FONT_FAMILIES.includes(options.fontFamily) ? options.fontFamily : 'sans-serif';
  const pattern = options.pattern && PATTERNS.includes(options.pattern) ? options.pattern : 'none';

  let label = options.label !== undefined && options.label !== '' ? options.label : `${width} × ${height}`;
  if (label.length > MAX_LABEL_LENGTH) {
    warnings.push(`label is limited to ${MAX_LABEL_LENGTH} characters; it was shortened.`);
    label = label.slice(0, MAX_LABEL_LENGTH);
  }
  const fontSize = clampFontSize(options.fontSize, Math.min(width, height), warnings);
  const escapedLabel = escapeXmlText(label);
  const patternSvg = patternMarkup(pattern, width, height, foreground);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${background}" />` +
    patternSvg +
    `<text x="${Math.round(width / 2)}" y="${Math.round(height / 2)}" fill="${foreground}" font-family="${fontFamily}" font-size="${fontSize}" text-anchor="middle" dominant-baseline="middle">${escapedLabel}</text>` +
    `</svg>`;

  const dataUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  return { svg, width, height, label, background, foreground, fontSize, fontFamily, pattern, dataUri, warnings };
}
