// The scorer and both language packs are imported statically here, never
// with a dynamic, lazy-loading import call inside score(). A lazy load
// would issue a network request for the dictionary chunk the first time a
// visitor typed into this page, and the privacy harness starts recording
// before it types (e2e/privacy.spec.ts arms its recorder on page load), so
// that request would be recorded as a leak and fail the privacy gate for
// this page. Do not convert these to a lazy load as an optimisation.
import {
  ZxcvbnFactory,
  type MatchExtended,
  type DictionaryMatch,
  type RepeatMatch,
  type SequenceMatch,
  type SpatialMatch,
  type RegexMatch,
} from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnEn from '@zxcvbn-ts/language-en';
import meta from './meta.json';

export { meta };

export class PasswordStrengthError extends Error {}

/**
 * A password longer than this is truncated before scoring. The scorer's own
 * matching cost grows with length and this page scores on every keystroke,
 * so an unbounded input could make typing feel unresponsive. 256 matches the
 * scorer's own default `maxLength` (Options.ts), and no real password comes
 * close to it, so nothing genuine is ever affected by the cap.
 */
export const MAX_PASSWORD_LENGTH = 256;

export interface ScoreLabel {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Matches the design contract's tone mapping (02-UI-SPEC.md Section 4): 0-1 error, 2 warn, 3 info, 4 success. */
  tone: 'error' | 'warn' | 'info' | 'success';
  note: string;
}

/**
 * One entry per possible score, in the register `tools/hash-text/src/index.ts`'s
 * `ALGORITHMS` array uses: a short label plus a plain-English note per entry.
 * The page's tone lookup is a single index into this array (`SCORE_LABELS[score].tone`),
 * so the tone mapping lives in exactly one place.
 */
export const SCORE_LABELS: ScoreLabel[] = [
  {
    score: 0,
    label: 'Very weak',
    tone: 'error',
    note: 'Guessed almost immediately by any real attacker, online or offline.',
  },
  {
    score: 1,
    label: 'Weak',
    tone: 'error',
    note: 'Survives only an online attack that is slowed down by a rate limit.',
  },
  {
    score: 2,
    label: 'Fair',
    tone: 'warn',
    note: 'Survives an online attack with no rate limit, but not much beyond that.',
  },
  {
    score: 3,
    label: 'Strong',
    tone: 'info',
    note: 'Survives an offline attack against a slow, properly salted hash function.',
  },
  {
    score: 4,
    label: 'Very strong',
    tone: 'success',
    note: 'Survives a sustained offline attack even against a slow hash.',
  },
];

export interface StrengthReason {
  /** A plain-language sentence. Never contains the password or any fragment of it. */
  sentence: string;
  /** The kind of match the scorer reported: dictionary, repeat, sequence, spatial, date, regex, wordSequence, separator or bruteforce. */
  kind: string;
  /** 0-based index of the first character of the password this reason covers. */
  start: number;
  /** 0-based index of the last character of the password this reason covers. */
  end: number;
}

export interface CrackTimeScenario {
  /** A plain-language attack scenario name, never the scorer's internal key. */
  scenario: string;
  /** A human-readable estimate, e.g. "3 seconds" or "centuries". */
  display: string;
  /** The same estimate in seconds. */
  seconds: number;
}

export interface StrengthReport {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  tone: 'error' | 'warn' | 'info' | 'success';
  /** One entry per match the scorer found, in the order they occur in the password. Renders for every score, including the strongest. */
  reasons: StrengthReason[];
  /** One entry per attack scenario the scorer reports, in a fixed order. */
  crackTimes: CrackTimeScenario[];
  /** True when the input was longer than MAX_PASSWORD_LENGTH and was truncated before scoring. */
  truncated: boolean;
}

const CRACK_TIME_ORDER: readonly [
  (
    | 'onlineThrottlingXPerHour'
    | 'onlineNoThrottlingXPerSecond'
    | 'offlineSlowHashingXPerSecond'
    | 'offlineFastHashingXPerSecond'
  ),
  string,
][] = [
  ['onlineThrottlingXPerHour', 'Online attack, rate-limited'],
  ['onlineNoThrottlingXPerSecond', 'Online attack, no rate limit'],
  ['offlineSlowHashingXPerSecond', 'Offline attack, slow/salted hash'],
  ['offlineFastHashingXPerSecond', 'Offline attack, fast/unsalted hash'],
];

function dictionaryKindName(dictionaryName: string): string {
  if (dictionaryName === 'passwords-common') return 'a value seen in widely known leaked-credential lists';
  if (dictionaryName === 'diceware-common') return 'a common word from a large word list';
  if (dictionaryName === 'commonWords-en') return 'a common English word';
  if (dictionaryName === 'firstnames-en') return 'a common first name';
  if (dictionaryName === 'lastnames-en') return 'a common last name';
  if (dictionaryName === 'wikipedia-en') return 'a word or name found in a large reference text';
  return 'a common word, name or pattern';
}

/** Turns one match from the scorer's sequence into a plain-language reason. Never reads `token` or `matchedWord` into the output text. */
function describeMatch(match: MatchExtended): { sentence: string; kind: string } {
  switch (match.pattern) {
    case 'dictionary': {
      const m = match as DictionaryMatch;
      const qualifiers: string[] = [];
      if (m.l33t) qualifiers.push('with letters swapped for look-alike numbers or symbols');
      if (m.reversed) qualifiers.push('spelled backwards');
      const suffix = qualifiers.length > 0 ? ` (${qualifiers.join(', ')})` : '';
      return { sentence: `Contains ${dictionaryKindName(m.dictionaryName)}${suffix}.`, kind: 'dictionary' };
    }
    case 'repeat': {
      const m = match as RepeatMatch;
      return {
        sentence: `Repeats the same character or short pattern ${m.repeatCount} times in a row.`,
        kind: 'repeat',
      };
    }
    case 'sequence': {
      const m = match as SequenceMatch;
      return {
        sentence: `A run of ${m.ascending ? 'increasing' : 'decreasing'} characters in a predictable sequence, such as consecutive letters or digits.`,
        kind: 'sequence',
      };
    }
    case 'spatial': {
      const m = match as SpatialMatch;
      return {
        sentence: `A sequence of keys that sit next to each other on a ${m.graph} keyboard layout.`,
        kind: 'spatial',
      };
    }
    case 'date': {
      return { sentence: 'A calendar date, which is easy to guess if it means something to you.', kind: 'date' };
    }
    case 'regex': {
      const m = match as RegexMatch;
      if (m.regexName === 'recentYear') {
        return { sentence: 'A recent calendar year, commonly appended to passwords.', kind: 'regex' };
      }
      return { sentence: 'A recognisable pattern matched by a common rule.', kind: 'regex' };
    }
    case 'wordSequence': {
      return {
        sentence:
          'A sequence of related words in a predictable order, such as consecutive days of the week or points of a compass.',
        kind: 'wordSequence',
      };
    }
    case 'separator': {
      return {
        sentence: 'A common separator character, such as a space or a hyphen, between two other parts.',
        kind: 'separator',
      };
    }
    case 'bruteforce':
    default: {
      const token = typeof match.token === 'string' ? match.token : '';
      const n = token.length;
      const plural = n === 1 ? '' : 's';
      if (/^[0-9]+$/.test(token)) {
        return {
          sentence: `Adds ${n} digit${plural} with no pattern of their own; appending digits to a word is still one of the first things an attacker tries.`,
          kind: 'bruteforce',
        };
      }
      return {
        sentence: `Adds ${n} character${plural} with no pattern the scorer recognises.`,
        kind: 'bruteforce',
      };
    }
  }
}

let factory: ZxcvbnFactory | undefined;
let setupCalls = 0;

/**
 * The scorer's options-setting call must run exactly once, and only when
 * `score()` is first called. The generated package.json marks every tool
 * package `sideEffects: false` (scripts/sync-tools.mjs), which tells a
 * bundler it may drop a top-level call whose result nothing visibly uses --
 * so this cannot run at module load time. Keeping it behind this
 * module-level flag, reachable only from inside score(), is what survives
 * tree-shaking.
 */
function ensureFactory(): ZxcvbnFactory {
  if (!factory) {
    factory = new ZxcvbnFactory({
      translations: zxcvbnEn.translations,
      graphs: zxcvbnCommon.adjacencyGraphs,
      dictionary: {
        ...zxcvbnCommon.dictionary,
        ...zxcvbnEn.dictionary,
      },
      maxLength: MAX_PASSWORD_LENGTH,
    });
    setupCalls += 1;
  }
  return factory;
}

/**
 * Test-only: how many times the one-time setup above has actually run in
 * this module instance. Not part of the documented public API -- it exists
 * so the test suite can prove the setup call really is a one-time cost
 * rather than re-running on every keystroke.
 */
export function __setupCallCountForTesting(): number {
  return setupCalls;
}

/** Scores a password against the installed word-list-backed model and turns its match sequence into a plain-language report. */
export function score(password: string): StrengthReport {
  if (typeof password !== 'string') {
    throw new PasswordStrengthError('score() requires a string password.');
  }

  const truncated = password.length > MAX_PASSWORD_LENGTH;
  const capped = truncated ? password.slice(0, MAX_PASSWORD_LENGTH) : password;

  const instance = ensureFactory();
  const result = instance.check(capped);

  const reasons: StrengthReason[] = result.sequence.map((match) => {
    const { sentence, kind } = describeMatch(match);
    return { sentence, kind, start: match.i, end: match.j };
  });

  const crackTimes: CrackTimeScenario[] = CRACK_TIME_ORDER.map(([key, scenario]) => ({
    scenario,
    display: result.crackTimes[key].display,
    seconds: result.crackTimes[key].seconds,
  }));

  const scoreLabel = SCORE_LABELS[result.score]!;

  return {
    score: result.score,
    label: scoreLabel.label,
    tone: scoreLabel.tone,
    reasons,
    crackTimes,
    truncated,
  };
}
