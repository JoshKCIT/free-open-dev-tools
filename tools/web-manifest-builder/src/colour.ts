import { asciiLowercase, isAsciiWhitespace, stripAscii } from './ascii';

/**
 * Parses a manifest colour (theme_color or background_color) the way the W3C Web Application Manifest draft asks:
 * "parse the value as a CSS colour" and keep it only when it is an sRGB colour. Hex (3, 4, 6 and 8 digits), rgb(),
 * rgba(), hsl(), hsla() (comma and space syntax), the CSS Color Module Level 4 named colours and transparent are
 * parsed here, in one pass with no backtracking. hwb(), lab(), lch(), oklab(), oklch() and color() are valid CSS that a
 * browser can convert to sRGB; they are reported as unchecked because this page does not do the conversion. Anything
 * else (system colours, currentcolor, var(), light-dark(), text that is not a colour) is invalid.
 *
 * `rgba` holds red, green and blue as whole numbers from 0 to 255 and alpha from 0 to 1 in steps of 1 / 255, as the
 * eight bit alpha of a browser.
 */
export type ParsedColour =
  { kind: 'srgb'; rgba: [number, number, number, number] } | { kind: 'unchecked' } | { kind: 'invalid' };

const INVALID: ParsedColour = { kind: 'invalid' };
const UNCHECKED: ParsedColour = { kind: 'unchecked' };

/** Valid CSS colour functions that are sRGB-convertible but not converted here. */
const UNCHECKED_FUNCTIONS: ReadonlySet<string> = new Set(['hwb', 'lab', 'lch', 'oklab', 'oklch', 'color']);

/**
 * The named colours of CSS Color Module Level 4, section 6.1, with red, green and blue as the table's decimal column
 * gives them (148 names; transparent is not in the table and is read separately).
 */
export const NAMED_COLOURS: ReadonlyMap<string, [number, number, number]> = new Map<string, [number, number, number]>([
  ['aliceblue', [240, 248, 255]],
  ['antiquewhite', [250, 235, 215]],
  ['aqua', [0, 255, 255]],
  ['aquamarine', [127, 255, 212]],
  ['azure', [240, 255, 255]],
  ['beige', [245, 245, 220]],
  ['bisque', [255, 228, 196]],
  ['black', [0, 0, 0]],
  ['blanchedalmond', [255, 235, 205]],
  ['blue', [0, 0, 255]],
  ['blueviolet', [138, 43, 226]],
  ['brown', [165, 42, 42]],
  ['burlywood', [222, 184, 135]],
  ['cadetblue', [95, 158, 160]],
  ['chartreuse', [127, 255, 0]],
  ['chocolate', [210, 105, 30]],
  ['coral', [255, 127, 80]],
  ['cornflowerblue', [100, 149, 237]],
  ['cornsilk', [255, 248, 220]],
  ['crimson', [220, 20, 60]],
  ['cyan', [0, 255, 255]],
  ['darkblue', [0, 0, 139]],
  ['darkcyan', [0, 139, 139]],
  ['darkgoldenrod', [184, 134, 11]],
  ['darkgray', [169, 169, 169]],
  ['darkgreen', [0, 100, 0]],
  ['darkgrey', [169, 169, 169]],
  ['darkkhaki', [189, 183, 107]],
  ['darkmagenta', [139, 0, 139]],
  ['darkolivegreen', [85, 107, 47]],
  ['darkorange', [255, 140, 0]],
  ['darkorchid', [153, 50, 204]],
  ['darkred', [139, 0, 0]],
  ['darksalmon', [233, 150, 122]],
  ['darkseagreen', [143, 188, 143]],
  ['darkslateblue', [72, 61, 139]],
  ['darkslategray', [47, 79, 79]],
  ['darkslategrey', [47, 79, 79]],
  ['darkturquoise', [0, 206, 209]],
  ['darkviolet', [148, 0, 211]],
  ['deeppink', [255, 20, 147]],
  ['deepskyblue', [0, 191, 255]],
  ['dimgray', [105, 105, 105]],
  ['dimgrey', [105, 105, 105]],
  ['dodgerblue', [30, 144, 255]],
  ['firebrick', [178, 34, 34]],
  ['floralwhite', [255, 250, 240]],
  ['forestgreen', [34, 139, 34]],
  ['fuchsia', [255, 0, 255]],
  ['gainsboro', [220, 220, 220]],
  ['ghostwhite', [248, 248, 255]],
  ['gold', [255, 215, 0]],
  ['goldenrod', [218, 165, 32]],
  ['gray', [128, 128, 128]],
  ['green', [0, 128, 0]],
  ['greenyellow', [173, 255, 47]],
  ['grey', [128, 128, 128]],
  ['honeydew', [240, 255, 240]],
  ['hotpink', [255, 105, 180]],
  ['indianred', [205, 92, 92]],
  ['indigo', [75, 0, 130]],
  ['ivory', [255, 255, 240]],
  ['khaki', [240, 230, 140]],
  ['lavender', [230, 230, 250]],
  ['lavenderblush', [255, 240, 245]],
  ['lawngreen', [124, 252, 0]],
  ['lemonchiffon', [255, 250, 205]],
  ['lightblue', [173, 216, 230]],
  ['lightcoral', [240, 128, 128]],
  ['lightcyan', [224, 255, 255]],
  ['lightgoldenrodyellow', [250, 250, 210]],
  ['lightgray', [211, 211, 211]],
  ['lightgreen', [144, 238, 144]],
  ['lightgrey', [211, 211, 211]],
  ['lightpink', [255, 182, 193]],
  ['lightsalmon', [255, 160, 122]],
  ['lightseagreen', [32, 178, 170]],
  ['lightskyblue', [135, 206, 250]],
  ['lightslategray', [119, 136, 153]],
  ['lightslategrey', [119, 136, 153]],
  ['lightsteelblue', [176, 196, 222]],
  ['lightyellow', [255, 255, 224]],
  ['lime', [0, 255, 0]],
  ['limegreen', [50, 205, 50]],
  ['linen', [250, 240, 230]],
  ['magenta', [255, 0, 255]],
  ['maroon', [128, 0, 0]],
  ['mediumaquamarine', [102, 205, 170]],
  ['mediumblue', [0, 0, 205]],
  ['mediumorchid', [186, 85, 211]],
  ['mediumpurple', [147, 112, 219]],
  ['mediumseagreen', [60, 179, 113]],
  ['mediumslateblue', [123, 104, 238]],
  ['mediumspringgreen', [0, 250, 154]],
  ['mediumturquoise', [72, 209, 204]],
  ['mediumvioletred', [199, 21, 133]],
  ['midnightblue', [25, 25, 112]],
  ['mintcream', [245, 255, 250]],
  ['mistyrose', [255, 228, 225]],
  ['moccasin', [255, 228, 181]],
  ['navajowhite', [255, 222, 173]],
  ['navy', [0, 0, 128]],
  ['oldlace', [253, 245, 230]],
  ['olive', [128, 128, 0]],
  ['olivedrab', [107, 142, 35]],
  ['orange', [255, 165, 0]],
  ['orangered', [255, 69, 0]],
  ['orchid', [218, 112, 214]],
  ['palegoldenrod', [238, 232, 170]],
  ['palegreen', [152, 251, 152]],
  ['paleturquoise', [175, 238, 238]],
  ['palevioletred', [219, 112, 147]],
  ['papayawhip', [255, 239, 213]],
  ['peachpuff', [255, 218, 185]],
  ['peru', [205, 133, 63]],
  ['pink', [255, 192, 203]],
  ['plum', [221, 160, 221]],
  ['powderblue', [176, 224, 230]],
  ['purple', [128, 0, 128]],
  ['rebeccapurple', [102, 51, 153]],
  ['red', [255, 0, 0]],
  ['rosybrown', [188, 143, 143]],
  ['royalblue', [65, 105, 225]],
  ['saddlebrown', [139, 69, 19]],
  ['salmon', [250, 128, 114]],
  ['sandybrown', [244, 164, 96]],
  ['seagreen', [46, 139, 87]],
  ['seashell', [255, 245, 238]],
  ['sienna', [160, 82, 45]],
  ['silver', [192, 192, 192]],
  ['skyblue', [135, 206, 235]],
  ['slateblue', [106, 90, 205]],
  ['slategray', [112, 128, 144]],
  ['slategrey', [112, 128, 144]],
  ['snow', [255, 250, 250]],
  ['springgreen', [0, 255, 127]],
  ['steelblue', [70, 130, 180]],
  ['tan', [210, 180, 140]],
  ['teal', [0, 128, 128]],
  ['thistle', [216, 191, 216]],
  ['tomato', [255, 99, 71]],
  ['turquoise', [64, 224, 208]],
  ['violet', [238, 130, 238]],
  ['wheat', [245, 222, 179]],
  ['white', [255, 255, 255]],
  ['whitesmoke', [245, 245, 245]],
  ['yellow', [255, 255, 0]],
  ['yellowgreen', [154, 205, 50]],
]);

type Component = { none: true } | { none: false; value: number; unit: string };

const ANGLE_UNITS: ReadonlySet<string> = new Set(['deg', 'grad', 'rad', 'turn']);

function isDigit(unit: number): boolean {
  return unit >= 0x30 && unit <= 0x39;
}

/**
 * Reads one CSS component: a number, a percentage, a number with an angle unit, or the keyword none. Returns null when
 * the text is none of those. A number is an optional sign, digits with an optional fraction (or a fraction alone) and an
 * optional exponent; "5." is not a number.
 */
function readComponent(token: string): Component | null {
  if (asciiLowercase(token) === 'none') return { none: true };
  let i = 0;
  if (token[i] === '+' || token[i] === '-') i++;
  const digitsStart = i;
  while (i < token.length && isDigit(token.charCodeAt(i))) i++;
  const wholeDigits = i - digitsStart;
  let fractionDigits = 0;
  if (token[i] === '.') {
    const fractionStart = i + 1;
    let j = fractionStart;
    while (j < token.length && isDigit(token.charCodeAt(j))) j++;
    fractionDigits = j - fractionStart;
    if (fractionDigits === 0) return null;
    i = j;
  }
  if (wholeDigits === 0 && fractionDigits === 0) return null;
  // An exponent needs digits after it (and an optional sign); otherwise the letter starts a unit.
  if (token[i] === 'e' || token[i] === 'E') {
    let j = i + 1;
    if (token[j] === '+' || token[j] === '-') j++;
    const exponentStart = j;
    while (j < token.length && isDigit(token.charCodeAt(j))) j++;
    if (j > exponentStart) i = j;
  }
  const value = Number(token.slice(0, i));
  if (!Number.isFinite(value)) return null;
  const unit = asciiLowercase(token.slice(i));
  if (unit === '' || unit === '%' || ANGLE_UNITS.has(unit)) return { none: false, value, unit };
  return null;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** The arguments of a colour function and how they were separated. */
interface Args {
  tokens: string[];
  /** One entry between each pair of tokens: space, comma or slash (a comma or slash beats whitespace around it). */
  separators: ('space' | 'comma' | 'slash')[];
}

/** Splits the text between the parentheses into arguments in one pass. Null when a comma or slash has no argument. */
function splitArguments(inner: string): Args | null {
  const tokens: string[] = [];
  const separators: Args['separators'] = [];
  let start = -1;
  let pending: 'space' | 'comma' | 'slash' | null = null;
  let expectToken = false;
  for (let i = 0; i <= inner.length; i++) {
    const ch = i < inner.length ? inner[i] : ' ';
    const space = i === inner.length || isAsciiWhitespace(inner.charCodeAt(i));
    const comma = ch === ',';
    const slash = ch === '/';
    if (!space && !comma && !slash) {
      if (start < 0) {
        start = i;
        if (tokens.length > 0) {
          separators.push(pending ?? 'space');
        }
        pending = null;
        expectToken = false;
      }
      continue;
    }
    if (start >= 0) {
      tokens.push(inner.slice(start, i));
      start = -1;
    }
    if (comma || slash) {
      // A comma or slash needs an argument before it and one after it.
      if (tokens.length === 0 || expectToken) return null;
      pending = comma ? 'comma' : 'slash';
      expectToken = true;
    } else if (pending === null && tokens.length > 0) {
      pending = 'space';
    }
  }
  if (expectToken || tokens.length === 0) return null;
  return { tokens, separators };
}

/** What the argument layout is: legacy comma syntax, or space syntax with an optional slash before alpha. */
function layout(args: Args): { legacy: boolean; alphaIndex: number } | null {
  const { tokens, separators } = args;
  if (tokens.length !== 3 && tokens.length !== 4) return null;
  if (separators.includes('comma')) {
    return separators.every((separator) => separator === 'comma') ? { legacy: true, alphaIndex: 3 } : null;
  }
  if (tokens.length === 3)
    return separators.every((separator) => separator === 'space') ? { legacy: false, alphaIndex: -1 } : null;
  return separators[0] === 'space' && separators[1] === 'space' && separators[2] === 'slash'
    ? { legacy: false, alphaIndex: 3 }
    : null;
}

function alphaOf(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const component = readComponent(token);
  if (component === null) return null;
  if (component.none) return 0;
  if (component.unit === '%') return clamp(component.value / 100, 0, 1);
  if (component.unit === '') return clamp(component.value, 0, 1);
  return null;
}

/** Alpha in steps of 1 / 255, the way a browser keeps it in eight bits. */
function quantise(alpha: number): number {
  return Math.round(alpha * 255) / 255;
}

function parseRgbArguments(inner: string): ParsedColour {
  const args = splitArguments(inner);
  const shape = args === null ? null : layout(args);
  if (args === null || shape === null) return INVALID;
  const parts = args.tokens.slice(0, 3).map(readComponent);
  const alpha = alphaOf(shape.alphaIndex >= 0 ? args.tokens[shape.alphaIndex] : undefined);
  if (alpha === null || parts.some((part) => part === null)) return INVALID;
  const components = parts as Component[];
  if (shape.legacy) {
    // The comma syntax takes three numbers or three percentages, never none and never a mixture.
    if (components.some((component) => component.none || (component.unit !== '' && component.unit !== '%')))
      return INVALID;
    const percentages = components.filter((component) => !component.none && component.unit === '%').length;
    if (percentages !== 0 && percentages !== 3) return INVALID;
  }
  const channels = components.map((component) => {
    if (component.none) return 0;
    if (component.unit === '%') return Math.round((clamp(component.value, 0, 100) * 255) / 100) + 0;
    if (component.unit === '') return Math.round(clamp(component.value, 0, 255)) + 0;
    return null;
  });
  if (channels.some((channel) => channel === null)) return INVALID;
  const [red, green, blue] = channels as [number, number, number];
  return { kind: 'srgb', rgba: [red, green, blue, quantise(alpha)] };
}

/** CSS Color Module Level 4, section 7.1: hsl to sRGB, with hue in degrees and saturation and lightness from 0 to 1. */
function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number): number => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) + 0;
  };
  return [channel(0), channel(8), channel(4)];
}

function parseHslArguments(inner: string): ParsedColour {
  const args = splitArguments(inner);
  const shape = args === null ? null : layout(args);
  if (args === null || shape === null) return INVALID;
  const [hueToken, saturationToken, lightnessToken] = args.tokens as [string, string, string];
  const hue = readComponent(hueToken);
  const saturation = readComponent(saturationToken);
  const lightness = readComponent(lightnessToken);
  const alpha = alphaOf(shape.alphaIndex >= 0 ? args.tokens[shape.alphaIndex] : undefined);
  if (hue === null || saturation === null || lightness === null || alpha === null) return INVALID;
  let degrees = 0;
  if (!hue.none) {
    if (hue.unit === '%') return INVALID;
    degrees = hue.value;
    if (hue.unit === 'grad') degrees = (hue.value * 360) / 400;
    else if (hue.unit === 'rad') degrees = (hue.value * 180) / Math.PI;
    else if (hue.unit === 'turn') degrees = hue.value * 360;
  }
  degrees = ((degrees % 360) + 360) % 360;
  const fraction = (component: Component): number | null => {
    if (component.none) return 0;
    // The space syntax also takes a plain number as a percentage; the comma syntax needs the percent sign.
    if (component.unit === '%' || (component.unit === '' && !shape.legacy)) return clamp(component.value / 100, 0, 1);
    return null;
  };
  const s = fraction(saturation);
  const l = fraction(lightness);
  if (s === null || l === null) return INVALID;
  const [red, green, blue] = hslToRgb(degrees, s, l);
  return { kind: 'srgb', rgba: [red, green, blue, quantise(alpha)] };
}

function isHexDigit(unit: number): boolean {
  return (unit >= 0x30 && unit <= 0x39) || (unit >= 0x41 && unit <= 0x46) || (unit >= 0x61 && unit <= 0x66);
}

function parseHex(value: string): ParsedColour {
  const digits = value.slice(1);
  if (digits.length !== 3 && digits.length !== 4 && digits.length !== 6 && digits.length !== 8) return INVALID;
  for (let i = 0; i < digits.length; i++) if (!isHexDigit(digits.charCodeAt(i))) return INVALID;
  const short = digits.length <= 4;
  const read = (index: number): number =>
    short ? parseInt(digits[index]! + digits[index]!, 16) : parseInt(digits[index * 2]! + digits[index * 2 + 1]!, 16);
  const count = short ? digits.length : digits.length / 2;
  return { kind: 'srgb', rgba: [read(0), read(1), read(2), count === 4 ? read(3) / 255 : 1] };
}

/** True when the parentheses in the text open and close in order, ending at depth zero. */
function balanced(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** Parses one colour value (the text of theme_color or background_color) as the manifest draft asks. */
export function parseCssColour(text: string): ParsedColour {
  const value = stripAscii(text);
  if (value === '') return INVALID;
  if (value[0] === '#') return parseHex(value);
  const open = value.indexOf('(');
  if (open < 0) {
    const name = asciiLowercase(value);
    if (name === 'transparent') return { kind: 'srgb', rgba: [0, 0, 0, 0] };
    const named = NAMED_COLOURS.get(name);
    return named === undefined ? INVALID : { kind: 'srgb', rgba: [named[0], named[1], named[2], 1] };
  }
  if (value[value.length - 1] !== ')') return INVALID;
  const name = asciiLowercase(value.slice(0, open));
  const inner = value.slice(open + 1, value.length - 1);
  if (name === 'rgb' || name === 'rgba' || name === 'hsl' || name === 'hsla') {
    if (inner.includes('(') || inner.includes(')')) return INVALID;
    return name.startsWith('rgb') ? parseRgbArguments(inner) : parseHslArguments(inner);
  }
  if (UNCHECKED_FUNCTIONS.has(name) && stripAscii(inner) !== '' && balanced(value)) return UNCHECKED;
  return INVALID;
}
