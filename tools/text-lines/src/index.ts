import meta from './meta.json';

export { meta };

export class TextLinesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextLinesError';
  }
}

export const OPERATIONS = ['sort', 'dedupe', 'shuffle', 'number', 'trim', 'filter', 'join', 'split'] as const;
export type LineOperation = (typeof OPERATIONS)[number];

export interface LineOptions {
  /** 'sort' only. Default 'codepoint'. */
  order?: 'codepoint' | 'natural';
  /** 'sort' only. Default false. */
  descending?: boolean;
  /** 'dedupe' and 'filter'. Default false. */
  ignoreCase?: boolean;
  /** 'shuffle' only. Default '1'. */
  seed?: string;
  /** 'number' only. Any safe integer. Default 1. */
  start?: number;
  /** 'number' only. Default '. '. */
  separator?: string;
  /** 'trim' only. Default 'both'. */
  mode?: 'both' | 'leading' | 'trailing';
  /** 'trim' only. Default false. */
  dropBlank?: boolean;
  /** 'filter' only. A literal substring. Default ''. */
  filterText?: string;
  /** 'filter' only. Default 'keep'. */
  filterMode?: 'keep' | 'remove';
  /** 'join' only. Default ', '. */
  joinWith?: string;
  /** 'split' only. Default ','. May not be empty. */
  splitOn?: string;
}

export interface LinesResult {
  output: string;
  linesIn: number;
  linesOut: number;
}

/** Splits on CRLF, LF or CR, so any of the three common line endings are read as line breaks. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split(/\r\n|\r|\n/);
}

/**
 * Compares two strings the way most natural-sort implementations do: a
 * maximal run of decimal digits is treated as one number and compared
 * numerically, everything else is compared by code point. Written by hand,
 * rather than delegated to `Intl.Collator`'s numeric option, so the result
 * is identical in every browser instead of following the host's collation
 * rules.
 */
function naturalCompare(a: string, b: string): number {
  const chunk = /(\d+)|(\D+)/g;
  const aParts = a.match(chunk) ?? [];
  const bParts = b.match(chunk) ?? [];
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ap = aParts[i] ?? '';
    const bp = bParts[i] ?? '';
    const aIsDigits = /^\d/.test(ap);
    const bIsDigits = /^\d/.test(bp);
    if (aIsDigits && bIsDigits) {
      const an = Number(ap);
      const bn = Number(bp);
      if (an !== bn) return an < bn ? -1 : 1;
      if (ap.length !== bp.length) return ap.length - bp.length;
    } else if (ap !== bp) {
      return ap < bp ? -1 : 1;
    }
  }
  return 0;
}

/** A small hand-written 32-bit hash, folding a string seed into one integer. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small, fast, deterministic 32-bit generator. Same seed, same sequence, every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded Fisher-Yates shuffle: deterministic for a given seed, and a true permutation of the input. */
function shuffleWithSeed(lines: string[], seed: string): string[] {
  const rng = mulberry32(hashSeed(seed));
  const result = [...lines];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

export function processLines(input: string, operation: LineOperation, options: LineOptions = {}): LinesResult {
  const lines = splitLines(input);
  const linesIn = lines.length;
  let result: string[];

  switch (operation) {
    case 'sort': {
      const order = options.order ?? 'codepoint';
      const cmp = order === 'natural' ? naturalCompare : (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      result = [...lines].sort(cmp);
      if (options.descending) result.reverse();
      break;
    }
    case 'dedupe': {
      const seen = new Set<string>();
      result = [];
      for (const line of lines) {
        const key = options.ignoreCase ? line.toLowerCase() : line;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(line);
      }
      break;
    }
    case 'shuffle': {
      result = shuffleWithSeed(lines, options.seed ?? '1');
      break;
    }
    case 'number': {
      const start = Number.isFinite(options.start) ? options.start! : 1;
      const separator = options.separator ?? '. ';
      result = lines.map((line, i) => `${start + i}${separator}${line}`);
      break;
    }
    case 'trim': {
      const mode = options.mode ?? 'both';
      result = lines.map((line) => {
        if (mode === 'leading') return line.replace(/^\s+/, '');
        if (mode === 'trailing') return line.replace(/\s+$/, '');
        return line.trim();
      });
      if (options.dropBlank) result = result.filter((line) => line !== '');
      break;
    }
    case 'filter': {
      const text = options.filterText ?? '';
      const keep = options.filterMode !== 'remove';
      if (text === '') {
        result = keep ? [...lines] : [];
      } else if (options.ignoreCase) {
        const needle = text.toLowerCase();
        result = lines.filter((line) => line.toLowerCase().includes(needle) === keep);
      } else {
        result = lines.filter((line) => line.includes(text) === keep);
      }
      break;
    }
    case 'join': {
      const separator = options.joinWith ?? ', ';
      return { output: lines.join(separator), linesIn, linesOut: linesIn };
    }
    case 'split': {
      const on = options.splitOn ?? ',';
      if (on === '') throw new TextLinesError('The separator to split on cannot be empty.');
      result = input.split(on);
      break;
    }
    default: {
      const exhaustive: never = operation;
      throw new TextLinesError(`Unknown operation "${String(exhaustive)}".`);
    }
  }

  return { output: result.join('\n'), linesIn, linesOut: result.length };
}
