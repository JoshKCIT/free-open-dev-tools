import meta from './meta.json';

export { meta };

export class DateDiffError extends Error {
  /** Index into the input where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'DateDiffError';
    this.position = position;
  }
}

export interface Duration {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export interface Difference {
  /** 1 if the second moment is later, -1 if earlier, 0 if the same instant. */
  sign: -1 | 0 | 1;
  totalSeconds: number;
  /** The exact gap, decomposed with no calendar ambiguity: every day is 86,400 seconds. */
  exact: { days: number; hours: number; minutes: number; seconds: number };
  /** The gap as a calendar breakdown, computed from the earlier moment forward. */
  calendar: Duration;
}

export function parseMoment(_text: string): number {
  throw new Error('not implemented');
}

export function parseDuration(_text: string): Duration {
  throw new Error('not implemented');
}

export function diffMoments(_a: number, _b: number): Difference {
  throw new Error('not implemented');
}

export function addDuration(_momentMs: number, _duration: Duration, _sign: 1 | -1 = 1): number {
  throw new Error('not implemented');
}

export function formatIsoDuration(_duration: Duration): string {
  throw new Error('not implemented');
}
