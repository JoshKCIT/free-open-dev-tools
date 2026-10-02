import { expect, it } from 'vitest';
import { QUANTITIES, UNITS, convertUnit, listUnits } from '../src/index';

/*
 * Whether a conversion is "exact" is decided here with whole-number fractions (BigInt), written out in this file and
 * sharing nothing with the code under test except the printed numerator and denominator text of each unit (those
 * values are pinned against NIST SP 811, Handbook 44, the SI Brochure and Python's fractions module in index.test.ts).
 *
 * A fraction n / d is a finite decimal exactly when, after dividing out the greatest common divisor, the denominator
 * has no prime factor other than 2 and 5.
 */

/** Decimal text such as 0.0254, 1e-7 or 4.5359237e-1 as a numerator and denominator. */
function fractionOf(text: string): [bigint, bigint] {
  let body = text.toLowerCase();
  let exponent = 0;
  const e = body.indexOf('e');
  if (e >= 0) {
    exponent = Number(body.slice(e + 1));
    body = body.slice(0, e);
  }
  const negative = body.startsWith('-');
  if (negative) body = body.slice(1);
  const [whole, part = ''] = body.split('.');
  let n = BigInt(`${whole}${part}`);
  let d = 10n ** BigInt(part.length);
  if (exponent >= 0) n *= 10n ** BigInt(exponent);
  else d *= 10n ** BigInt(-exponent);
  return [negative ? -n : n, d];
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function ends(n: bigint, d: bigint): boolean {
  let rest = d / gcd(n, d);
  while (rest % 2n === 0n) rest /= 2n;
  while (rest % 5n === 0n) rest /= 5n;
  return rest === 1n;
}

type Unit = (typeof UNITS)[keyof typeof UNITS][number];

/** The unit's own factor, num / den, ends. A unit written in pi never ends. */
function unitEnds(u: Unit): boolean {
  if (u.pi) return false;
  const [a, b] = fractionOf(u.num);
  const [c, d] = fractionOf(u.den);
  return ends(a * d, b * c);
}

/** The factor between two linear units, (from.num / from.den) / (to.num / to.den), ends. */
function ratioEnds(from: Unit, to: Unit): boolean {
  if (from.pi !== to.pi) return false;
  const [fn, fd] = fractionOf(from.num);
  const [fdn, fdd] = fractionOf(from.den);
  const [tn, td] = fractionOf(to.num);
  const [tdn, tdd] = fractionOf(to.den);
  return ends(fn * tdn * fdd * td, fd * tdd * fdn * tn);
}

it('the oracle itself knows a factor that ends from one that does not', () => {
  expect(ends(1n, 8n)).toBe(true);
  expect(ends(1n, 3n)).toBe(false);
  expect(ends(7n, 14n)).toBe(true);
  expect(ends(1n, 12n)).toBe(false);
  expect(ends(3n, 6n)).toBe(true);
});

it('says exact for a pair only when both definitions are exact and the factor really ends (every pair of every quantity)', () => {
  let pairs = 0;
  const wrong: string[] = [];
  for (const q of QUANTITIES) {
    const units = UNITS[q.id];
    for (const from of units) {
      for (const to of units) {
        pairs += 1;
        const linear = from.kind === 'linear' && to.kind === 'linear';
        const finiteEnds = linear ? ratioEnds(from, to) : unitEnds(from) && unitEnds(to);
        const expected = from.exact && to.exact && finiteEnds;
        let value = '1';
        if (from.kind === 'affine') value = '300';
        const got = convertUnit(q.id, value, from.symbol, to.symbol, 10).exact;
        if (got !== expected) wrong.push(`${q.id}: ${from.symbol} to ${to.symbol} gave ${got}, expected ${expected}`);
      }
    }
  }
  expect(pairs).toBeGreaterThan(1000);
  expect(wrong).toEqual([]);
}, 60_000);

it('says finite for a unit only when its own factor really ends, in the list of every unit of a quantity', () => {
  const wrong: string[] = [];
  for (const q of QUANTITIES) {
    for (const u of UNITS[q.id]) {
      if (u.finite !== unitEnds(u)) wrong.push(`${q.id}: ${u.symbol} finite ${u.finite}, expected ${unitEnds(u)}`);
    }
    for (const from of UNITS[q.id]) {
      const rows = listUnits(q.id, from.kind === 'affine' ? '300' : '1', from.symbol, 10);
      for (const row of rows) {
        const u = UNITS[q.id].find((x) => x.id === row.id);
        if (u === undefined) throw new Error(`no unit ${row.id}`);
        if (row.exact !== (u.exact && unitEnds(u))) wrong.push(`${q.id}: row ${row.symbol} exact ${row.exact}`);
      }
    }
  }
  expect(wrong).toEqual([]);
}, 60_000);

it('does not call a joule to electronvolt conversion exact, because 1 / 1.602176634e-19 never ends', () => {
  const r = convertUnit('energy', '1', 'J', 'eV', 10);
  expect(r.exact).toBe(false);
  expect(convertUnit('energy', '1', 'eV', 'J', 10).exact).toBe(true);
});

it('does not call a cubic inch to cubic foot or an hour to week conversion exact when the factor repeats', () => {
  expect(convertUnit('volume', '1', 'in3', 'ft3', 10).exact).toBe(false);
  expect(convertUnit('time', '1', 'h', 'wk', 10).exact).toBe(false);
});
