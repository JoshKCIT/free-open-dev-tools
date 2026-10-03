import meta from './meta.json';

export { meta };

export class FormControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormControlError';
  }
}

export const CONTROLS: ReadonlyMap<string, string> = new Map();
export const PRESETS: ReadonlyMap<string, string> = new Map();

export interface StyleControlsOptions {
  control?: string;
  preset?: string;
  accent?: string;
  background?: string;
  text?: string;
  size?: number;
  radius?: number;
  showDisabled?: boolean;
}

export function contrastRatio(a: string, b: string): number {
  void a;
  void b;
  return 0;
}

export function usesRadius(control: string, preset: string): boolean {
  void control;
  void preset;
  return false;
}

export function colourOrDefault(
  value: string,
  fallback: string,
  label: string,
): { colour: string; warning: string | null } {
  void fallback;
  void label;
  return { colour: value, warning: null };
}

export function styleControls(options: StyleControlsOptions): {
  css: string;
  markup: string;
  html: string;
  warnings: string[];
} {
  void options;
  throw new Error('not implemented');
}
