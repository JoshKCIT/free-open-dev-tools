import { describe, it, expect } from 'vitest';
import { diffSequences, diffText, unifiedDiff, sideBySide, invisibleDifferences } from '../src/index';

const render = (a: string, b: string, options = {}) =>
  diffText(a, b, options).changes.map((c) => `${c.op[0]}:${c.values.join('|')}`);

describe('the diff algorithm', () => {
  it('reports nothing for identical input', () => {
    expect(diffSequences(['a', 'b'], ['a', 'b'])).toEqual([{ op: 'equal', values: ['a', 'b'] }]);
  });

  it('handles an empty left side', () => {
    expect(diffSequences([], ['a', 'b'])).toEqual([{ op: 'insert', values: ['a', 'b'] }]);
  });

  it('handles an empty right side', () => {
    expect(diffSequences(['a', 'b'], [])).toEqual([{ op: 'delete', values: ['a', 'b'] }]);
  });

  it('handles both sides empty', () => {
    expect(diffSequences([], [])).toEqual([]);
  });

  it('finds a single insertion in the middle', () => {
    expect(diffSequences(['a', 'c'], ['a', 'b', 'c'])).toEqual([
      { op: 'equal', values: ['a'] },
      { op: 'insert', values: ['b'] },
      { op: 'equal', values: ['c'] },
    ]);
  });

  it('finds a single deletion in the middle', () => {
    expect(diffSequences(['a', 'b', 'c'], ['a', 'c'])).toEqual([
      { op: 'equal', values: ['a'] },
      { op: 'delete', values: ['b'] },
      { op: 'equal', values: ['c'] },
    ]);
  });

  it('finds the longest common subsequence rather than the first match', () => {
    // The textbook Myers example. A naive algorithm produces a longer script.
    const a = ['A', 'B', 'C', 'A', 'B', 'B', 'A'];
    const b = ['C', 'B', 'A', 'B', 'A', 'C'];
    const changes = diffSequences(a, b);
    const kept = changes.filter((c) => c.op === 'equal').reduce((n, c) => n + c.values.length, 0);
    // The longest common subsequence of these two has length 4.
    expect(kept).toBe(4);
  });

  it('applying the edit script reproduces the right side exactly', () => {
    const cases: [string[], string[]][] = [
      [
        ['a', 'b', 'c'],
        ['a', 'x', 'c'],
      ],
      [[], ['a']],
      [['a'], []],
      [
        ['a', 'a', 'a'],
        ['a', 'a'],
      ],
      [['x'], ['y']],
      [
        ['1', '2', '3', '4', '5'],
        ['5', '4', '3', '2', '1'],
      ],
    ];
    for (const [a, b] of cases) {
      const rebuilt = diffSequences(a, b)
        .filter((c) => c.op !== 'delete')
        .flatMap((c) => c.values);
      expect(rebuilt, `${a} -> ${b}`).toEqual(b);
    }
  });

  it('reversing the inputs swaps which values are added and removed', () => {
    // The operation order does not flip: Myers emits deletions before
    // insertions in both directions, which is what git does too. What swaps is
    // which side each value lands on.
    const forward = diffSequences(['a', 'b'], ['a', 'c']);
    const back = diffSequences(['a', 'c'], ['a', 'b']);

    const removed = (changes: typeof forward) => changes.filter((c) => c.op === 'delete').flatMap((c) => c.values);
    const added = (changes: typeof forward) => changes.filter((c) => c.op === 'insert').flatMap((c) => c.values);

    expect(removed(forward)).toEqual(added(back));
    expect(added(forward)).toEqual(removed(back));
  });

  it('handles a large input in reasonable time', () => {
    const a = Array.from({ length: 4000 }, (_, i) => `line ${i}`);
    const b = [...a];
    b[2000] = 'changed';
    const started = Date.now();
    const changes = diffSequences(a, b);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(changes.filter((c) => c.op !== 'equal')).toHaveLength(2);
  });
});

describe('line diffs', () => {
  it('detects a changed line', () => {
    expect(render('a\nb\nc', 'a\nX\nc')).toEqual(['e:a', 'd:b', 'i:X', 'e:c']);
  });

  it('counts added, removed and unchanged', () => {
    const r = diffText('a\nb\nc', 'a\nX\nc\nd');
    expect(r.stats.added).toBe(2);
    expect(r.stats.removed).toBe(1);
    expect(r.stats.unchanged).toBe(2);
  });

  it('reports identical input as identical', () => {
    const r = diffText('same', 'same');
    expect(r.identical).toBe(true);
    expect(r.stats.similarity).toBe(1);
  });

  it('normalises line endings by default', () => {
    expect(diffText('a\r\nb', 'a\nb').identical).toBe(true);
  });

  it('can be told not to normalise line endings', () => {
    expect(diffText('a\r\nb', 'a\nb', { normaliseLineEndings: false }).identical).toBe(false);
  });

  it('flags a difference that is invisible on screen', () => {
    const r = diffText('a\r\nb', 'a\nb');
    expect(r.invisibleDifferenceOnly).toBe(true);
  });
});

describe('diff options', () => {
  it('ignores case when asked', () => {
    expect(diffText('Hello', 'hello').identical).toBe(false);
    expect(diffText('Hello', 'hello', { ignoreCase: true }).identical).toBe(true);
  });

  it('ignores whitespace when asked', () => {
    expect(diffText('a  b', 'a b', { ignoreWhitespace: true }).identical).toBe(true);
    expect(diffText('  a  ', 'a', { ignoreWhitespace: true }).identical).toBe(true);
  });

  it('can compare lines regardless of their order', () => {
    expect(diffText('b\na\nc', 'a\nb\nc', { sortLines: true }).identical).toBe(true);
    expect(diffText('b\na\nc', 'a\nb\nc').identical).toBe(false);
  });

  it('diffs by word', () => {
    const r = diffText('the quick brown fox', 'the slow brown fox', { granularity: 'word' });
    expect(r.stats.added).toBe(1);
    expect(r.stats.removed).toBe(1);
  });

  it('diffs by character', () => {
    const r = diffText('kitten', 'sitting', { granularity: 'character' });
    expect(r.stats.added).toBeGreaterThan(0);
    expect(r.stats.unchanged).toBe(4);
  });

  it('treats an astral character as one unit in character mode', () => {
    // Splitting a surrogate pair would produce nonsense.
    const r = diffText('a👋b', 'a👋c', { granularity: 'character' });
    expect(r.stats.unchanged).toBe(2);
  });
});

describe('unified diff format', () => {
  it('produces nothing when the inputs match', () => {
    expect(unifiedDiff('same', 'same')).toBe('');
  });

  it('produces a header and a hunk', () => {
    const out = unifiedDiff('a\nb\nc', 'a\nX\nc');
    expect(out.split('\n')[0]).toBe('--- a');
    expect(out.split('\n')[1]).toBe('+++ b');
    expect(out).toContain('@@ -1,3 +1,3 @@');
    expect(out).toContain('-b');
    expect(out).toContain('+X');
  });

  it('uses the file names it is given', () => {
    const out = unifiedDiff('a', 'b', { fromFile: 'old.txt', toFile: 'new.txt' });
    expect(out).toContain('--- old.txt');
    expect(out).toContain('+++ new.txt');
  });

  it('limits context to the requested number of lines', () => {
    const a = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const b = a.replace('line 10', 'CHANGED');
    const tight = unifiedDiff(a, b, { context: 1 });
    const loose = unifiedDiff(a, b, { context: 5 });
    expect(tight.split('\n').length).toBeLessThan(loose.split('\n').length);
    expect(tight).toContain('-line 10');
    expect(tight).toContain('+CHANGED');
    expect(tight).toContain(' line 9');
    expect(tight).not.toContain(' line 8');
  });

  it('produces separate hunks for changes that are far apart', () => {
    const a = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const b = a.replace('line 2', 'A').replace('line 35', 'B');
    const out = unifiedDiff(a, b, { context: 2 });
    expect(out.match(/^@@/gm)).toHaveLength(2);
  });

  it('handles an addition at the very start and the very end', () => {
    expect(unifiedDiff('b', 'a\nb')).toContain('+a');
    expect(unifiedDiff('a', 'a\nb')).toContain('+b');
  });
});

describe('side by side view', () => {
  it('pairs a replaced line into one row', () => {
    const rows = sideBySide('a\nb\nc', 'a\nX\nc');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ left: 'b', right: 'X', op: 'changed' });
  });

  it('numbers each side independently', () => {
    const rows = sideBySide('a\nb', 'a\nb\nc');
    expect(rows[2]).toMatchObject({ right: 'c', rightNumber: 3, op: 'insert' });
    expect(rows[2]!.leftNumber).toBeUndefined();
  });

  it('leaves a gap on the side that has no line', () => {
    const rows = sideBySide('a\nb\nc', 'a\nc');
    const deleted = rows.find((r) => r.op === 'delete');
    expect(deleted?.left).toBe('b');
    expect(deleted?.right).toBeUndefined();
  });
});

describe('invisible differences', () => {
  it('names a line ending mismatch', () => {
    expect(invisibleDifferences('a\r\nb', 'a\nb').join(' ')).toMatch(/Line endings differ/);
  });

  it('names trailing whitespace', () => {
    expect(invisibleDifferences('a  \nb', 'a\nb').join(' ')).toMatch(/trailing whitespace/);
  });

  it('names a missing final newline', () => {
    expect(invisibleDifferences('a\n', 'a').join(' ')).toMatch(/ends with a newline/);
  });

  it('names a byte order mark', () => {
    expect(invisibleDifferences('﻿a', 'a').join(' ')).toMatch(/byte order mark/);
  });

  it('names zero-width characters', () => {
    expect(invisibleDifferences('a​b', 'ab').join(' ')).toMatch(/zero-width/);
  });

  it('names a Unicode normalisation difference', () => {
    // The same e-acute, composed and decomposed. Visually identical.
    const composed = 'café';
    const decomposed = 'café';
    expect(composed).not.toBe(decomposed);
    expect(invisibleDifferences(composed, decomposed).join(' ')).toMatch(/normal forms/);
  });

  it('says nothing when the texts genuinely match', () => {
    expect(invisibleDifferences('a\nb', 'a\nb')).toEqual([]);
  });
});
