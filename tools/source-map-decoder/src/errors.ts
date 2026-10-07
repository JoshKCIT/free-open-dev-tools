/**
 * A refusal of what was pasted or opened. The message says what is wrong and where (a map number, a trace line or a
 * character position), and never repeats any of the pasted text, so it can be shown, copied or logged by someone else
 * without leaking a path, a name or a line of source.
 */
export class SourceMapError extends Error {
  /** Which input the problem is in. */
  readonly part: 'trace' | 'maps' | 'map file';
  /** The map the problem is in, counting from 1 in the order the maps were given. Absent when no single map is to blame. */
  readonly map?: number;
  /** The trace line the problem is on, counting from 1. Absent when no single line is to blame. */
  readonly line?: number;

  constructor(message: string, part: 'trace' | 'maps' | 'map file', where: { map?: number; line?: number } = {}) {
    super(message);
    this.name = 'SourceMapError';
    this.part = part;
    if (where.map !== undefined) this.map = where.map;
    if (where.line !== undefined) this.line = where.line;
  }
}

/** One thing the strict reader found wrong with a map. A finding is a result, never a thrown error. */
export interface Finding {
  level: 'error' | 'warn';
  message: string;
}

/** The most findings kept for one map. The rest are counted in one closing finding. */
export const MAX_FINDINGS_PER_MAP = 200;

/**
 * Adds a finding to a list that holds at most MAX_FINDINGS_PER_MAP of them plus one closing line, so a map with
 * millions of faults costs a counter, not memory. Always O(1). The closing line takes the error level as soon as one
 * finding that was left out is an error, so a list is never clean of errors by being long.
 */
export function addFinding(list: Finding[], level: 'error' | 'warn', message: string): void {
  if (list.length < MAX_FINDINGS_PER_MAP) {
    list.push({ level, message });
    return;
  }
  if (list.length === MAX_FINDINGS_PER_MAP) list.push({ level, message: 'More findings were left out of this list.' });
  else if (level === 'error') {
    const closing = list[list.length - 1];
    if (closing) closing.level = 'error';
  }
}

/** True when a list holds a finding at the error level. */
export function hasError(list: readonly Finding[]): boolean {
  for (const finding of list) if (finding.level === 'error') return true;
  return false;
}
