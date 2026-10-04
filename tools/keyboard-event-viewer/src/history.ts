import type { KeyEventRecord } from './format';

/** The most events the history keeps; the oldest are dropped first. */
export const MAX_HISTORY_ROWS = 200;

/** Which event types are shown. Showing fewer never removes anything from the history. */
export interface ShownTypes {
  keydown: boolean;
  keypress: boolean;
  keyup: boolean;
  composition: boolean;
}

/** A bounded, in-memory list of key events, newest last. */
export class KeyHistory {
  private items: KeyEventRecord[] = [];
  /** How many events were dropped from the front since the last clear. */
  dropped = 0;

  get size(): number {
    return this.items.length;
  }

  add(record: KeyEventRecord): void {
    this.items.push(record);
    if (this.items.length > MAX_HISTORY_ROWS) {
      this.items.shift();
      this.dropped++;
    }
  }

  clear(): void {
    this.items = [];
    this.dropped = 0;
  }

  /** The kept events of the shown types, oldest first. A filter for display only: nothing stored is changed. */
  rows(shown: ShownTypes): KeyEventRecord[] {
    return this.items.filter((r) => {
      if (r.type === 'keydown') return shown.keydown;
      if (r.type === 'keypress') return shown.keypress;
      if (r.type === 'keyup') return shown.keyup;
      return shown.composition;
    });
  }
}
