/** Placeholder until the solver exists: the tests describe what it must do. */
export class CubicBezierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CubicBezierError';
  }
}

export type CurvePoints = readonly [number, number, number, number];

export const KEYWORD_CURVES: ReadonlyMap<string, CurvePoints> = new Map();
export const NAMED_CURVES: ReadonlyMap<string, { label: string; points: CurvePoints }> = new Map();

export interface ControlPoint {
  x: number;
  y: number;
  clamped?: boolean;
}

export function pointFieldToControl(p: { x: number; y: number }): { x: number; y: number; clamped: boolean } {
  void p;
  return { x: 0, y: 0, clamped: false };
}

export function controlToPointField(c: { x: number; y: number }): { x: number; y: number } {
  void c;
  return { x: 0, y: 0 };
}

export function solveProgress(x1: number, y1: number, x2: number, y2: number, input: number): number {
  void [x1, y1, x2, y2, input];
  return 0;
}

export function sampleCurve(x1: number, y1: number, x2: number, y2: number): string[][] {
  void [x1, y1, x2, y2];
  return [];
}

export function curveSvg(x1: number, y1: number, x2: number, y2: number): string {
  void [x1, y1, x2, y2];
  return '';
}
