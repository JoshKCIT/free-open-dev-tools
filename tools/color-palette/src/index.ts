import meta from './meta.json';
import { parseColor, serializeColor, type Color } from './color-space';
import {
  harmony,
  mixSteps,
  blend as blendColors,
  forDisplay,
  HARMONIES,
  type HarmonyName,
  type MixSpace,
  type HarmonySpace,
} from './palette';

export { meta, HARMONIES };

export class PaletteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaletteError';
  }
}

export type PaletteMode = 'harmony' | 'tints' | 'shades' | 'tones' | 'blend';

export interface BuildPaletteOptions {
  base?: string;
  mode?: PaletteMode;
  harmonyName?: HarmonyName;
  steps?: number;
  second?: string;
  space?: HarmonySpace | MixSpace;
}

export interface Swatch {
  /** The hex string label shown under the swatch. */
  label: string;
  /** The OKLCH string shown as a caption. */
  caption: string;
  /** The hex value used to paint the swatch, from this tool's own serialiser. */
  css: string;
  /** Whether this swatch was gamut-mapped into sRGB for display. */
  mapped: boolean;
}

export interface BuildPaletteResult {
  swatches: Swatch[];
  /** A `:root` block of `--palette-<n>` custom properties, text only. */
  css: string;
  table: { index: number; hex: string; oklch: string; mapped: boolean }[];
  warnings: string[];
}

const DEFAULT_BASE = '#2563eb';
const DEFAULT_SECOND = '#f97316';
const WHITE = 'oklab(1 0 0)';
const BLACK = 'oklab(0 0 0)';
const MID_GREY = 'oklab(0.6 0 0)';

function safeParse(text: string | undefined, fallback: string, field: string, warnings: string[]): Color {
  try {
    return parseColor((text ?? '').trim() === '' ? fallback : text!);
  } catch {
    warnings.push(`${field} was not a usable colour, so the default was used instead.`);
    return parseColor(fallback);
  }
}

function toSwatch(color: Color): Swatch {
  const { color: displayColor, mapped } = forDisplay(color);
  const hex = serializeColor(displayColor, 'hex');
  const oklch = serializeColor(color, 'oklch');
  return { label: hex, caption: oklch, css: hex, mapped };
}

/**
 * Builds a palette from `base`: `mode: 'harmony'` rotates its hue by
 * `harmonyName`'s own offsets; `'tints'`/`'shades'`/`'tones'` mix it toward
 * white, black or a mid grey respectively in `steps` steps; `'blend'` mixes
 * it toward `second`. `space` is `'oklch'` or `'hsl'` for harmonies,
 * `'oklab'` (default), `'oklch'` or `'srgb'` for a mix.
 */
export function buildPalette(options: BuildPaletteOptions): BuildPaletteResult {
  const warnings: string[] = [];
  const base = safeParse(options.base, DEFAULT_BASE, 'Base colour', warnings);
  const mode = options.mode ?? 'harmony';
  const steps = Math.max(3, Math.min(12, Math.round(options.steps ?? 5)));

  let colors: Color[];
  if (mode === 'harmony') {
    const space: HarmonySpace = options.space === 'hsl' ? 'hsl' : 'oklch';
    const name: HarmonyName = (options.harmonyName ?? 'complementary') as HarmonyName;
    if (!(name in HARMONIES)) throw new PaletteError(`"${name}" is not a known harmony name`);
    colors = harmony(base, name, space);
  } else if (mode === 'blend') {
    const second = safeParse(options.second, DEFAULT_SECOND, 'Second colour', warnings);
    const space: MixSpace = options.space === 'oklch' || options.space === 'srgb' ? options.space : 'oklab';
    colors = blendColors(base, second, steps, space);
  } else {
    const targetText = mode === 'tints' ? WHITE : mode === 'shades' ? BLACK : MID_GREY;
    const target = parseColor(targetText);
    const space: MixSpace = options.space === 'oklch' || options.space === 'srgb' ? options.space : 'oklab';
    colors = mixSteps(base, target, steps, space);
  }

  const swatches = colors.map((c) => toSwatch(c));
  const table = swatches.map((s, i) => ({ index: i + 1, hex: s.label, oklch: s.caption, mapped: s.mapped }));
  const cssLines = swatches.map((s, i) => `  --palette-${i + 1}: ${s.css};`);
  const css = `:root {\n${cssLines.join('\n')}\n}`;

  return { swatches, css, table, warnings };
}
