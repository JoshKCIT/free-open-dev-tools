/**
 * The 15 bundled FIGlet fonts whose own header carries FIGlet's permission
 * line ("Permission is hereby given to modify this font, as long as the
 * modifier's name is placed on a comment line."), confirmed by fetching
 * every one of FIGlet 2.2.5's fonts directly and reading its header this
 * session -- see FIGLET-NOTICE.txt for the full per-font evidence. Three
 * fonts published in the same repository (ivrit, mnemonic, banner) carry no
 * such line and are deliberately excluded (D-41).
 */
import { STANDARD_FLF } from './standard';
import { SMALL_FLF } from './small';
import { SLANT_FLF } from './slant';
import { BIG_FLF } from './big';
import { BLOCK_FLF } from './block';
import { BUBBLE_FLF } from './bubble';
import { DIGITAL_FLF } from './digital';
import { LEAN_FLF } from './lean';
import { MINI_FLF } from './mini';
import { SCRIPT_FLF } from './script';
import { SHADOW_FLF } from './shadow';
import { SMSCRIPT_FLF } from './smscript';
import { SMSHADOW_FLF } from './smshadow';
import { SMSLANT_FLF } from './smslant';
import { TERM_FLF } from './term';

/** The 15 D-41 font names, in the order this package documents and tests them. */
export const FONT_NAMES = [
  'standard',
  'small',
  'slant',
  'big',
  'block',
  'bubble',
  'digital',
  'lean',
  'mini',
  'script',
  'shadow',
  'smscript',
  'smshadow',
  'smslant',
  'term',
] as const;

export type FontName = (typeof FONT_NAMES)[number];

/** Each bundled font's raw FIGfont version 2 file text, by name. */
export const FONTS: Readonly<Record<FontName, string>> = {
  standard: STANDARD_FLF,
  small: SMALL_FLF,
  slant: SLANT_FLF,
  big: BIG_FLF,
  block: BLOCK_FLF,
  bubble: BUBBLE_FLF,
  digital: DIGITAL_FLF,
  lean: LEAN_FLF,
  mini: MINI_FLF,
  script: SCRIPT_FLF,
  shadow: SHADOW_FLF,
  smscript: SMSCRIPT_FLF,
  smshadow: SMSHADOW_FLF,
  smslant: SMSLANT_FLF,
  term: TERM_FLF,
};
