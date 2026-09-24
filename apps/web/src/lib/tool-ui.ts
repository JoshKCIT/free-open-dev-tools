/**
 * The contract every tool page on this site implements.
 *
 * Processing logic never lives here. It lives in the matching package under
 * `tools/<id>`, which knows nothing about React and can be lifted out on its
 * own. This file only describes how a tool asks for input and hands back
 * results for rendering.
 */

export type Values = Record<string, unknown>;

export type FieldType = 'textarea' | 'text' | 'number' | 'select' | 'checkbox' | 'radio' | 'file' | 'color' | 'range';

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  /** Starting value. Also what Reset returns to. */
  default?: unknown;
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** One short sentence under the control. */
  help?: string;
  rows?: number;
  accept?: string;
  multiple?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Render in a monospaced face. Defaults to true for textareas. */
  mono?: boolean;
  /** Hide this control unless the current values make it relevant. */
  visible?: (values: Values) => boolean;
  /** Lay the control out on its own full-width row. */
  wide?: boolean;
}

export type Tone = 'info' | 'warn' | 'error' | 'success';

export interface OutputTable {
  headers: string[];
  rows: (string | number)[][];
  /** Column indexes to render in a monospaced face. */
  mono?: number[];
}

export interface DownloadableFile {
  name: string;
  mime: string;
  /** Text content, or bytes for binary results. */
  content: string | Uint8Array;
}

export type OutputBlock =
  | { kind: 'code'; label?: string; language?: string; value: string; download?: string }
  | { kind: 'text'; label?: string; value: string; download?: string }
  | { kind: 'keyvalue'; label?: string; pairs: [string, string][] }
  | { kind: 'table'; label?: string; table: OutputTable }
  | { kind: 'list'; label?: string; items: string[]; ordered?: boolean }
  | { kind: 'swatches'; label?: string; colors: { css: string; label: string; caption?: string }[] }
  /** HTML that the tool package has already sanitised. Rendered in a sandboxed frame. */
  | { kind: 'sandboxed-html'; label?: string; html: string }
  | { kind: 'image'; label?: string; src: string; alt: string; width?: number; height?: number; download?: string }
  | { kind: 'files'; label?: string; files: DownloadableFile[] }
  | { kind: 'note'; label?: string; tone: Tone; value: string }
  | { kind: 'diff'; label?: string; lines: { type: 'add' | 'del' | 'ctx' | 'meta'; text: string }[] };

export interface ToolIssue {
  message: string;
  line?: number;
  column?: number;
  path?: string;
}

export interface ToolResult {
  outputs: OutputBlock[];
  /** Problems with the input. Shown prominently; outputs may still render. */
  errors?: ToolIssue[];
  /** Things worth knowing that are not failures. */
  warnings?: string[];
  /** Small facts shown above the output, such as byte counts or timings. */
  stats?: [string, string][];
  /**
   * Where the `stats` block renders relative to `outputs`. Absent means
   * `'before-outputs'`, which is today's order (every stats entry before
   * every output block) -- so no page already live changes.
   *
   * This is a closed three-valued union rather than a two-state boolean on
   * purpose. The password-strength readout has a design-contract-fixed
   * order of verdict note, then stats, then a "Why" list, then a crack-time
   * table: the stats belong between the FIRST output block and the rest, a
   * position no boolean can express ("before all" or "after all" both give
   * the wrong order). `'after-first-output'` says exactly that.
   */
  statsPosition?: 'before-outputs' | 'after-first-output' | 'after-outputs';
}

export interface RunContext {
  /** Aborts when the user edits input again or leaves the page. */
  signal: AbortSignal;
  /**
   * Reports fractional progress (0-1) for long-running work, with an
   * optional detail string describing what stage it is at. Optional; most
   * tools never call it, and a tool that never calls it behaves exactly as
   * it does today -- no progress bar, no Cancel button, nothing rendered.
   */
  onProgress?(fraction: number, detail?: string): void;
}

export interface ToolDocs {
  /** Two or three sentences on what the tool does and when to reach for it. */
  about: string;
  /** Exactly what is accepted. Be specific about versions and dialects. */
  supports: string[];
  /** What it will not do, and where it is lossy. Never leave this empty. */
  limits: string[];
  /** The specifications the behaviour is defined by, and tested against. */
  standards?: { label: string; url: string }[];
}

export interface ToolExample {
  label: string;
  values: Values;
}

export interface ToolPage {
  /** Must match a tool id in docs/catalog.json. */
  id: string;
  docs: ToolDocs;
  fields: Field[];
  examples?: ToolExample[];
  /**
   * Runs the tool. Must be pure with respect to the network: a local tool may
   * not perform fetch, XHR, WebSocket, sendBeacon or any other transmission.
   * The privacy test in `e2e/privacy.spec.ts` enforces this at runtime.
   */
  run(values: Values, ctx: RunContext): ToolResult | Promise<ToolResult>;
  /** Re-run as the user types. Off for tools with an expensive or file-based run. */
  autoRun?: boolean;
  /**
   * Declares that this tool's work can be abandoned part way through, and
   * that the visitor should be offered a control that does so. Absent
   * means false everywhere it is checked: no Cancel button ever renders,
   * and editing the form or pressing Reset never aborts an in-flight run.
   */
  cancellable?: boolean;
  /** Every tool in this release is 'local'. The value is displayed on the page. */
  processing?: 'local';
}

export function defineTool(page: ToolPage): ToolPage {
  return { autoRun: true, processing: 'local', ...page };
}

/** Reads a field, falling back to its declared default. */
export function val<T>(values: Values, field: string, fallback: T): T {
  const v = values[field];
  return v === undefined || v === null || v === '' ? fallback : (v as T);
}

export function bool(values: Values, field: string, fallback = false): boolean {
  const v = values[field];
  return typeof v === 'boolean' ? v : fallback;
}

export function num(values: Values, field: string, fallback: number): number {
  const v = values[field];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function str(values: Values, field: string, fallback = ''): string {
  const v = values[field];
  return typeof v === 'string' ? v : fallback;
}

export function files(values: Values, field: string): File[] {
  const v = values[field];
  return Array.isArray(v) ? (v as File[]) : [];
}

/**
 * A short human-readable size string: bytes below the kilobyte threshold
 * (no decimal place), then kilobytes, megabytes or gigabytes on powers of
 * 1024, one decimal place each. Pure, so three tool pages this phase that
 * report file sizes in `stats` stay consistent with each other.
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n))} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Convenience for the common "one block of text out" case. */
export function textResult(value: string, language?: string, label?: string): ToolResult {
  return { outputs: [{ kind: 'code', value, language, label }] };
}

export function errorResult(message: string, issue?: Omit<ToolIssue, 'message'>): ToolResult {
  return { outputs: [], errors: [{ message, ...issue }] };
}
