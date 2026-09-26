import meta from './meta.json';

export { meta };

export class GradientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradientError';
  }
}

export type GradientType = 'linear' | 'radial' | 'conic';
export type RadialShape = 'circle' | 'ellipse';
export type RadialSize = 'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner';

export interface GradientStop {
  color: string;
  at: number;
}

export interface GenerateGradientOptions {
  type?: GradientType;
  repeating?: boolean;
  angle?: number;
  shape?: RadialShape;
  size?: RadialSize;
  position?: { x: number; y: number };
  stops: GradientStop[];
  width?: number;
  height?: number;
}

export interface GenerateGradientResult {
  css: string;
  tree: { className: string };
  value: string;
  warnings: string[];
}

// RED stub (TDD): thrown intentionally so every required test below fails on
// a real assertion, never a compile error or a vacuous pass.
export function generateGradient(_options: GenerateGradientOptions): GenerateGradientResult {
  throw new Error('not implemented');
}
