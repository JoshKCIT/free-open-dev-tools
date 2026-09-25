/**
 * Differential test: this package's own RFC 9309 matcher against
 * robots-parser (devDependency-only, test-only second opinion). robots-parser
 * predates RFC 9309 (its own README changelog says only "Changed order of
 * precedence to match current spec" and "Changed matching algorithm to match
 * Google's implementation in google/robotstxt"); reading its source
 * (`Robots.js`, function `normaliseEncoding`) shows it never decodes an
 * existing percent-encoded octet back to its literal character -- it only
 * uppercases the hex digits of an existing "%XX" triple and escapes a raw
 * non-ASCII byte. RFC 9309 section 2.2.2 requires a percent-encoded ASCII
 * octet to be decoded back to its literal character when that character is
 * unreserved (Figure 4's last row: "%62%61%7A" compares as "baz"), so any
 * seeded case whose path or pattern contains a percent-encoded-unreserved
 * octet is expected to disagree with robots-parser, and only that case.
 */
import robotsParser from 'robots-parser';
import { it, expect } from 'vitest';
import { buildRobotsTxt, checkPath, parseRobotsTxt } from '../src/index';

/** A small hand-written 32-bit generator, deterministic for a fixed seed (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260925);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

const TOKENS = ['foobot', 'barbot', 'bazbot', 'ExampleBot', 'QUXBOT', 'other-bot', 'a', 'a_b-c'];
const SEGMENTS = ['foo', 'bar', 'baz', 'example', 'a', 'B', 'file.html', 'x-y_z', '1', 'page'];
/** Each of these decodes to an unreserved ASCII letter, deliberately exercising the documented divergence above. */
const UNRESERVED_ENCODED_SEGMENTS = ['%61', '%62', '%63', 'pre%61fix'];

function randomPattern(): string {
  const segCount = 1 + Math.floor(rand() * 3);
  const segs: string[] = [];
  for (let i = 0; i < segCount; i++) {
    if (rand() < 0.08) segs.push(pick(UNRESERVED_ENCODED_SEGMENTS));
    else if (rand() < 0.15) segs.push('*');
    else segs.push(pick(SEGMENTS));
  }
  let pattern = '/' + segs.join('/');
  if (rand() < 0.15) pattern += '$';
  return pattern;
}

function randomPath(): string {
  const segCount = 1 + Math.floor(rand() * 3);
  const segs: string[] = [];
  for (let i = 0; i < segCount; i++) {
    if (rand() < 0.05) segs.push(pick(UNRESERVED_ENCODED_SEGMENTS));
    else segs.push(pick(SEGMENTS));
  }
  return '/' + segs.join('/');
}

function buildDocument(): { text: string; usesUnreservedEncoding: boolean } {
  const groupCount = 1 + Math.floor(rand() * 3);
  const groups = [];
  let usesUnreservedEncoding = false;
  for (let g = 0; g < groupCount; g++) {
    const agentCount = 1 + Math.floor(rand() * 2);
    const agents: string[] = [];
    for (let a = 0; a < agentCount; a++) agents.push(rand() < 0.2 ? '*' : pick(TOKENS));
    const ruleCount = 1 + Math.floor(rand() * 3);
    const rules: { type: 'allow' | 'disallow'; pattern: string }[] = [];
    for (let r = 0; r < ruleCount; r++) {
      const pattern = randomPattern();
      if (pattern.includes('%')) usesUnreservedEncoding = true;
      rules.push({ type: rand() < 0.5 ? 'allow' : 'disallow', pattern });
    }
    groups.push({ agents, rules });
  }
  const { text } = buildRobotsTxt({ groups, sitemaps: [] });
  return { text, usesUnreservedEncoding };
}

const BASE_URL = 'https://example.invalid';

it('verdicts match robots-parser on the generated battery except the listed known differences', () => {
  const KNOWN_DIFFERENCES = [
    'RFC 9309 section 2.2.2: a percent-encoded octet that decodes to an unreserved character is compared decoded here; robots-parser only uppercases its hex digits and never decodes it, so any case whose path or pattern contains an unreserved-decodable percent-encoded octet is expected to disagree.',
  ];

  const DOC_COUNT = 40;
  const CASES_PER_DOC = 50;
  let total = 0;
  const unexpectedMismatches: string[] = [];
  let sawDocumentedDifference = false;

  for (let d = 0; d < DOC_COUNT; d++) {
    const { text, usesUnreservedEncoding } = buildDocument();
    const parsed = parseRobotsTxt(text);
    const oracle = robotsParser(`${BASE_URL}/robots.txt`, text);

    for (let c = 0; c < CASES_PER_DOC; c++) {
      total++;
      const token = pick(TOKENS);
      const path = randomPath();
      const pathHasUnreservedEncoding = path.includes('%');

      const mine = checkPath(parsed, token, path).allowed;
      const theirs = oracle.isAllowed(`${BASE_URL}${path}`, token);
      if (theirs === undefined) continue; // robots-parser declines to answer (URL mismatch); not comparable.

      if (mine !== theirs) {
        if (usesUnreservedEncoding || pathHasUnreservedEncoding) {
          sawDocumentedDifference = true;
          continue;
        }
        unexpectedMismatches.push(`doc#${d} token=${JSON.stringify(token)} path=${JSON.stringify(path)}`);
      }
    }
  }

  expect(total).toBeGreaterThanOrEqual(2000);
  expect(unexpectedMismatches).toEqual([]);
  // The documented difference is genuinely exercised by the seeded battery, not a dead entry.
  expect(sawDocumentedDifference).toBe(true);
  expect(KNOWN_DIFFERENCES.length).toBeGreaterThan(0);
});
