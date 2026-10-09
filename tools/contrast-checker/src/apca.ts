/**
 * APCA (Accessible Perceptual Contrast Algorithm), version 0.1.9 (the "0.98G-4g"
 * constants), independently implemented from Myndex's own published
 * documentation (https://git.apcacontrast.com/documentation/README.html),
 * credited to the APCA project and its authors. This is an independent
 * implementation, not the `apca-w3` package: that package's own "Limited W3
 * License" restricts use to web content in support of WCAG accessibility
 * guidelines and forbids unrestricted commercial redistribution, which is
 * not compatible with this MIT-licensed project shipping and redistributing
 * its own source freely -- so its source and prose are never read,
 * copied or installed here; only the published numeric constants and the
 * "Plain English Steps" below are used, rewritten in this project's own
 * words and code.
 *
 * APCA produces a signed "Lightness Contrast" (Lc) figure, roughly -108 to
 * 106, not a ratio: a positive Lc means dark text on a light background, a
 * negative Lc means light text on a dark background. It is NOT a WCAG 2.2
 * result and must never be shown as one, combined with a WCAG ratio, or
 * given a pass/fail mark against a WCAG threshold.
 */

import type { RgbColor } from './wcag';

export const APCA_VERSION = 'APCA 0.1.9 (0.98G-4g)';
export const APCA_LABEL = 'APCA Lc (independent implementation, not a WCAG 2.2 result)';

// Exponents = { mainTRC: 2.4, normBG: 0.56, normTXT: 0.57, revTXT: 0.62, revBG: 0.65 }
const MAIN_TRC = 2.4;
const NORM_BG_EXP = 0.56;
const NORM_TXT_EXP = 0.57;
const REV_TXT_EXP = 0.62;
const REV_BG_EXP = 0.65;

// ColorSpace = { sRco: 0.2126729, sGco: 0.7151522, sBco: 0.0721750 }
const S_RCO = 0.2126729;
const S_GCO = 0.7151522;
const S_BCO = 0.072175;

// Clamps = { blkThrs: 0.022, blkClmp: 1.414, loClip: 0.001, deltaYmin: 0.0005 }
// (loClip/deltaYmin guard a fully-vectorised port's edge cases this direct,
// scalar implementation does not need separately: an input Y is already a
// finite 0-1 value from `screenY`, never a raw unclamped negative.)
const BLACK_THRESHOLD = 0.022;
const BLACK_CLAMP_EXP = 1.414;

// Scalers = { scaleBoW: 1.14, loBoWthresh: 0.035991, loBoWfactor: 27.7847239587675, loBoWoffset: 0.027, scaleWoB: 1.14, ... }
const SCALE = 1.14;
const LOW_THRESHOLD = 0.1;
const LOW_OFFSET = 0.027;

/** "Y = (R/255) ^2.4 * 0.2126 + (G/255) ^2.4 * 0.7152 + (B/255) ^2.4 * 0.0722" */
function screenY(color: RgbColor): number {
  return (
    Math.pow(color.r / 255, MAIN_TRC) * S_RCO +
    Math.pow(color.g / 255, MAIN_TRC) * S_GCO +
    Math.pow(color.b / 255, MAIN_TRC) * S_BCO
  );
}

/**
 * "Soft-clamp the colors but only if it is less than 0.022 Y: subtract the
 * color Y from 0.022, then apply a ^1.414 exponent to the result, then add
 * that result back to the Y of the darker color: clampedY = (0.022 - Y)
 * ^1.414 + Y"
 */
function softClamp(y: number): number {
  if (y >= BLACK_THRESHOLD) return y;
  return Math.pow(BLACK_THRESHOLD - y, BLACK_CLAMP_EXP) + y;
}

/**
 * Computes the APCA Lc (Lightness Contrast) between `text` and `background`
 * colours (each 0-255 sRGB, already composited to opaque). Follows the
 * documented "Plain English Steps": linearise and sum to Y, soft-clamp
 * near-black colours, apply the polarity-dependent power curve, subtract,
 * scale, and apply the low-contrast clip and offset. The sign follows text
 * polarity: positive for dark text on a light background, negative for
 * light text on a dark background.
 */
export function apcaLc(text: RgbColor, background: RgbColor): number {
  const yTextRaw = screenY(text);
  const yBgRaw = screenY(background);
  const yText = softClamp(yTextRaw);
  const yBg = softClamp(yBgRaw);

  let contrast: number;
  if (yBg > yText) {
    // Normal polarity: dark text on a light background.
    contrast = (Math.pow(yBg, NORM_BG_EXP) - Math.pow(yText, NORM_TXT_EXP)) * SCALE;
  } else {
    // Reverse polarity: light text on a dark background.
    contrast = (Math.pow(yBg, REV_BG_EXP) - Math.pow(yText, REV_TXT_EXP)) * SCALE;
  }

  if (Math.abs(contrast) < LOW_THRESHOLD) return 0;
  if (contrast >= 0) return (contrast - LOW_OFFSET) * 100;
  return (contrast + LOW_OFFSET) * 100;
}
