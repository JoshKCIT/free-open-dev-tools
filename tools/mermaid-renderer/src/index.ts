import meta from './meta.json';
import { MermaidError } from './errors';
import { MAX_PNG_PIXELS, MAX_PNG_SIDE, PNG_SCALES } from './limits';
import { svgSize } from './scrub';

export { meta };
export { MermaidError, parserMessage, MAX_PARSER_MESSAGE_CHARS, UNKNOWN_TYPE_MESSAGE } from './errors';
export {
  MAX_DIAGRAM_CHARS,
  MAX_DIAGRAM_LINES,
  MAX_SVG_BYTES,
  MAX_PNG_PIXELS,
  MAX_PNG_SIDE,
  PNG_SCALES,
} from './limits';
export {
  prepareDiagram,
  prescanDiagram,
  scanConstructs,
  tooManyCharactersMessage,
  tooManyLinesMessage,
  type PreparedDiagram,
} from './prescan';
export { ALLOWED_ELEMENTS, scrubSvg, svgSize, withPixelSize, type ScrubResult } from './scrub';
export { FRAME_CSP, FRAME_HEIGHT_PX, FRAME_WIDTH_PX, buildFrameDocument, mermaidConfig } from './frame-doc';
export { cutWithEllipsis, visible } from './text';

/**
 * The Mermaid themes the page offers, from the value the page's select holds to the name Mermaid knows it by. A
 * lookup of any other key (including `__proto__`, `constructor` and `toString`) finds nothing.
 */
export const MERMAID_THEMES: ReadonlyMap<string, string> = new Map([
  ['default', 'default'],
  ['neutral', 'neutral'],
  ['dark', 'dark'],
  ['forest', 'forest'],
  ['base', 'base'],
]);

/** The Mermaid name of a theme value, or `default` when the value is not one of the five. */
export function themeName(value: string): string {
  return MERMAID_THEMES.get(value) ?? 'default';
}

/** The size of the PNG a scale gives: the SVG's own size times the scale, rounded up. */
export interface PngSize {
  width: number;
  height: number;
}

/**
 * The pixel size of the PNG for a drawn SVG at a scale of 1 to 4. Refuses a scale that is not on offer and a PNG over
 * 16,000,000 pixels or 8,192 pixels on a side, with a sentence that names the size and the limits.
 */
export function pngSize(svg: string, scale: number): PngSize {
  if (!PNG_SCALES.includes(scale)) {
    throw new MermaidError(
      `Scale must be a whole number from ${PNG_SCALES[0]} to ${PNG_SCALES[PNG_SCALES.length - 1]}.`,
    );
  }
  const natural = svgSize(svg);
  const width = Math.max(1, Math.ceil(natural.width * scale));
  const height = Math.max(1, Math.ceil(natural.height * scale));
  if (width > MAX_PNG_SIDE || height > MAX_PNG_SIDE || width * height > MAX_PNG_PIXELS) {
    throw new MermaidError(
      `The PNG would be ${width} by ${height} pixels. The limit is ${MAX_PNG_PIXELS.toLocaleString('en-US')} pixels and ${MAX_PNG_SIDE.toLocaleString('en-US')} on a side; choose a smaller scale.`,
    );
  }
  return { width, height };
}
