import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/catalog.mjs';

/**
 * HARD-08 (D-221, D-223 i): every file that says something about the page policy says the same true thing, and none
 * keeps a sentence that was true only before the policy was written into each page.
 *
 * `.planning/PROJECT.md` is git-ignored, so it is not read here (CI never has it); the planning record is checked by a
 * command the plan runs by hand. Everything else that mentions the policy is listed below with the words it must hold.
 *
 * The stale phrases are spelled out on purpose: they are the sentences the files held before the policy existed, and
 * the point of the test is that none of them comes back. Text is flattened first (comment stars, slashes and line
 * breaks become one space), so a phrase wrapped across lines or comment lines is still found.
 */

const EM_DASH = String.fromCodePoint(0x2014);

/** Sentences the project files used to say. A listed file holding any of them is stale. */
export const STALE_PHRASES = [
  'as of the v1.1 close no page carries one',
  'still states the intent as fact',
  'The intent is a content security policy',
  'applied per page rather than at the header level',
  'The page-level content security policy is applied where it can be',
  'a site with no page-level content security policy',
  'there is no content security policy here',
  'not set today only because GitHub Pages cannot',
  'GitHub Pages sends no policy at all',
];

/** The words that make the account true: each page has its own policy, and the limits of a policy in markup. */
const TRUTH_WORDS = ['its own', 'framing', 'navigat', 'WebRTC', 'extension'];

/** Collapses line breaks, comment stars and comment slashes so a wrapped phrase is one run of text. */
export function flat(text) {
  return text
    .replace(/\s*\n\s*(?:\/\*\*\s*|\*\/\s*|\*\s+|\/\/\s*)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The required words that `text` does not hold. */
export function missingWords(text, words) {
  const body = flat(text);
  return words.filter((word) => !body.includes(word));
}

/** The stale phrases that `text` still holds. */
export function stalePhrasesIn(text, phrases = STALE_PHRASES) {
  const body = flat(text);
  return phrases.filter((phrase) => body.includes(phrase));
}

/** The text between two markers (the start marker included), or null when either marker is missing. */
export function between(text, start, end) {
  const from = text.indexOf(start);
  if (from < 0) return null;
  const to = end === undefined ? text.length : text.indexOf(end, from + start.length);
  if (to < 0) return null;
  return text.slice(from, to);
}

/**
 * The files that state the page policy. `required` words must be present; `sections` are the changed parts, checked
 * for em dashes (older text in the same files may hold some, so only these parts are held to the rule).
 */
export const FILES = [
  {
    path: 'apps/web/src/pages/Privacy.tsx',
    required: [...TRUTH_WORDS, 'Each page has its own content security policy'],
    sections: [
      ['<h2>Each page has its own content security policy</h2>', '<h2>Tools that would need the network</h2>'],
    ],
    order: ['What it blocks', 'What it cannot do'],
  },
  {
    path: '.claude/CLAUDE.md',
    required: [...TRUTH_WORDS, 'weak copyleft (MPL and similar) needs an explicit owner OK'],
    sections: [['- **Hosting**', '- **Provenance**']],
  },
];

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

describe('the page policy is described truthfully in every listed file', () => {
  for (const file of FILES) {
    describe(file.path, () => {
      const text = read(file.path);

      it('holds every required word', () => {
        expect(missingWords(text, file.required)).toEqual([]);
      });

      it('holds none of the stale phrases', () => {
        expect(stalePhrasesIn(text)).toEqual([]);
      });

      it('holds no em dash in the sections that state the policy', () => {
        for (const [start, end] of file.sections) {
          const part = between(text, start, end);
          expect(part, `section starting ${start} was not found`).not.toBeNull();
          expect(part.includes(EM_DASH)).toBe(false);
        }
      });

      if (file.order) {
        it('says what the policy blocks before what it cannot do', () => {
          const body = flat(text);
          const [first, second] = file.order.map((marker) => body.indexOf(marker));
          expect(first, `marker ${file.order[0]} not found`).toBeGreaterThanOrEqual(0);
          expect(second, `marker ${file.order[1]} not found`).toBeGreaterThanOrEqual(0);
          expect(first).toBeLessThan(second);
        });
      }
    });
  }
});

describe('the wording helpers can fail', () => {
  it('reports a required word that a text lacks', () => {
    expect(missingWords('each page carries its own policy', TRUTH_WORDS)).toEqual([
      'framing',
      'navigat',
      'WebRTC',
      'extension',
    ]);
  });

  it('reports a stale phrase even when a comment wraps it across lines', () => {
    const wrapped = '/**\n * a site with no page-level\n * content security policy outside that frame\n */';
    expect(stalePhrasesIn(wrapped)).toEqual(['a site with no page-level content security policy']);
  });

  it('finds nothing stale in a true sentence', () => {
    expect(stalePhrasesIn('Each page carries its own policy in its markup.')).toEqual([]);
  });

  it('returns null for a section whose marker is missing', () => {
    expect(between('abc', 'x', 'y')).toBeNull();
    expect(between('abc xyz', 'abc', 'xyz')).toBe('abc ');
  });
});
