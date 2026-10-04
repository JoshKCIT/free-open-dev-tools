import meta from './meta.json';
import { CubicBezierError, type ControlPoint } from './bezier';

export { meta, CubicBezierError };

export const EASING_PRESETS: ReadonlyMap<string, string> = new Map();

export function generateEasing(options: { preset?: string; p1?: ControlPoint; p2?: ControlPoint; duration?: number }): {
  value: string;
  declaration: string;
  css: string;
  tree: { className: string; children?: { className: string }[] };
  svg: string;
  table: string[][];
  points: { x1: number; y1: number; x2: number; y2: number };
  warnings: string[];
} {
  void options;
  throw new Error('not implemented');
}
