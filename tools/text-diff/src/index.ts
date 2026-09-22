import meta from './meta.json';

export { meta };

export type Op = 'equal' | 'insert' | 'delete';

export interface Change<T = string> {
  op: Op;
  values: T[];
}

/**
 * Longest common subsequence diff, via the Myers algorithm.
 *
 * Myers is what git, diff and every editor use. It is O(ND) in the size of the
 * difference rather than the size of the input, so two mostly-identical files
 * diff in roughly linear time.
 */
export function diffSequences<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean = Object.is): Change<T>[] {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ op: 'insert', values: [...b] }];
  if (m === 0) return [{ op: 'delete', values: [...a] }];

  const max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];

  let d = 0;
  outer: for (; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      const down = k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0));
      x = down ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      // Follow the diagonal as far as the sequences agree.
      while (x < n && y < m && equals(a[x]!, b[y]!)) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= n && y >= m) break outer;
    }
  }

  // Walk the trace backwards to recover the edit script.
  const script: { op: Op; value: T }[] = [];
  let x = n;
  let y = m;
  for (let step = Math.min(d, trace.length - 1); step >= 0 && (x > 0 || y > 0); step--) {
    const prev = trace[step]!;
    const k = x - y;
    const down = k === -step || (k !== step && (prev.get(k - 1) ?? -1) < (prev.get(k + 1) ?? -1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev.get(prevK) ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      script.push({ op: 'equal', value: a[x - 1]! });
      x--;
      y--;
    }
    if (step > 0) {
      if (down) {
        script.push({ op: 'insert', value: b[y - 1]! });
        y--;
      } else {
        script.push({ op: 'delete', value: a[x - 1]! });
        x--;
      }
    }
  }
  script.reverse();

  // Collapse runs of the same operation.
  const changes: Change<T>[] = [];
  for (const item of script) {
    const last = changes[changes.length - 1];
    if (last && last.op === item.op) last.values.push(item.value);
    else changes.push({ op: item.op, values: [item.value] });
  }
  return changes;
}

export type Granularity = 'line' | 'word' | 'character';

export interface DiffOptions {
  granularity?: Granularity;
  ignoreCase?: boolean;
  /** Treat runs of whitespace as equal, and ignore leading and trailing space. */
  ignoreWhitespace?: boolean;
  /** Compare lines after sorting them, for unordered lists. */
  sortLines?: boolean;
  /** Normalise CRLF and CR to LF before comparing. */
  normaliseLineEndings?: boolean;
}

function split(text: string, granularity: Granularity): string[] {
  if (granularity === 'line') return text.split('\n');
  if (granularity === 'character') return Array.from(text);
  // Keep the separators so the text can be rebuilt exactly.
  return text.split(/(\s+)/).filter((s) => s !== '');
}

function normalise(value: string, options: DiffOptions): string {
  let out = value;
  if (options.ignoreCase) out = out.toLowerCase();
  if (options.ignoreWhitespace) out = out.replace(/\s+/g, ' ').trim();
  return out;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
  /** Proportion of the larger side that is unchanged, 0 to 1. */
  similarity: number;
}

export interface DiffResult {
  changes: Change<string>[];
  stats: DiffStats;
  granularity: Granularity;
  identical: boolean;
  /** Set when the inputs differ only in line endings or trailing whitespace. */
  invisibleDifferenceOnly: boolean;
}

export function diffText(a: string, b: string, options: DiffOptions = {}): DiffResult {
  const { granularity = 'line', normaliseLineEndings = true, sortLines = false } = options;

  let left = normaliseLineEndings ? a.replace(/\r\n?/g, '\n') : a;
  let right = normaliseLineEndings ? b.replace(/\r\n?/g, '\n') : b;

  if (sortLines && granularity === 'line') {
    left = left.split('\n').sort().join('\n');
    right = right.split('\n').sort().join('\n');
  }

  const leftParts = split(left, granularity);
  const rightParts = split(right, granularity);

  const changes = diffSequences(leftParts, rightParts, (x, y) => normalise(x, options) === normalise(y, options));

  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const change of changes) {
    if (change.op === 'insert') added += change.values.length;
    else if (change.op === 'delete') removed += change.values.length;
    else unchanged += change.values.length;
  }

  const larger = Math.max(leftParts.length, rightParts.length);
  const identical = added === 0 && removed === 0;

  return {
    changes,
    granularity,
    identical,
    // The classic frustration: two files that look identical but are not.
    invisibleDifferenceOnly: a !== b && identical,
    stats: {
      added,
      removed,
      unchanged,
      similarity: larger === 0 ? 1 : unchanged / larger,
    },
  };
}

export interface UnifiedOptions extends DiffOptions {
  /** Lines of unchanged context around each change. */
  context?: number;
  fromFile?: string;
  toFile?: string;
}

/** Produces a unified diff, the format `git diff` and `patch` both use. */
export function unifiedDiff(a: string, b: string, options: UnifiedOptions = {}): string {
  const { context = 3, fromFile = 'a', toFile = 'b' } = options;
  const result = diffText(a, b, { ...options, granularity: 'line' });
  if (result.identical) return '';

  // Expand the change list into one entry per line so hunks can be sliced.
  const lines: { op: Op; text: string }[] = [];
  for (const change of result.changes) {
    for (const value of change.values) lines.push({ op: change.op, text: value });
  }

  const hunks: { aStart: number; aCount: number; bStart: number; bCount: number; body: string[] }[] = [];
  let i = 0;
  let aLine = 1;
  let bLine = 1;

  while (i < lines.length) {
    if (lines[i]!.op === 'equal') {
      aLine++;
      bLine++;
      i++;
      continue;
    }

    // Found a change. Walk back for leading context.
    const changeStart = i;
    const start = Math.max(0, changeStart - context);
    let aStart = aLine;
    let bStart = bLine;
    for (let j = changeStart - 1; j >= start; j--) {
      aStart--;
      bStart--;
    }

    // Walk forward, absorbing changes separated by less than twice the context.
    let end = i;
    let gap = 0;
    while (end < lines.length) {
      const line = lines[end]!;
      if (line.op === 'equal') {
        gap++;
        if (gap > context * 2) break;
      } else {
        gap = 0;
      }
      end++;
    }
    const trailing = Math.min(gap, context);
    end -= gap - trailing;

    const body: string[] = [];
    let aCount = 0;
    let bCount = 0;
    for (let j = start; j < end; j++) {
      const line = lines[j]!;
      if (line.op === 'equal') {
        body.push(' ' + line.text);
        aCount++;
        bCount++;
      } else if (line.op === 'delete') {
        body.push('-' + line.text);
        aCount++;
      } else {
        body.push('+' + line.text);
        bCount++;
      }
    }

    hunks.push({ aStart, aCount, bStart, bCount, body });

    // Advance the line counters past everything consumed.
    for (let j = i; j < end; j++) {
      const line = lines[j]!;
      if (line.op !== 'insert') aLine++;
      if (line.op !== 'delete') bLine++;
    }
    i = end;
  }

  const out = [`--- ${fromFile}`, `+++ ${toFile}`];
  for (const h of hunks) {
    out.push(`@@ -${h.aStart},${h.aCount} +${h.bStart},${h.bCount} @@`);
    out.push(...h.body);
  }
  return out.join('\n');
}

export interface SideBySideRow {
  left?: string;
  right?: string;
  leftNumber?: number;
  rightNumber?: number;
  op: Op | 'changed';
}

/** Aligns the two texts into rows for a two-column view. */
export function sideBySide(a: string, b: string, options: DiffOptions = {}): SideBySideRow[] {
  const result = diffText(a, b, { ...options, granularity: 'line' });
  const rows: SideBySideRow[] = [];
  let leftNumber = 1;
  let rightNumber = 1;

  for (let i = 0; i < result.changes.length; i++) {
    const change = result.changes[i]!;
    if (change.op === 'equal') {
      for (const value of change.values) {
        rows.push({ left: value, right: value, leftNumber: leftNumber++, rightNumber: rightNumber++, op: 'equal' });
      }
      continue;
    }

    // A delete immediately followed by an insert is a modification: pair them
    // up so the two versions of a line sit side by side.
    if (change.op === 'delete' && result.changes[i + 1]?.op === 'insert') {
      const removed = change.values;
      const added = result.changes[i + 1]!.values;
      const pairs = Math.max(removed.length, added.length);
      for (let j = 0; j < pairs; j++) {
        rows.push({
          left: removed[j],
          right: added[j],
          leftNumber: removed[j] !== undefined ? leftNumber++ : undefined,
          rightNumber: added[j] !== undefined ? rightNumber++ : undefined,
          op:
            removed[j] !== undefined && added[j] !== undefined
              ? 'changed'
              : removed[j] !== undefined
                ? 'delete'
                : 'insert',
        });
      }
      i++;
      continue;
    }

    for (const value of change.values) {
      if (change.op === 'delete') rows.push({ left: value, leftNumber: leftNumber++, op: 'delete' });
      else rows.push({ right: value, rightNumber: rightNumber++, op: 'insert' });
    }
  }
  return rows;
}

/** Describes what differs beyond the visible characters, which is often the answer. */
export function invisibleDifferences(a: string, b: string): string[] {
  const notes: string[] = [];
  const lineEnding = (s: string) => (s.includes('\r\n') ? 'CRLF' : s.includes('\r') ? 'CR' : 'LF');
  if (lineEnding(a) !== lineEnding(b)) {
    notes.push(`Line endings differ: the left side uses ${lineEnding(a)} and the right uses ${lineEnding(b)}.`);
  }
  if (a.replace(/[ \t]+$/gm, '') !== a || b.replace(/[ \t]+$/gm, '') !== b) {
    const side =
      a.replace(/[ \t]+$/gm, '') !== a
        ? b.replace(/[ \t]+$/gm, '') !== b
          ? 'Both sides have'
          : 'The left side has'
        : 'The right side has';
    notes.push(`${side} trailing whitespace at the end of one or more lines.`);
  }
  if (a.endsWith('\n') !== b.endsWith('\n')) {
    notes.push(`One side ends with a newline and the other does not.`);
  }
  if (a.startsWith('﻿') !== b.startsWith('﻿')) {
    notes.push('One side begins with a byte order mark (U+FEFF) and the other does not.');
  }
  // Zero-width and bidirectional controls, built from code points so this
  // source file stays plain ASCII and the characters cannot be lost in a copy.
  const invisible = new RegExp('[\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff]');
  if (invisible.test(a) || invisible.test(b)) {
    notes.push('One side contains zero-width or bidirectional control characters, which are invisible on screen.');
  }
  if (a.normalize('NFC') === b.normalize('NFC') && a !== b) {
    notes.push(
      'These are the same text in different Unicode normal forms. They look identical and are not byte-equal.',
    );
  }
  return notes;
}
