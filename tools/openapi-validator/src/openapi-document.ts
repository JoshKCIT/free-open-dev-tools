/**
 * Reads an OpenAPI or Swagger document from JSON or YAML 1.2.2 text, detects
 * its declared version, and locates the line and column of any RFC 6901
 * pointer inside the original text. Never a tool: this file knows nothing
 * about validation rules, only about turning text into a value with a
 * position lookup.
 */
import { parseDocument, LineCounter } from 'yaml';
import { parseJsonText } from './json-text';
import { hasOwn, getOwn } from './own-property';
import { parsePointer } from './pointer';

export type OpenApiVersion = 'swagger-2.0' | 'openapi-3.0' | 'openapi-3.1' | 'openapi-3.2';

export interface OpenApiDocumentResult {
  value: unknown;
  format: 'json' | 'yaml';
  version: OpenApiVersion;
  /** The raw version string declared in the document (e.g. "3.0.4"). */
  declared: string;
  /** Returns the 1-based line and column of the value at `pointer`, or undefined when it cannot be located. */
  locate(pointer: string): { line: number; column: number } | undefined;
}

export class OpenApiDocumentError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'OpenApiDocumentError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

const ALIAS_BOMB_MESSAGE =
  'This document uses YAML aliases that expand into too much data, so it was refused rather than risk freezing the tab.';

/** RFC 6901: '' is the whole document. */
function looksLikeJson(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    return ch === '{';
  }
  return false;
}

function detectVersion(value: unknown): { version: OpenApiVersion; declared: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenApiDocumentError(
      'This document has no "swagger" or "openapi" field naming its version, so it was refused. Supported versions are Swagger 2.0 and OpenAPI 3.0, 3.1 and 3.2.',
    );
  }
  const obj = value as Record<string, unknown>;
  const swagger = hasOwn(obj, 'swagger') ? getOwn(obj, 'swagger') : undefined;
  const openapi = hasOwn(obj, 'openapi') ? getOwn(obj, 'openapi') : undefined;

  if (typeof swagger === 'string' && swagger === '2.0') {
    return { version: 'swagger-2.0', declared: swagger };
  }
  if (typeof openapi === 'string') {
    if (openapi.startsWith('3.0.')) return { version: 'openapi-3.0', declared: openapi };
    if (openapi.startsWith('3.1.')) return { version: 'openapi-3.1', declared: openapi };
    if (openapi.startsWith('3.2')) return { version: 'openapi-3.2', declared: openapi };
    throw new OpenApiDocumentError(
      `This document declares "openapi": "${openapi}", which is not a version this tool supports. Supported versions are Swagger 2.0 and OpenAPI 3.0, 3.1 and 3.2.`,
    );
  }
  if (typeof swagger === 'string') {
    throw new OpenApiDocumentError(
      `This document declares "swagger": "${swagger}", which is not a version this tool supports. Only Swagger 2.0 is supported.`,
    );
  }
  throw new OpenApiDocumentError(
    'This document has no "swagger" or "openapi" field naming its version, so it was refused. Supported versions are Swagger 2.0 and OpenAPI 3.0, 3.1 and 3.2.',
  );
}

/**
 * Walks a parsed value to the node at `tokens` (already-decoded RFC 6901
 * reference tokens), returning `{ found, value }`. Used only to confirm a
 * pointer resolves before reporting it; never throws on a missing path.
 */
function resolvePointerValue(root: unknown, tokens: string[]): { found: boolean; value: unknown } {
  let current: unknown = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return { found: false, value: undefined };
      const index = Number(token);
      if (index >= current.length) return { found: false, value: undefined };
      current = current[index];
      continue;
    }
    if (current !== null && typeof current === 'object') {
      if (!hasOwn(current, token)) return { found: false, value: undefined };
      current = getOwn(current as Record<string, unknown>, token);
      continue;
    }
    return { found: false, value: undefined };
  }
  return { found: true, value: current };
}

export { resolvePointerValue };

/**
 * Reads OpenAPI or Swagger document text. `format: 'auto'` (default) treats
 * text whose first non-space character is `{` as JSON; anything else is
 * read as YAML (JSON is valid YAML 1.2.2, so `format: 'yaml'` always works
 * too). YAML is parsed with `uniqueKeys: true` and a `maxAliasCount` limit
 * against alias-bomb documents (D-83, the phase 4 `data-convert`
 * alias-bomb-message convention).
 */
export function readOpenApiDocument(
  text: string,
  options: { format?: 'auto' | 'json' | 'yaml' } = {},
): OpenApiDocumentResult {
  const requestedFormat = options.format ?? 'auto';
  const format: 'json' | 'yaml' =
    requestedFormat === 'auto' ? (looksLikeJson(text) ? 'json' : 'yaml') : requestedFormat;

  let value: unknown;
  let lineCounter: LineCounter | undefined;

  if (format === 'json') {
    const parsed = parseJsonText(text);
    if (!parsed.ok) {
      throw new OpenApiDocumentError(parsed.message ?? 'The document could not be parsed.', {
        line: parsed.line,
        column: parsed.column,
      });
    }
    value = parsed.value;
  } else {
    lineCounter = new LineCounter();
    const doc = parseDocument(text, {
      uniqueKeys: true,
      logLevel: 'error',
      prettyErrors: false,
      lineCounter,
    });
    if (doc.errors.length > 0) {
      const err = doc.errors[0]!;
      const pos = lineCounter.linePos(err.pos[0]);
      throw new OpenApiDocumentError(err.message, { line: pos.line, column: pos.col });
    }
    try {
      value = doc.toJS({ maxAliasCount: 100 });
    } catch (err) {
      if (err instanceof ReferenceError) throw new OpenApiDocumentError(ALIAS_BOMB_MESSAGE);
      throw err;
    }
  }

  const { version, declared } = detectVersion(value);

  return {
    value,
    format,
    version,
    declared,
    locate(pointer: string) {
      const tokens = (() => {
        try {
          return parsePointer(pointer);
        } catch {
          return undefined;
        }
      })();
      if (tokens === undefined) return undefined;

      if (format === 'json') {
        return locateInJsonText(text, tokens);
      }
      // Re-parse as YAML (JSON is valid YAML) purely to get a CST-backed line
      // counter for locate(); the value itself was already produced above.
      const counter = new LineCounter();
      const doc = parseDocument(text, {
        uniqueKeys: true,
        logLevel: 'error',
        prettyErrors: false,
        lineCounter: counter,
      });
      let node: unknown = doc.contents;
      for (const token of tokens) {
        if (node === null || node === undefined) return undefined;
        const got = (node as { get?: (key: unknown, keepScalar: boolean) => unknown }).get?.(token, true);
        if (got === undefined) return undefined;
        node = got;
      }
      const range = (node as { range?: [number, number, number] } | null)?.range;
      if (!range) return undefined;
      const pos = counter.linePos(range[0]);
      return { line: pos.line, column: pos.col };
    },
  };
}

/**
 * Locates a pointer's value inside JSON text by re-scanning with the
 * built-in JSON grammar (single linear pass, no backtracking), tracking
 * line and column as it goes. Used only for JSON input; YAML input uses
 * `yaml`'s own LineCounter and CST instead.
 */
function locateInJsonText(text: string, tokens: string[]): { line: number; column: number } | undefined {
  const posAt = (i: number): { line: number; column: number } => {
    // Recomputed from the start on each call: this runs only for error
    // reporting (never a hot path), and scanning forward once is simpler
    // than threading a resumable counter through the recursive descent below.
    let l = 1;
    let ls = 0;
    for (let j = 0; j < i; j++) {
      if (text[j] === '\n') {
        l++;
        ls = j + 1;
      }
    }
    return { line: l, column: i - ls + 1 };
  };

  const skipWs = (i: number): number => {
    while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++;
    return i;
  };

  const skipString = (i: number): number => {
    i++; // opening quote
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') i++;
      i++;
    }
    return i + 1;
  };

  /** Returns the index just past the value starting at `i`. */
  const skipValue = (i: number): number => {
    i = skipWs(i);
    const ch = text[i];
    if (ch === '"') return skipString(i);
    if (ch === '{') return skipObject(i);
    if (ch === '[') return skipArray(i);
    // number, true, false, null
    let j = i;
    while (j < text.length && !',}] \t\n\r'.includes(text[j]!)) j++;
    return j;
  };

  const skipObject = (i: number): number => {
    i++; // {
    i = skipWs(i);
    if (text[i] === '}') return i + 1;
    for (;;) {
      i = skipWs(i);
      i = skipString(i);
      i = skipWs(i);
      i++; // :
      i = skipValue(i);
      i = skipWs(i);
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') return i + 1;
      return i;
    }
  };

  const skipArray = (i: number): number => {
    i++; // [
    i = skipWs(i);
    if (text[i] === ']') return i + 1;
    for (;;) {
      i = skipValue(i);
      i = skipWs(i);
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') return i + 1;
      return i;
    }
  };

  /** Returns the start index of the value found by following `tokens` from `i`, or undefined. */
  function find(i: number, remaining: string[]): number | undefined {
    i = skipWs(i);
    if (remaining.length === 0) return i;
    const [head, ...rest] = remaining;
    if (text[i] === '{') {
      let j = i + 1;
      j = skipWs(j);
      if (text[j] === '}') return undefined;
      for (;;) {
        j = skipWs(j);
        const keyStart = j + 1;
        const keyEnd = (() => {
          let k = keyStart;
          while (text[k] !== '"') {
            if (text[k] === '\\') k++;
            k++;
          }
          return k;
        })();
        const key = JSON.parse(text.slice(j, keyEnd + 1)) as string;
        j = keyEnd + 1;
        j = skipWs(j);
        j++; // :
        if (key === head) {
          return find(j, rest);
        }
        j = skipValue(j);
        j = skipWs(j);
        if (text[j] === ',') {
          j++;
          continue;
        }
        return undefined;
      }
    }
    if (text[i] === '[') {
      if (!/^(0|[1-9][0-9]*)$/.test(head!)) return undefined;
      const wantIndex = Number(head);
      let j = i + 1;
      j = skipWs(j);
      if (text[j] === ']') return undefined;
      let idx = 0;
      for (;;) {
        if (idx === wantIndex) return find(j, rest);
        j = skipValue(j);
        j = skipWs(j);
        if (text[j] === ',') {
          j++;
          idx++;
          continue;
        }
        return undefined;
      }
    }
    return undefined;
  }

  const start = find(0, tokens);
  if (start === undefined) return undefined;
  return posAt(start);
}
