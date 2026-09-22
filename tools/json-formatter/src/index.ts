import meta from './meta.json';
import { parseJson, type ParseOptions, type ParseResult } from './parser';

export { meta, parseJson };
export type { ParseOptions, ParseResult, JsonError, DuplicateKey, PrecisionLoss, JsonStats, Position } from './parser';

export type IndentStyle = '2' | '3' | '4' | 'tab' | 'minify';
export type SortOrder = 'none' | 'asc' | 'desc';

export interface FormatOptions extends ParseOptions {
  indent?: IndentStyle;
  sortKeys?: SortOrder;
  /** Escape every character outside ASCII as \\uXXXX, for transport safety. */
  asciiOnly?: boolean;
  /** Emit each top-level array element on its own line, as JSON Lines. */
  jsonLines?: boolean;
}

export interface FormatResult extends ParseResult {
  output: string;
  /** Size of the formatted output in UTF-8 bytes. */
  outputBytes: number;
  inputBytes: number;
}

function indentString(style: IndentStyle): string | number {
  if (style === 'tab') return '\t';
  if (style === 'minify') return 0;
  return Number(style);
}

function sortValue(value: unknown, order: SortOrder): unknown {
  if (order === 'none') return value;
  if (Array.isArray(value)) return value.map((v) => sortValue(v, order));
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([a], [b]) => (order === 'asc' ? a.localeCompare(b) : b.localeCompare(a)));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortValue(v, order);
    return out;
  }
  return value;
}

/** Escapes everything above U+007F, leaving pure ASCII that survives any transport. */
export function escapeNonAscii(json: string): string {
  let out = '';
  for (const ch of json) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x7f) {
      out += ch;
    } else if (code <= 0xffff) {
      out += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      // Above the Basic Multilingual Plane, JSON uses a surrogate pair.
      const v = code - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      out += '\\u' + hi.toString(16).padStart(4, '0') + '\\u' + lo.toString(16).padStart(4, '0');
    }
  }
  return out;
}

export function format(source: string, options: FormatOptions = {}): FormatResult {
  const { indent = '2', sortKeys = 'none', asciiOnly = false, jsonLines = false } = options;
  const parsed = parseJson(source, options);
  const inputBytes = new TextEncoder().encode(source).length;

  if (!parsed.ok) {
    return { ...parsed, output: '', outputBytes: 0, inputBytes };
  }

  const value = sortValue(parsed.value, sortKeys);
  let output: string;

  if (jsonLines && Array.isArray(value)) {
    output = value.map((item) => JSON.stringify(item)).join('\n');
  } else {
    output = JSON.stringify(value, null, indentString(indent)) ?? '';
  }

  if (asciiOnly) output = escapeNonAscii(output);

  return {
    ...parsed,
    value,
    output,
    outputBytes: new TextEncoder().encode(output).length,
    inputBytes,
  };
}

export interface TreeNode {
  key: string;
  path: string;
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  /** Rendered preview of a leaf, or a size summary for a container. */
  preview: string;
  depth: number;
  childCount: number;
}

/** Flattens a parsed value into rows for a collapsible tree view. */
export function toTree(value: unknown, maxNodes = 5000): TreeNode[] {
  const nodes: TreeNode[] = [];

  const typeOf = (v: unknown): TreeNode['type'] => {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    switch (typeof v) {
      case 'object':
        return 'object';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      default:
        return 'string';
    }
  };

  const previewOf = (v: unknown): string => {
    const t = typeOf(v);
    if (t === 'array') return `[ ${(v as unknown[]).length} item${(v as unknown[]).length === 1 ? '' : 's'} ]`;
    if (t === 'object') {
      const n = Object.keys(v as object).length;
      return `{ ${n} key${n === 1 ? '' : 's'} }`;
    }
    if (t === 'string') {
      const s = v as string;
      return JSON.stringify(s.length > 80 ? s.slice(0, 80) + '…' : s);
    }
    return String(v);
  };

  const walk = (key: string, v: unknown, path: string, depth: number): void => {
    if (nodes.length >= maxNodes) return;
    const t = typeOf(v);
    const childCount = t === 'array' ? (v as unknown[]).length : t === 'object' ? Object.keys(v as object).length : 0;
    nodes.push({ key, path, type: t, preview: previewOf(v), depth, childCount });
    if (t === 'array') {
      (v as unknown[]).forEach((item, i) => walk(String(i), item, `${path}[${i}]`, depth + 1));
    } else if (t === 'object') {
      for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
        walk(k, item, path === '$' ? `$.${k}` : `${path}.${k}`, depth + 1);
      }
    }
  };

  walk('$', value, '$', 0);
  return nodes;
}

/** Repairs the mistakes people actually make, one at a time, so each is visible. */
export interface RepairSuggestion {
  description: string;
  repaired: string;
}

export function suggestRepairs(source: string): RepairSuggestion[] {
  // Nothing to repair if it already parses.
  if (parseJson(source).ok) return [];

  const suggestions: RepairSuggestion[] = [];
  const tryIt = (description: string, repaired: string) => {
    if (repaired !== source && parseJson(repaired).ok) suggestions.push({ description, repaired });
  };

  if (parseJson(source, { allowComments: true, allowTrailingCommas: true }).ok) {
    suggestions.push({
      description: 'This parses as JSONC. Turn on comments and trailing commas.',
      repaired: source,
    });
    return suggestions;
  }

  tryIt('Replace single quotes with double quotes', source.replace(/'/g, '"'));
  tryIt('Quote unquoted object keys', source.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3'));
  tryIt('Remove trailing commas', source.replace(/,(\s*[}\]])/g, '$1'));
  tryIt('Wrap the whole thing in an array, since it looks like several values', `[${source.replace(/}\s*{/g, '},{')}]`);
  return suggestions;
}
