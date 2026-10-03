/** Placeholder until the writer exists: the tests describe what it must do. */
export interface ControlRule {
  selector: string;
  declarations: [string, string][];
}

export interface ControlSheet {
  rules: ControlRule[];
  reducedMotion?: ControlRule[];
}

export const ALLOWED_SELECTORS: readonly string[] = [];

export function controlCss(sheet: ControlSheet): string {
  void sheet;
  throw new Error('not implemented');
}

export function findUnsafeControlCss(text: string): string | null {
  void text;
  return null;
}
