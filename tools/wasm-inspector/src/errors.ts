import { MAX_NOTES } from './limits';

/**
 * The error this package throws. A fault inside a module is a finding, never a throw out of `inspect`; this error is for a
 * file the reader will not start on (over 64 MiB) and, inside the readers, for the fault that ends one section's reading
 * (the section reader turns it into a finding).
 *
 * RULE, stated once and enforced by a test: no message repeats module bytes. A message names an offset and the rule that
 * was broken, with numbers read from the file but never a name or a byte string.
 */
export class WasmInspectorError extends Error {
  /** Where in the file the fault was found, when there is one. */
  readonly offset?: number;
  constructor(message: string, offset?: number) {
    super(message);
    this.name = 'WasmInspectorError';
    if (offset !== undefined) this.offset = offset;
  }
}

/** One thing the reader could not follow or found odd, with the offset in the file. */
export interface Finding {
  offset: number;
  message: string;
}

/**
 * The findings kept, at most `MAX_NOTES`, and how many more there were. A sentence may be given as a function, so a
 * finding that is only counted builds no sentence: a module whose every item is slightly wrong costs a count per item.
 */
export class FindingList {
  readonly items: Finding[] = [];
  leftOut = 0;

  add(offset: number, text: string | (() => string)): void {
    if (this.items.length >= MAX_NOTES) {
      this.leftOut++;
      return;
    }
    this.items.push({ offset, message: `At offset ${offset}: ${typeof text === 'string' ? text : text()}` });
  }

  /** True when nothing was found at all. */
  get empty(): boolean {
    return this.items.length === 0 && this.leftOut === 0;
  }
}
