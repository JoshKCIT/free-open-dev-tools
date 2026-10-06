import { expect, it } from 'vitest';
import { SpfDmarcError, countLookups, readTxtRecords } from '../src/index';

// The whole-evaluation count of RFC 7208 section 4.6.4 counts the terms of every record that include and redirect lead to.
// The page never queries DNS, so it follows only the records the visitor pasted, matched by their name.

/** A pasted record as the reader gives it. */
function rec(label: string | null, text: string) {
  return { label, text, strings: [], warnings: [], line: 1 };
}

it('the lookup tree follows pasted labelled records, stops a loop and marks a missing name as a lower bound', () => {
  // A main record that includes _spf.example.net, pasted as a labelled record with two lookups of its own: 1 + 2.
  const main = rec(null, 'v=spf1 include:_spf.example.net -all');
  const inner = rec('_spf.example.net', 'v=spf1 a mx ip4:192.0.2.0/24 -all');
  const whole = countLookups([main, inner], 0);
  expect(whole.total).toBe(3);
  expect(whole.lowerBound).toBe(false);
  expect(whole.stopped).toBe(false);
  expect(whole.missing).toEqual([]);
  expect(whole.loops).toEqual([]);
  expect(whole.rows.map((r) => [r.label, r.reachedFrom, r.lookups, r.times])).toEqual([
    ['(first record)', '', 1, 1],
    ['_spf.example.net', 'include:_spf.example.net', 2, 1],
  ]);
  // Without the pasted record the count is only the main record's own, and a lower bound.
  const alone = countLookups([main], 0);
  expect(alone.total).toBe(1);
  expect(alone.lowerBound).toBe(true);
  expect(alone.missing).toEqual(['_spf.example.net']);

  // A loop between two pasted records stops at once and names both.
  const loop = countLookups(
    [
      rec(null, 'v=spf1 include:a.example -all'),
      rec('a.example', 'v=spf1 include:b.example -all'),
      rec('b.example', 'v=spf1 include:a.example -all'),
    ],
    0,
  );
  expect(loop.loops).toEqual([{ from: 'b.example', to: 'a.example' }]);
  expect(loop.total).toBe(3);
  expect(loop.lowerBound).toBe(true);
  expect(loop.stopped).toBe(false);
  expect(loop.rows.map((r) => r.label)).toEqual(['(first record)', 'a.example', 'b.example']);
  // A record that includes itself is a loop too.
  const self = countLookups([rec('me.example', 'v=spf1 include:me.example -all')], 0);
  expect(self.loops).toEqual([{ from: 'me.example', to: 'me.example' }]);
  expect(self.total).toBe(1);

  // An include of a name that was not pasted makes the total a lower bound and lists the name, once.
  const missing = countLookups(
    [
      rec(null, 'v=spf1 include:_spf.example.net include:other.example include:other.example -all'),
      rec('_spf.example.net', 'v=spf1 a mx -all'),
    ],
    0,
  );
  expect(missing.total).toBe(5);
  expect(missing.lowerBound).toBe(true);
  expect(missing.missing).toEqual(['other.example']);

  // The count stops at 11 and reads 11 or more; a chain of exactly 10 is exact.
  const chain = (length: number) =>
    Array.from({ length: length + 1 }, (_, i) =>
      rec(i === 0 ? null : `r${i}.example`, i < length ? `v=spf1 include:r${i + 1}.example -all` : 'v=spf1 -all'),
    );
  const ten = countLookups(chain(10), 0);
  expect(ten.total).toBe(10);
  expect(ten.stopped).toBe(false);
  expect(ten.lowerBound).toBe(false);
  const twelve = countLookups(chain(12), 0);
  expect(twelve.total).toBe(11);
  expect(twelve.stopped).toBe(true);
  expect(twelve.lowerBound).toBe(true);
  // A hundred records are read, but only as far as the count needs.
  const hundred = countLookups(chain(99), 0);
  expect(hundred.total).toBe(11);
  expect(hundred.rows.length).toBeLessThanOrEqual(12);

  // Names match without regard to letter case, and one trailing period is ignored on either side.
  const cased = countLookups(
    [rec(null, 'v=spf1 include:Spf.Example.NET -all'), rec('SPF.example.net.', 'v=spf1 mx -all')],
    0,
  );
  expect(cased.total).toBe(2);
  expect(cased.missing).toEqual([]);
  // The first record of a label wins when two share it.
  const twin = countLookups(
    [
      rec(null, 'v=spf1 include:t.example -all'),
      rec('t.example', 'v=spf1 mx -all'),
      rec('T.example', 'v=spf1 a mx -all'),
    ],
    0,
  );
  expect(twin.total).toBe(2);

  // A name with a macro cannot be followed without a message, so it is skipped and the total is a lower bound.
  const macro = countLookups(
    [rec(null, 'v=spf1 include:%{d}._spf.example.net -all'), rec('x.example', 'v=spf1 mx -all')],
    0,
  );
  expect(macro.total).toBe(1);
  expect(macro.lowerBound).toBe(true);
  expect(macro.skipped.length).toBe(1);
  expect(macro.missing).toEqual([]);

  // redirect is followed when the record has no all, and is neither counted nor followed beside an all (RFC 7208 section 6.1).
  const redirected = countLookups(
    [rec(null, 'v=spf1 mx redirect=_spf.example.net'), rec('_spf.example.net', 'v=spf1 a -all')],
    0,
  );
  expect(redirected.total).toBe(3);
  expect(redirected.rows[1]?.reachedFrom).toBe('redirect=_spf.example.net');
  const ignored = countLookups(
    [rec(null, 'v=spf1 redirect=_spf.example.net -all'), rec('_spf.example.net', 'v=spf1 a mx -all')],
    0,
  );
  expect(ignored.total).toBe(0);
  expect(ignored.rows.length).toBe(1);

  // A record reached twice by different routes is evaluated twice, so it counts twice but is listed once.
  const diamond = countLookups(
    [
      rec(null, 'v=spf1 include:x.example include:y.example -all'),
      rec('x.example', 'v=spf1 include:z.example -all'),
      rec('y.example', 'v=spf1 include:z.example -all'),
      rec('z.example', 'v=spf1 a -all'),
    ],
    0,
  );
  expect(diamond.total).toBe(6);
  expect(diamond.rows.map((r) => [r.label, r.times])).toEqual([
    ['(first record)', 1],
    ['x.example', 1],
    ['z.example', 2],
    ['y.example', 1],
  ]);

  // A record that is not an SPF record adds nothing and is said so; a record with a syntax error counts its other terms.
  const odd = countLookups(
    [
      rec(null, 'v=spf1 include:n.example include:s.example -all'),
      rec('n.example', 'hello'),
      rec('s.example', 'v=spf1 a include: mx'),
    ],
    0,
  );
  expect(odd.total).toBe(4);
  expect(odd.rows.map((r) => r.notes.length > 0)).toEqual([false, true, true]);

  // The same input gives the same answer however often it is counted, and the input is not changed.
  const input = [main, inner];
  const before = JSON.stringify(input);
  expect(countLookups(input, 0)).toStrictEqual(countLookups(input, 0));
  expect(JSON.stringify(input)).toBe(before);

  // The main record may be any of the records, and a main index with no record is refused naming the box.
  const second = countLookups([inner, main], 1);
  expect(second.total).toBe(3);
  const refused = (() => {
    try {
      countLookups([], 0);
      return null;
    } catch (err) {
      return err instanceof SpfDmarcError ? err : null;
    }
  })();
  expect(refused?.part).toBe('spf');
  expect(refused?.message).toContain('SPF box');

  // Records read from a box: a labelled line and a zone-file line both give their label.
  const read = readTxtRecords(
    'v=spf1 include:_spf.example.net -all\n_spf.example.net: v=spf1 a mx -all\nother.example. IN TXT "v=spf1 ip4:192.0.2.1 -all"',
  );
  expect(read.map((r) => [r.label, r.text])).toEqual([
    [null, 'v=spf1 include:_spf.example.net -all'],
    ['_spf.example.net', 'v=spf1 a mx -all'],
    ['other.example.', 'v=spf1 ip4:192.0.2.1 -all'],
  ]);
  expect(countLookups(read, 0).total).toBe(3);
});
