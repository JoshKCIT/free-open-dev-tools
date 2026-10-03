import { CssSafetyError, formatHexColor, formatNumber, parseHexColor } from './css-safe';

export class CssPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CssPatternError';
  }
}

/** The eight patterns, by id with the label shown on the page. */
export const PATTERNS: ReadonlyMap<string, string> = new Map([
  ['stripes-diagonal', 'Diagonal stripes'],
  ['stripes-horizontal', 'Horizontal stripes'],
  ['stripes-vertical', 'Vertical stripes'],
  ['checks', 'Checks'],
  ['dots', 'Dots'],
  ['grid', 'Grid'],
  ['zigzag', 'Zigzag'],
  ['cross', 'Cross-hatch'],
]);

/** The size of the box the preview and the copied CSS give the pattern. */
export const PREVIEW_WIDTH = 240;
export const PREVIEW_HEIGHT = 160;

const MAX_TILE = 1000;
const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" ';
const SVG_CLOSE = '</svg>';
/** What a percent-encoded address leaves bare: letters, digits, space and . _ ~ : / = - */
const BARE = ' ._~:/=-';

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/** An optional minus sign, digits, and optionally a point and more digits. */
function isPlainNumber(text: string): boolean {
  let i = 0;
  if (text.charAt(0) === '-') i++;
  const wholeStart = i;
  while (i < text.length && isDigit(text.charAt(i))) i++;
  if (i === wholeStart) return false;
  if (i === text.length) return true;
  if (text.charAt(i) !== '.') return false;
  i++;
  const fractionStart = i;
  while (i < text.length && isDigit(text.charAt(i))) i++;
  return i > fractionStart && i === text.length;
}

function isHexColour(text: string): boolean {
  if (text.charAt(0) !== '#' || (text.length !== 7 && text.length !== 9)) return false;
  for (let i = 1; i < text.length; i++) {
    const ch = text.charAt(i);
    if (!isDigit(ch) && !(ch >= 'a' && ch <= 'f')) return false;
  }
  return true;
}

function isPointList(text: string): boolean {
  if (text.length === 0) return false;
  for (const ch of text) {
    if (!isDigit(ch) && ch !== '.' && ch !== ',' && ch !== '-' && ch !== ' ') return false;
  }
  return true;
}

const ELEMENT_ATTRIBUTES: ReadonlyMap<string, readonly string[]> = new Map([
  ['svg', ['xmlns', 'width', 'height', 'viewBox']],
  ['rect', ['x', 'y', 'width', 'height', 'fill']],
  ['circle', ['cx', 'cy', 'r', 'fill']],
  ['polygon', ['points', 'fill']],
]);

function attributeValueOk(name: string, value: string): boolean {
  if (name === 'xmlns') return value === 'http://www.w3.org/2000/svg';
  if (name === 'fill') return isHexColour(value);
  if (name === 'points') return isPointList(value);
  if (name === 'viewBox') {
    const parts = value.split(' ');
    return (
      parts.length === 4 && parts[0] === '0' && parts[1] === '0' && isPlainNumber(parts[2]!) && isPlainNumber(parts[3]!)
    );
  }
  return isPlainNumber(value);
}

/** Throws unless the text is made only of the element and attribute names a tile uses, with plain values. */
function assertTile(svg: string): void {
  const refuse = (): never => {
    throw new CssPatternError('The SVG is not a tile this page wrote.');
  };
  if (svg.length > 4000 || !svg.startsWith(SVG_OPEN) || !svg.endsWith(SVG_CLOSE)) refuse();
  let i = 0;
  let tags = 0;
  while (i < svg.length) {
    if (svg.startsWith(SVG_CLOSE, i)) {
      i += SVG_CLOSE.length;
      if (i !== svg.length) refuse();
      break;
    }
    if (svg.charAt(i) !== '<') refuse();
    const end = svg.indexOf('>', i);
    if (end < 0) refuse();
    tags++;
    if (tags > 12) refuse();
    let body = svg.slice(i + 1, end);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);
    const space = body.indexOf(' ');
    const name = space < 0 ? body : body.slice(0, space);
    const allowed = ELEMENT_ATTRIBUTES.get(name);
    if (allowed === undefined) return refuse();
    if (selfClosing === (name === 'svg')) refuse();
    let at = space;
    while (at >= 0 && at < body.length) {
      // One attribute: a space, a name, an equals sign and a value in double quotes.
      let j = at + 1;
      const nameStart = j;
      while (j < body.length && isLetter(body.charAt(j))) j++;
      const attribute = body.slice(nameStart, j);
      if (!allowed.includes(attribute) || body.charAt(j) !== '=' || body.charAt(j + 1) !== '"') refuse();
      const close = body.indexOf('"', j + 2);
      if (close < 0) refuse();
      if (!attributeValueOk(attribute, body.slice(j + 2, close))) refuse();
      at = close + 1;
      if (at < body.length && body.charAt(at) !== ' ') refuse();
    }
    i = end + 1;
  }
}

function hexOf(value: string, label: string): string {
  try {
    return formatHexColor(parseHexColor(value, label));
  } catch (err) {
    if (err instanceof CssSafetyError) {
      throw new CssPatternError(`${label} is not a valid hexadecimal colour: use 3, 4, 6 or 8 digits after a #.`);
    }
    throw err;
  }
}

function plainNumber(value: number, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new CssPatternError(`${label} is not a usable number.`);
  }
  return value;
}

/**
 * Writes one repeat of a pattern as a small SVG: a rectangle of the background colour and the shapes of the chosen
 * pattern in the foreground colour. Every element is a fixed template, every number is formatted from a finite number
 * and every colour is parsed and written again as hex, so the text holds nothing a visitor typed.
 *
 * SVG 2 (https://www.w3.org/TR/SVG2/), basic shapes. The line width is thickness percent of the size, as the
 * gradient form measures it: a stripe's width along the edge of the tile, the width of a grid line and the radius of a
 * dot. Diagonal stripes cross a tile as a band and a corner piece, so the repeat joins without a seam.
 */
export function patternSvg(
  pattern: string,
  size: number,
  thickness: number,
  foreground: string,
  background: string,
): string {
  if (typeof pattern !== 'string' || !PATTERNS.has(pattern)) {
    throw new CssPatternError('Pattern is not one of the choices on offer.');
  }
  const s = plainNumber(size, 'Size', 1, MAX_TILE);
  const line = (plainNumber(thickness, 'Thickness', 0, 100) * s) / 100;
  const fg = hexOf(foreground, 'Foreground');
  const bg = hexOf(background, 'Background');
  const half = s / 2;
  const n = formatNumber;

  const rect = (attributes: string): string => `<rect ${attributes} fill="${fg}"/>`;
  const polygon = (points: string): string => `<polygon points="${points}" fill="${fg}"/>`;
  const stripeBand = polygon(`0,0 ${n(line)},0 ${n(s)},${n(s - line)} ${n(s)},${n(s)}`);
  const stripeCorner = polygon(`0,${n(s - line)} 0,${n(s)} ${n(line)},${n(s)}`);

  let shapes: string;
  switch (pattern) {
    case 'stripes-diagonal':
      shapes = stripeBand + stripeCorner;
      break;
    case 'stripes-horizontal':
      shapes = rect(`width="${n(s)}" height="${n(line)}"`);
      break;
    case 'stripes-vertical':
      shapes = rect(`width="${n(line)}" height="${n(s)}"`);
      break;
    case 'checks':
      shapes =
        rect(`x="${n(half)}" width="${n(half)}" height="${n(half)}"`) +
        rect(`y="${n(half)}" width="${n(half)}" height="${n(half)}"`);
      break;
    case 'dots':
      shapes = `<circle cx="${n(half)}" cy="${n(half)}" r="${n(line)}" fill="${fg}"/>`;
      break;
    case 'grid':
      shapes =
        rect(`width="${n(line)}" height="${n(s)}"`) + rect(`y="${n(s - line)}" width="${n(s)}" height="${n(line)}"`);
      break;
    case 'zigzag':
      shapes =
        polygon(`0,0 ${n(s)},0 ${n(half)},${n(half)}`) +
        polygon(`0,${n(half)} 0,${n(s)} ${n(half)},${n(s)}`) +
        polygon(`${n(s)},${n(half)} ${n(s)},${n(s)} ${n(half)},${n(s)}`);
      break;
    default:
      shapes =
        stripeBand +
        stripeCorner +
        polygon(`0,0 ${n(line)},0 0,${n(line)}`) +
        polygon(`0,${n(s)} ${n(s)},0 ${n(s)},${n(line)} ${n(line)},${n(s)}`);
  }

  const svg =
    `${SVG_OPEN}width="${n(s)}" height="${n(s)}" viewBox="0 0 ${n(s)} ${n(s)}">` +
    `<rect width="${n(s)}" height="${n(s)}" fill="${bg}"/>${shapes}${SVG_CLOSE}`;
  assertTile(svg);
  return svg;
}

/** The tile as the text of a CSS address: every character outside letters, digits and . _ ~ : / = - and space is percent-encoded. */
function encodeTile(svg: string): string {
  let out = '';
  for (let i = 0; i < svg.length; i++) {
    const ch = svg.charAt(i);
    const code = svg.charCodeAt(i);
    if (isLetter(ch) || isDigit(ch) || BARE.includes(ch)) out += ch;
    else if (code < 128) out += `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
    else throw new CssPatternError('The SVG is not a tile this page wrote.');
  }
  return out;
}

/** Throws if the finished CSS holds anything beyond the one data address and plain declarations. */
function assertSvgCss(css: string): void {
  for (const bad of ['\\', '/*', '<', '!', "'", '`', '@', '{{']) {
    if (css.includes(bad)) throw new CssPatternError('The CSS holds a character it must not.');
  }
  if (css.split('url(').length !== 2 || !css.includes('url("data:image/svg+xml,')) {
    throw new CssPatternError('The CSS must hold exactly one data address.');
  }
  for (let i = 0; i < css.length; i++) {
    const code = css.charCodeAt(i);
    if (code !== 10 && (code < 32 || code > 126)) throw new CssPatternError('The CSS holds a character it must not.');
  }
}

/**
 * Writes the one rule of the inline-SVG form: the preview box, the background colour, the tile as a percent-encoded
 * data address and the size of one repeat. The canonical stylesheet writer refuses an address by design, so this
 * small writer exists for this one form; it takes only a tile that `patternSvg` could have made and a hex colour.
 */
export function svgPatternCss(svg: string, background: string, size: number): string {
  assertTile(svg);
  const bg = hexOf(background, 'Background');
  const tile = formatNumber(plainNumber(size, 'Size', 1, MAX_TILE));
  const css =
    `.pattern {\n  width: ${PREVIEW_WIDTH}px;\n  height: ${PREVIEW_HEIGHT}px;\n  background-color: ${bg};\n` +
    `  background-image: url("data:image/svg+xml,${encodeTile(svg)}");\n  background-size: ${tile}px ${tile}px;\n}`;
  assertSvgCss(css);
  return css;
}

/** The content of the frame: a style element holding exactly the CSS, then the one element it styles. */
export function svgPatternHtml(css: string): string {
  if (css.length === 0 || css.includes('<')) {
    throw new CssPatternError('The CSS cannot be placed in a style element.');
  }
  return `<style>${css}</style><div class="pattern"></div>`;
}
