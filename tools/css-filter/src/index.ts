import meta from './meta.json';

export { meta };

export class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterError';
  }
}

export type ScalarFilterName =
  'blur' | 'brightness' | 'contrast' | 'grayscale' | 'hue-rotate' | 'invert' | 'opacity' | 'saturate' | 'sepia';

export type FilterFunctionName = ScalarFilterName | 'drop-shadow';

export interface FilterFunctionInfo {
  name: FilterFunctionName;
  unit: string | null;
  min: number;
  max: number;
  specDefault: number;
  capIsSpecMandated: boolean;
  note: string;
}

// RED stub (TDD): the real ten-entry table lands with the implementation.
export const FILTER_FUNCTIONS: readonly FilterFunctionInfo[] = [];

export interface ScalarFilterLayer {
  name: ScalarFilterName;
  amount: number;
}

export interface DropShadowFilterLayer {
  name: 'drop-shadow';
  x: number;
  y: number;
  blur: number;
  color: string;
}

export type FilterLayer = ScalarFilterLayer | DropShadowFilterLayer;

export interface GenerateFilterOptions {
  functions: FilterLayer[];
  width?: number;
  height?: number;
}

export interface GenerateFilterResult {
  css: string;
  tree: { className: string; children?: { className: string; text?: string }[] };
  value: string;
  warnings: string[];
}

// RED stub (TDD): thrown intentionally so every required test below fails on
// a real assertion, never a compile error or a vacuous pass.
export function generateFilter(_options: GenerateFilterOptions): GenerateFilterResult {
  throw new Error('not implemented');
}
