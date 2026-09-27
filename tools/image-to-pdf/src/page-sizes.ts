/**
 * ISO 216:2007 defines the A series in millimetres (A4: 210 by 297mm, A3:
 * 297 by 420mm, A5: 148 by 210mm); this project's own ANSI/US customary
 * sizes (Letter 8.5 by 11 inches, Legal 8.5 by 14 inches) come from the
 * same fetched public source this project already cites for other tools.
 * A PDF's default user space unit is 1/72 inch (ISO 32000-1:2008 8.3.2.3),
 * so every size here is converted to points (1 point = 1/72 inch) once,
 * at module load, and rounded to two decimal places -- the precision a
 * PDF page's own MediaBox is written and displayed at throughout this
 * package.
 */

export type PageSizeName = 'a3' | 'a4' | 'a5' | 'letter' | 'legal';

export interface PageDimensions {
  /** Portrait width and height in points (1/72 inch), rounded to two decimal places. */
  width: number;
  height: number;
}

/** Millimetres to points: 1 inch = 25.4mm = 72 points. */
export function mmToPoints(mm: number): number {
  return Math.round(((mm * 72) / 25.4) * 100) / 100;
}

/** Inches to points. */
function inToPoints(inches: number): number {
  return Math.round(inches * 72 * 100) / 100;
}

export const PAGE_SIZES: Record<PageSizeName, PageDimensions> = {
  a3: { width: mmToPoints(297), height: mmToPoints(420) },
  a4: { width: mmToPoints(210), height: mmToPoints(297) },
  a5: { width: mmToPoints(148), height: mmToPoints(210) },
  letter: { width: inToPoints(8.5), height: inToPoints(11) },
  legal: { width: inToPoints(8.5), height: inToPoints(14) },
};
