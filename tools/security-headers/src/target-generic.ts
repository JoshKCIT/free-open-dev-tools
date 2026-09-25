import type { HeaderEntry } from './index';

/** Plain `Name: value` lines, one per header -- for any server this project has no dedicated target for. */
export function renderGeneric(headers: HeaderEntry[]): string {
  return headers.map((h) => `${h.name}: ${h.value}`).join('\n');
}
