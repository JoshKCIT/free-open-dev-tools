import { inspectCookies, type CookieReport, type CookieRow, type RequestContext } from '../src/index';

/** Tuesday 6 October 2026 12:00:00 UTC: the fixed moment every test counts lifetimes from. */
export const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

/** A secure address on site.example whose default path is /account. */
export const PAGE = 'https://site.example/account/login';

export interface Options {
  url?: string;
  context?: RequestContext;
  nowMs?: number;
  reveal?: boolean;
}

/** Inspects a paste with the fixed time and a secure same-site request unless an option says otherwise. */
export function inspect(lines: string, options: Options = {}): CookieReport {
  return inspectCookies({
    lines,
    requestUrl: options.url ?? PAGE,
    context: options.context ?? 'same-site',
    nowMs: options.nowMs ?? NOW,
    reveal: options.reveal ?? false,
  });
}

/** The first row of a paste. Throws when the paste gave none. */
export function one(lines: string, options: Options = {}): CookieRow {
  const row = inspect(lines, options).cookies[0];
  if (row === undefined) throw new Error('the paste gave no row');
  return row;
}

/** A small seeded generator (mulberry32) so a test never depends on the clock or on Math.random. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
