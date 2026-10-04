import meta from './meta.json';
import { CssSafetyError, clampNumber, formatHexColor, formatLength, parseHexColor, type RgbaColor } from './css-safe';
import {
  ALLOWED_SELECTORS,
  controlCss,
  findUnsafeControlCss,
  type ControlRule,
  type ControlSheet,
} from './control-css';

export { meta, ALLOWED_SELECTORS, controlCss, findUnsafeControlCss };

export class FormControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormControlError';
  }
}

/** The five control families, by id with the label shown on the page. */
export const CONTROLS: ReadonlyMap<string, string> = new Map([
  ['button', 'Button'],
  ['switch', 'Switch'],
  ['checkbox', 'Checkbox'],
  ['radio', 'Radio buttons'],
  ['range', 'Range slider'],
]);

/** The six presets, by id with the label shown on the page. */
export const PRESETS: ReadonlyMap<string, string> = new Map([
  ['plain', 'Plain'],
  ['rounded', 'Rounded'],
  ['pill', 'Pill'],
  ['outline', 'Outline'],
  ['soft', 'Soft'],
  ['bold', 'Bold'],
]);

export interface StyleControlsOptions {
  /** One of CONTROLS. Default 'button'. */
  control?: string;
  /** One of PRESETS. Default 'rounded'. */
  preset?: string;
  /** The accent colour, a 3, 4, 6 or 8 digit hex colour. Default #2563eb. */
  accent?: string;
  /** The colour behind the controls. Default #ffffff. */
  background?: string;
  /** The label text, at most 40 characters; an empty one becomes Option. */
  text?: string;
  /** The size of the control in pixels, clamped to 12 to 32. Default 20. */
  size?: number;
  /** The corner radius in pixels, clamped to 0 to 24; read only where usesRadius is true. Default 6. */
  radius?: number;
  /** Adds a disabled copy of the control (the last of the three radio buttons). Default false. */
  showDisabled?: boolean;
}

export interface StyleControlsResult {
  /** The stylesheet, written by the small writer in control-css.ts. */
  css: string;
  /** The native controls the CSS styles, on a surface of the background colour. */
  markup: string;
  /** The content of the script-free frame: a style element holding exactly css, then the markup. */
  html: string;
  warnings: string[];
}

const DEFAULT_ACCENT = '#2563eb';
const DEFAULT_BACKGROUND = '#ffffff';
const DEFAULT_LABEL = 'Option';
const MAX_LABEL_CHARACTERS = 40;
const MIN_CONTRAST = 3;
const WHITE: RgbaColor = { r: 255, g: 255, b: 255, alpha: 1 };
const BLACK: RgbaColor = { r: 0, g: 0, b: 0, alpha: 1 };
const DARK_INK: RgbaColor = { r: 17, g: 24, b: 39, alpha: 1 };
/** The presets that read the corner radius, and the controls that have corners to round. */
const RADIUS_PRESETS: ReadonlySet<string> = new Set(['rounded', 'outline', 'soft', 'bold']);
const RADIUS_CONTROLS: ReadonlySet<string> = new Set(['button', 'checkbox', 'range']);

/** True when the corner radius changes anything for this control and preset; the page hides the field otherwise. */
export function usesRadius(control: string, preset: string): boolean {
  return RADIUS_CONTROLS.has(control) && RADIUS_PRESETS.has(preset);
}

function colourOf(value: string | undefined, fallback: string, label: string): RgbaColor {
  try {
    return parseHexColor(value ?? fallback, label);
  } catch (err) {
    if (err instanceof CssSafetyError) {
      throw new FormControlError(`${label} is not a valid hexadecimal colour: use 3, 4, 6 or 8 digits after a #.`);
    }
    throw err;
  }
}

/**
 * For a page whose colour box can hold any typed text: the value when it is a 3, 4, 6 or 8 digit hex colour, otherwise
 * the fallback with a warning that names the field and never repeats what was typed.
 */
export function colourOrDefault(
  value: string,
  fallback: string,
  label: string,
): { colour: string; warning: string | null } {
  try {
    parseHexColor(value, label);
    return { colour: value, warning: null };
  } catch (err) {
    if (err instanceof CssSafetyError) {
      return {
        colour: fallback,
        warning: `${label} was not a valid hexadecimal colour, so ${fallback} was used instead.`,
      };
    }
    throw err;
  }
}

function choose(
  value: string | undefined,
  allowed: ReadonlyMap<string, string>,
  fallback: string,
  label: string,
): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new FormControlError(`${label} is not one of the choices on offer.`);
  }
  return value;
}

/** The linear light of one 8-bit channel, per the WCAG 2.2 definition of relative luminance. */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(colour: RgbaColor): number {
  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b);
}

function ratio(a: RgbaColor, b: RgbaColor): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The WCAG 2.2 contrast ratio of two hex colours (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio): the lighter relative
 * luminance plus 0.05 over the darker plus 0.05, from 1 (equal) to 21 (black on white). Transparency is ignored.
 */
export function contrastRatio(a: string, b: string): number {
  return ratio(colourOf(a, a, 'Colour'), colourOf(b, b, 'Colour'));
}

function mix(a: RgbaColor, b: RgbaColor, share: number): RgbaColor {
  const channel = (x: number, y: number) => x * (1 - share) + y * share;
  return { r: channel(a.r, b.r), g: channel(a.g, b.g), b: channel(a.b, b.b), alpha: 1 };
}

/** Light or dark text, whichever reads better on the colour. */
function readableOn(colour: RgbaColor): RgbaColor {
  return ratio(colour, WHITE) >= ratio(colour, DARK_INK) ? WHITE : DARK_INK;
}

function opaque(colour: RgbaColor): RgbaColor {
  return { ...colour, alpha: 1 };
}

/** Removes control, line-break and bidirectional characters, collapses spaces, cuts to the limit; an empty one is Option. */
function cleanLabel(text: string | undefined): string {
  if (typeof text !== 'string') return DEFAULT_LABEL;
  let out = '';
  let lastSpace = true;
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const hidden =
      cp <= 0x20 ||
      (cp >= 0x7f && cp <= 0xa0) ||
      cp === 0x061c ||
      cp === 0x200e ||
      cp === 0x200f ||
      (cp >= 0x2028 && cp <= 0x202e) ||
      (cp >= 0x2066 && cp <= 0x2069) ||
      cp === 0xfeff;
    if (hidden) {
      if (!lastSpace) out += ' ';
      lastSpace = true;
    } else {
      out += ch;
      lastSpace = false;
    }
    count++;
    if (count >= 4096) break;
  }
  const cut = Array.from(out.trim()).slice(0, MAX_LABEL_CHARACTERS).join('').trim();
  return cut === '' ? DEFAULT_LABEL : cut;
}

function escapeHtml(text: string): string {
  let out = '';
  for (const ch of text) {
    switch (ch) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&#39;';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/** The look of one preset, in the terms the rules below use. */
interface Look {
  /** Width of the border, ring or edge in pixels. */
  edge: number;
  fill: 'solid' | 'outline' | 'soft';
  /** How corners are drawn: none (square), the radius field, or fully round. */
  corners: 'square' | 'field' | 'full';
  shadow: boolean;
}

const LOOKS: ReadonlyMap<string, Look> = new Map([
  ['plain', { edge: 1, fill: 'solid', corners: 'square', shadow: false }],
  ['rounded', { edge: 1, fill: 'solid', corners: 'field', shadow: false }],
  ['pill', { edge: 1, fill: 'solid', corners: 'full', shadow: false }],
  ['outline', { edge: 2, fill: 'outline', corners: 'field', shadow: false }],
  ['soft', { edge: 1, fill: 'soft', corners: 'field', shadow: false }],
  ['bold', { edge: 3, fill: 'solid', corners: 'field', shadow: true }],
]);

interface Palette {
  accent: string;
  background: string;
  /** Readable text on the background. */
  ink: string;
  /** Readable text on the accent. */
  onAccent: string;
  /** The accent when it contrasts enough with the background, otherwise the text colour. */
  accentOnBackground: string;
  /** The off-state edge and track. */
  track: string;
  /** The off-state track of a soft switch. */
  softTrack: string;
  tint: string;
  tintStrong: string;
  /** A darker accent for a hovered solid button and a bold edge. */
  darkAccent: string;
  /** The focus ring. */
  ring: string;
}

function paletteOf(accent: RgbaColor, background: RgbaColor): Palette {
  const ink = readableOn(background);
  const accentVisible = ratio(accent, background) >= MIN_CONTRAST;
  const track = mix(background, ink, 0.5);
  const hex = (c: RgbaColor) => formatHexColor(opaque(c));
  return {
    accent: hex(accent),
    background: hex(background),
    ink: hex(ink),
    onAccent: hex(readableOn(accent)),
    accentOnBackground: hex(accentVisible ? accent : ink),
    track: hex(track),
    softTrack: hex(mix(background, track, 0.35)),
    tint: hex(mix(background, accent, 0.18)),
    tintStrong: hex(mix(background, accent, 0.32)),
    darkAccent: hex(mix(accent, BLACK, 0.3)),
    ring: hex(accentVisible ? accent : ink),
  };
}

type Declarations = [string, string][];

const px = (n: number) => formatLength(n, 'px');
const rule = (selector: string, declarations: Declarations): ControlRule => ({ selector, declarations });
const FADE = 'background-color 0.15s ease, border-color 0.15s ease';
const STOP: Declarations = [['transition', 'none']];

interface Geometry {
  size: number;
  radius: number;
}

/** The corner radius of a part that is `max` pixels at most. */
function cornerOf(look: Look, geometry: Geometry, max: number): number {
  if (look.corners === 'square') return 0;
  if (look.corners === 'full') return max;
  return Math.min(geometry.radius, max);
}

function focusRule(selector: string, palette: Palette, offset: number): ControlRule {
  return rule(selector, [
    ['outline', `3px solid ${palette.ring}`],
    ['outline-offset', px(offset)],
  ]);
}

const DISABLED: Declarations = [
  ['opacity', '0.5'],
  ['cursor', 'not-allowed'],
];

function surfaceRules(palette: Palette): ControlRule[] {
  return [
    rule('.fc-surface', [
      ['background-color', palette.background],
      ['color', palette.ink],
      ['padding', '16px'],
      ['border-radius', '8px'],
      ['font-family', 'system-ui, sans-serif'],
      ['font-size', '15px'],
      ['line-height', '1.55'],
    ]),
  ];
}

function buttonSheet(look: Look, palette: Palette, geometry: Geometry): ControlSheet {
  const { fill } = look;
  const background = fill === 'solid' ? palette.accent : fill === 'outline' ? palette.background : palette.tint;
  const colour = fill === 'solid' ? palette.onAccent : palette.accentOnBackground;
  const edgeColour =
    fill === 'solid' ? (look.shadow ? palette.darkAccent : palette.accent) : palette.accentOnBackground;
  const hover = fill === 'solid' ? palette.darkAccent : fill === 'outline' ? palette.tint : palette.tintStrong;
  const base: Declarations = [
    ['appearance', 'none'],
    ['font-family', 'inherit'],
    ['font-size', px(geometry.size)],
    ['font-weight', '600'],
    ['line-height', '1.2'],
    ['padding', `${px(geometry.size * 0.5)} ${px(geometry.size)}`],
    ['margin', '0 0 8px 0'],
    ['border', `${px(look.edge)} solid ${edgeColour}`],
    ['border-radius', px(cornerOf(look, geometry, 999))],
    ['background-color', background],
    ['color', colour],
    ['cursor', 'pointer'],
    ['transition', `${FADE}, transform 0.1s ease`],
  ];
  if (look.shadow) base.push(['box-shadow', `0 2px 0 ${palette.darkAccent}`]);
  return {
    rules: [
      rule('.fc-button', base),
      rule('.fc-button:hover', [['background-color', hover]]),
      focusRule('.fc-button:focus-visible', palette, 2),
      rule('.fc-button:active', [['transform', 'translateY(1px)']]),
      rule('.fc-button:disabled', [['background-color', background], ['transform', 'translateY(0px)'], ...DISABLED]),
    ],
    reducedMotion: [rule('.fc-button', STOP)],
  };
}

function switchSheet(look: Look, palette: Palette, geometry: Geometry): ControlSheet {
  const { size } = geometry;
  const gap = 3;
  const thumb = size - 2 * gap;
  const width = size * 1.8;
  const offTrack =
    look.fill === 'solid' ? palette.track : look.fill === 'outline' ? palette.background : palette.softTrack;
  const offThumb = look.fill === 'solid' ? '#ffffff' : palette.track;
  const onTrack =
    look.fill === 'solid' ? palette.accent : look.fill === 'outline' ? palette.background : palette.tintStrong;
  const onEdge = look.fill === 'solid' ? palette.accent : palette.accentOnBackground;
  const onThumb = look.fill === 'solid' ? palette.onAccent : palette.accentOnBackground;
  const ring = (colour: string) => `inset 0 0 0 ${px(look.edge)} ${colour}`;
  return {
    rules: [
      rule('.fc-switch', [
        ['appearance', 'none'],
        ['accent-color', palette.accent],
        ['position', 'relative'],
        ['width', px(width)],
        ['height', px(size)],
        ['margin', '0 10px 8px 0'],
        ['vertical-align', 'middle'],
        ['border-radius', px(look.corners === 'square' ? 0 : size / 2)],
        ['background-color', offTrack],
        ['box-shadow', ring(palette.track)],
        ['cursor', 'pointer'],
        ['transition', `${FADE}, box-shadow 0.15s ease`],
      ]),
      rule('.fc-switch::before', [
        ['content', '""'],
        ['position', 'absolute'],
        ['top', px(gap)],
        ['left', px(gap)],
        ['width', px(thumb)],
        ['height', px(thumb)],
        ['border-radius', look.corners === 'square' ? '0' : '50%'],
        ['background-color', offThumb],
        ['transition', 'transform 0.15s ease, background-color 0.15s ease'],
      ]),
      rule('.fc-switch:hover', [['box-shadow', ring(palette.accentOnBackground)]]),
      focusRule('.fc-switch:focus-visible', palette, 2),
      rule('.fc-switch:checked', [
        ['background-color', onTrack],
        ['box-shadow', ring(onEdge)],
      ]),
      rule('.fc-switch:checked::before', [
        ['transform', `translateX(${px(width - size)})`],
        ['background-color', onThumb],
      ]),
      rule('.fc-switch:disabled', DISABLED),
    ],
    reducedMotion: [rule('.fc-switch', STOP), rule('.fc-switch::before', STOP)],
  };
}

function checkboxSheet(look: Look, palette: Palette, geometry: Geometry): ControlSheet {
  const { size } = geometry;
  const onFill =
    look.fill === 'solid' ? palette.accent : look.fill === 'outline' ? palette.background : palette.tintStrong;
  const onEdge = look.fill === 'solid' ? palette.accent : palette.accentOnBackground;
  const onMark = look.fill === 'solid' ? palette.onAccent : palette.accentOnBackground;
  const tick = Math.max(2, Math.round(size * 0.12));
  return {
    rules: [
      rule('.fc-check', [
        ['appearance', 'none'],
        ['accent-color', palette.accent],
        ['position', 'relative'],
        ['width', px(size)],
        ['height', px(size)],
        ['margin', '0 10px 8px 0'],
        ['vertical-align', 'middle'],
        ['border', `${px(look.edge)} solid ${palette.track}`],
        ['border-radius', px(cornerOf(look, geometry, size / 2))],
        ['background-color', palette.background],
        ['cursor', 'pointer'],
        ['transition', FADE],
      ]),
      rule('.fc-check:hover', [['border-color', palette.accentOnBackground]]),
      focusRule('.fc-check:focus-visible', palette, 2),
      rule('.fc-check:checked', [
        ['background-color', onFill],
        ['border-color', onEdge],
      ]),
      rule('.fc-check:checked::before', [
        ['content', '""'],
        ['position', 'absolute'],
        ['left', '32%'],
        ['top', '8%'],
        ['width', '28%'],
        ['height', '56%'],
        ['border-style', 'solid'],
        ['border-color', onMark],
        ['border-width', `0 ${px(tick)} ${px(tick)} 0`],
        ['transform', 'rotate(45deg)'],
      ]),
      rule('.fc-check:disabled', DISABLED),
    ],
    reducedMotion: [rule('.fc-check', STOP)],
  };
}

function radioSheet(look: Look, palette: Palette, geometry: Geometry): ControlSheet {
  const { size } = geometry;
  const onEdge = look.fill === 'solid' ? palette.accent : palette.accentOnBackground;
  const gapAroundDot = Math.max(1, (size - 2 * look.edge) * 0.25);
  return {
    rules: [
      rule('.fc-radio', [
        ['appearance', 'none'],
        ['accent-color', palette.accent],
        ['width', px(size)],
        ['height', px(size)],
        ['margin', '0 10px 8px 0'],
        ['vertical-align', 'middle'],
        ['border', `${px(look.edge)} solid ${palette.track}`],
        ['border-radius', '50%'],
        ['background-color', palette.background],
        ['cursor', 'pointer'],
        ['transition', FADE],
      ]),
      rule('.fc-radio:hover', [['border-color', palette.accentOnBackground]]),
      focusRule('.fc-radio:focus-visible', palette, 2),
      rule('.fc-radio:checked', [
        ['border-color', onEdge],
        ['background-color', onEdge],
        ['box-shadow', `inset 0 0 0 ${px(gapAroundDot)} ${palette.background}`],
      ]),
      rule('.fc-radio:disabled', DISABLED),
    ],
    reducedMotion: [rule('.fc-radio', STOP)],
  };
}

function rangeSheet(look: Look, palette: Palette, geometry: Geometry): ControlSheet {
  const { size } = geometry;
  const track = Math.max(4, Math.round(size * 0.3));
  const trackCorner = px(cornerOf(look, geometry, track / 2));
  const thumbCorner = px(cornerOf(look, geometry, size / 2));
  const onFill =
    look.fill === 'solid' ? palette.accent : look.fill === 'outline' ? palette.background : palette.tintStrong;
  const onEdge = look.fill === 'solid' ? palette.accent : palette.accentOnBackground;
  const trackRule: Declarations = [
    ['height', px(track)],
    ['background-color', palette.track],
    ['border-radius', trackCorner],
  ];
  const thumbShared: Declarations = [
    ['width', px(size)],
    ['height', px(size)],
    ['background-color', onFill],
    ['border-radius', thumbCorner],
    ['box-shadow', `inset 0 0 0 ${px(look.edge)} ${onEdge}`],
    ['transition', 'transform 0.1s ease'],
  ];
  const grow: Declarations = [['transform', 'scale(1.15)']];
  return {
    rules: [
      rule('.fc-range', [
        ['appearance', 'none'],
        ['accent-color', palette.accent],
        ['width', '200px'],
        ['height', px(size)],
        ['margin', '0 0 8px 10px'],
        ['vertical-align', 'middle'],
        ['background-color', palette.background],
        ['cursor', 'pointer'],
      ]),
      rule('.fc-range::-webkit-slider-runnable-track', trackRule),
      rule('.fc-range::-moz-range-track', trackRule),
      rule('.fc-range::-webkit-slider-thumb', [
        ['appearance', 'none'],
        ['margin-top', px((track - size) / 2)],
        ...thumbShared,
      ]),
      rule('.fc-range::-moz-range-thumb', [['border', '0'], ...thumbShared]),
      focusRule('.fc-range:focus-visible', palette, 4),
      rule('.fc-range:active::-webkit-slider-thumb', grow),
      rule('.fc-range:active::-moz-range-thumb', grow),
      rule('.fc-range:disabled', DISABLED),
    ],
    reducedMotion: [rule('.fc-range::-webkit-slider-thumb', STOP), rule('.fc-range::-moz-range-thumb', STOP)],
  };
}

const SHEETS: ReadonlyMap<string, (look: Look, palette: Palette, geometry: Geometry) => ControlSheet> = new Map([
  ['button', buttonSheet],
  ['switch', switchSheet],
  ['checkbox', checkboxSheet],
  ['radio', radioSheet],
  ['range', rangeSheet],
]);

/** The markup of one control family: native elements only, in rows on the surface. */
function markupOf(control: string, label: string, showDisabled: boolean): string {
  const text = escapeHtml(label);
  const off = (disabled: boolean) => (disabled ? ' disabled' : '');
  const rows: string[] = [];
  const copies = showDisabled ? [false, true] : [false];
  if (control === 'radio') {
    for (let i = 1; i <= 3; i++) {
      const disabled = showDisabled && i === 3;
      rows.push(
        `<label><input class="fc-radio" type="radio" name="fc-choice" value="${i}"${i === 1 ? ' checked' : ''}${off(disabled)}> ${text} ${i}</label>`,
      );
    }
  } else {
    for (const disabled of copies) {
      if (control === 'button') {
        rows.push(`<button type="button" class="fc-button"${off(disabled)}>${text}</button>`);
      } else if (control === 'switch') {
        rows.push(`<label><input class="fc-switch" type="checkbox" role="switch"${off(disabled)}> ${text}</label>`);
      } else if (control === 'checkbox') {
        rows.push(`<label><input class="fc-check" type="checkbox"${off(disabled)}> ${text}</label>`);
      } else {
        rows.push(
          `<label>${text} <input class="fc-range" type="range" min="0" max="100" value="40"${off(disabled)}></label>`,
        );
      }
    }
  }
  return `<div class="fc-surface">\n${rows.map((row) => `  <div>${row}</div>`).join('\n')}\n</div>`;
}

/**
 * Styles one family of native form controls: a button, a switch (a checkbox with the switch role, WAI-ARIA 1.2,
 * https://www.w3.org/TR/wai-aria-1.2/#switch), a checkbox, three radio buttons or a range slider. Only the look changes:
 * the markup is the native element, appearance is turned off only where the same rule draws the replacement, every control
 * keeps a :focus-visible outline of at least 2 pixels (CSS Basic User Interface Level 4, https://www.w3.org/TR/css-ui-4/),
 * and transitions are turned off under the exact reduced-motion media query. The CSS is written by the closed-list writer
 * in control-css.ts; label text only ever reaches the markup, as escaped text.
 */
export function styleControls(options: StyleControlsOptions): StyleControlsResult {
  const warnings: string[] = [];
  const control = choose(options.control, CONTROLS, 'button', 'Control');
  const preset = choose(options.preset, PRESETS, 'rounded', 'Preset');
  const accentColour = colourOf(options.accent, DEFAULT_ACCENT, 'Accent');
  const backgroundColour = colourOf(options.background, DEFAULT_BACKGROUND, 'Background');

  const sizeResult = clampNumber('Size', options.size as number, 12, 32, 20);
  if (options.size === undefined) sizeResult.warning = null;
  if (sizeResult.warning) warnings.push(sizeResult.warning);
  let radius = 6;
  if (usesRadius(control, preset)) {
    const radiusResult = clampNumber('Corner radius', options.radius as number, 0, 24, 6);
    if (options.radius === undefined) radiusResult.warning = null;
    if (radiusResult.warning) warnings.push(radiusResult.warning);
    radius = radiusResult.value;
  }
  if (accentColour.alpha < 1) warnings.push('Accent had transparency, which is ignored so the controls stay readable.');
  if (backgroundColour.alpha < 1) {
    warnings.push('Background had transparency, which is ignored so the controls stay readable.');
  }
  const contrast = ratio(opaque(accentColour), opaque(backgroundColour));
  if (contrast < MIN_CONTRAST) {
    warnings.push(
      `Accent and background have a contrast of ${(Math.floor(contrast * 100) / 100).toFixed(2)} to 1, below the 3 to 1 that WCAG 2.2 (success criterion 1.4.11) asks for, so the checked state and the focus ring may not be told apart from the background. The focus ring uses the text colour instead.`,
    );
  }

  const look = LOOKS.get(preset)!;
  const palette = paletteOf(accentColour, backgroundColour);
  const sheet = SHEETS.get(control)!(look, palette, { size: sizeResult.value, radius });
  const surface = surfaceRules(palette);
  try {
    const css = controlCss({ rules: [...surface, ...sheet.rules], reducedMotion: sheet.reducedMotion });
    const markup = markupOf(control, cleanLabel(options.text), options.showDisabled === true);
    return { css, markup, html: `<style>${css}</style>${markup}`, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new FormControlError(err.message);
    throw err;
  }
}
