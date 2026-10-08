import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { EditorConfigError, compileGlob, matchGlob, newBudget } from '../src/index';
import { MAX_SCALING_RATIO, scalingRatio } from './scaling';

/**
 * Glob matching, tested directly. The expected answers come from the EditorConfig specification, version 0.17.2, table of
 * glob characters, and from the published core tests (editorconfig-core-test, commit 895b3a65), named next to each row; the
 * whole core suite is also run by core.test.ts. A glob here is the text between the brackets of a section header.
 */

const match = (name: string, path: string, folder = ''): boolean =>
  matchGlob(compileGlob(name, folder), path, newBudget());

/** Checks every row of one glob and reports the rows that are wrong by glob and path, so a failure names the row. */
function rows(name: string, yes: string[], no: string[]): string[] {
  const wrong: string[] = [];
  for (const path of yes) if (!match(name, path)) wrong.push(`${name} should match ${path}`);
  for (const path of no) if (match(name, path)) wrong.push(`${name} should not match ${path}`);
  return wrong;
}

it('star, double star, question mark, brackets, braces and number ranges match as the core tests require', () => {
  const wrong = [
    // Star: any string except a slash. Core tests star_single_ML, star_zero_ML, star_multiple_ML, star_over_slash.
    ...rows('a*e.c', ['ace.c', 'ae.c', 'abcde.c'], ['a/e.c']),
    // star_after_slash_ML, star_matches_dot_file_after_slash_ML, star_after_slash_ML_in_subdir; the last row follows the
    // specification (a star stops at a slash).
    ...rows('Bar/*', ['Bar/foo.txt', 'Bar/.editorconfig'], ['bat/Bar/foo.txt', 'Bar/x/y.txt']),
    // star_matches_dot_file and star_over_slash: a name with no slash matches at any level, dot files included.
    ...rows('*', ['.editorconfig', 'x', 'a/e.c', 'a/b/c.d'], []),
    // Double star: any string, slashes included. Core tests star_star_over_separator1 to 24.
    ...rows('a**z.c', ['a/z.c', 'amnz.c', 'am/nz.c', 'a/mnz.c', 'amn/z.c', 'a/mn/z.c'], ['b/z.c', 'c/z.c']),
    ...rows('b/**z.c', ['b/z.c', 'b/mnz.c', 'b/mn/z.c'], ['bmnz.c', 'bm/nz.c', 'bmn/z.c']),
    ...rows('c**/z.c', ['c/z.c', 'cmn/z.c', 'c/mn/z.c'], ['cmnz.c', 'cm/nz.c', 'c/mnz.c']),
    ...rows('d/**/z.c', ['d/z.c', 'd/mn/z.c'], ['dmnz.c', 'dm/nz.c', 'd/mnz.c', 'dmn/z.c']),
    // Question mark: one character except a slash. Core tests question_single, question_zero, question_multiple, question_slash.
    ...rows('som?.c', ['some.c'], ['som.c', 'something.c', 'som/.c']),
    // Brackets (glob/brackets.in): a choice, a negated choice, a range, a negated range, a range and a choice, a dash.
    ...rows('[ab].a', ['a.a', 'b.a'], ['c.a']),
    ...rows('[!ab].b', ['c.b'], ['a.b', 'b.b']),
    ...rows('[d-g].c', ['f.c', 'd.c', 'g.c'], ['h.c']),
    ...rows('[!d-g].d', ['h.d'], ['f.d']),
    ...rows('[abd-g].e', ['e.e', 'a.e', 'd.e'], ['c.e']),
    ...rows('[-ab].f', ['-.f', 'a.f'], ['c.f']),
    // A close bracket as the first member of a class, and after it (brackets_close_inside, _outside, _nclose_inside, _nclose_outside).
    ...rows('[\\]ab].g', ['].g', 'a.g'], ['c.g']),
    ...rows('[ab]].g', ['b].g'], ['b.g']),
    ...rows('[!\\]ab].g', ['c.g'], ['].g']),
    ...rows('[!ab]].g', ['c].g'], ['b].g']),
    // Braces (glob/braces.in): choices, nested choices, an escaped comma, an escaped brace, an escaped backslash.
    ...rows('*.{py,js,html}', ['test.py', 'test.js', 'test.html'], ['test.pyc']),
    ...rows('{word,{also},this}.g', ['word.g', '{also}.g', 'this.g'], ['word,this}.g', '{also,this}.g']),
    ...rows('{{a,b},c}.k', ['a.k', 'b.k', 'c.k'], ['{{a,b},c}.k', '{a,b}.k']),
    ...rows('{a,{b,c}}.l', ['a.l', 'b.l', 'c.l'], ['{a,{b,c}}.l', '{b,c}.l']),
    ...rows('{a\\,b,cd}.txt', ['a,b.txt', 'cd.txt'], ['a.txt']),
    ...rows('{e,\\},f}.txt', ['e.txt', '}.txt', 'f.txt'], []),
    ...rows('{g,\\\\,i}.txt', ['g.txt', '\\.txt', 'i.txt'], []),
    // Number ranges (braces_numeric_range1 to 8).
    ...rows('{3..120}', ['3', '15', '60', '120'], ['1', '5a', '121']),
    // A bracket class matches one character, a code point outside the basic plane included.
    ...rows('[a-' + String.fromCodePoint(0x1f600) + ']', ['a', String.fromCodePoint(0x1f600)], [' ']),
    ...rows(String.fromCodePoint(0x4e2d, 0x6587) + '.txt', [String.fromCodePoint(0x4e2d, 0x6587) + '.txt'], ['x.txt']),
  ];
  expect(wrong).toEqual([]);
});

it('a bracket pair holding a slash is literal and a middle double star matches zero directories', () => {
  // Core tests brackets_slash_inside1 to 3: in ab[e/]cd.i the [ is an ordinary character, the slash inside the pair is not a
  // path separator, and only the text itself matches. brackets_slash_inside4: ab[/c has no closing bracket before its slash.
  const wrong = [
    ...rows('ab[e/]cd.i', ['ab[e/]cd.i'], ['ab/cd.i', 'abecd.i']),
    ...rows('ab[/c', ['ab[/c'], ['abc', 'ab/c']),
    // The slash inside the pair is not a path separator, so the name still matches at any level below its file.
    ...rows('ab[e/]cd.i', ['x/y/ab[e/]cd.i'], []),
    // star_star_over_separator19 to 24: d/**/z.c matches d/z.c, with zero directories between.
    ...rows('d/**/z.c', ['d/z.c', 'd/m/z.c', 'd/m/n/z.c'], ['d/zz.c', 'dz.c']),
    // A double star between slashes anywhere in the name, and at the start of it.
    ...rows('a/**/b/**/c', ['a/b/c', 'a/x/b/c', 'a/b/y/c', 'a/x/y/b/z/w/c'], ['a/bc', 'a/b/cc']),
    ...rows('**/z.c', ['z.c', 'a/z.c', 'a/b/z.c'], ['zz.c']),
  ];
  expect(wrong).toEqual([]);
});

it('single item braces, empty braces and an unmatched brace are literal and an empty alternative is kept', () => {
  const wrong = [
    // braces_single_choice and _negative: {single} is the text {single}.
    ...rows('{single}.b', ['{single}.b'], ['single.b', '.b']),
    // braces_empty_choice and _negative: {} is the text {}.
    ...rows('{}.c', ['{}.c'], ['.c']),
    // braces_no_closing and _negative: a { with no } is the character {.
    ...rows('{.f', ['{.f'], ['.f']),
    // braces_closing_in_beginning: {} is literal and the rest is text.
    ...rows('{},b}.h', ['{},b}.h'], ['.h', 'b.h']),
    // braces_unmatched1 to 5: the two { with no } are text and {d} is a single item.
    ...rows('{{,b,c{d}.i', ['{{,b,c{d}.i'], ['{.i', 'b.i', 'c{d.i', '.i']),
    // braces_empty_word1 to 4 and braces_empty_words1 to 4: an empty alternative is kept.
    ...rows('a{b,c,}.d', ['a.d', 'ab.d', 'ac.d'], ['a,.d']),
    ...rows('a{,b,,c,}.e', ['a.e', 'ab.e', 'ac.e'], ['a,.e']),
    // The empty alternative also works at the start and with a slash next to it.
    ...rows('{,x}/a', ['/a', 'x/a'], ['a', 'y/a']),
  ];
  expect(wrong).toEqual([]);
});

it('number ranges match integers without leading zeros and a range whose ends are equal or reversed is literal', () => {
  // braces_numeric_range1 to 8: {3..120} matches 3, 15, 60 and 120 and not 1, 5a, 121 or 060.
  const wrong = [
    ...rows(
      '{3..120}',
      ['3', '4', '9', '10', '99', '100', '119', '120'],
      ['1', '2', '5a', '121', '1200', '060', '03', '0', '-3'],
    ),
    // Negative and signed ends. The specification only requires num1 to be less than num2 and says nothing of a sign.
    ...rows('{-5..5}', ['-5', '-1', '0', '1', '5'], ['-6', '6', '05', '00']),
    ...rows('f{1..3}.txt', ['f1.txt', 'f2.txt', 'f3.txt'], ['f0.txt', 'f4.txt', 'f01.txt', 'f.txt']),
    // Specification: "num1 is required to be less than num2". Equal or reversed ends are the text itself
    // (braces_alpha_range1 to 6 show the same for ends that are not numbers).
    ...rows('{3..3}', ['{3..3}'], ['3']),
    ...rows('{5..1}', ['{5..1}'], ['1', '3', '5']),
    ...rows('{aardvark..antelope}', ['{aardvark..antelope}'], ['a', 'aardvark', 'agreement', 'antelope', 'antimatter']),
    // An end of nine digits is read; one of ten digits is refused.
    ...rows('{1..999999999}', ['1', '999999999'], ['1000000000']),
  ];
  expect(wrong).toEqual([]);
  expect(() => compileGlob('{1..1234567890}')).toThrow(EditorConfigError);
  expect(() => compileGlob('{-1234567890..5}')).toThrow(/more than 9 digits/);
  // The folder form matches the whole path from the top folder, the relative form matches from the file's folder.
  expect(match('*.js', 'src/a.js')).toBe(true);
  expect(matchGlob(compileGlob('*.js', 'src'), 'src/lib/a.js', newBudget())).toBe(true);
  expect(matchGlob(compileGlob('*.js', 'src'), 'lib/a.js', newBudget())).toBe(false);
  expect(matchGlob(compileGlob('lib/a.js', 'src'), 'src/lib/a.js', newBudget())).toBe(true);
  expect(matchGlob(compileGlob('/a.js', 'src'), 'src/a.js', newBudget())).toBe(true);
  expect(matchGlob(compileGlob('/a.js', 'src'), 'src/lib/a.js', newBudget())).toBe(false);
});

it('the matcher builds no regular expression and stays linear on 300 stars against a 4,000 character path', () => {
  // Nothing in the package source may name or build a regular expression (the glob is matched by an instruction list).
  const dir = new URL('../src/', import.meta.url);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts')) continue;
    const text = readFileSync(new URL(name, dir), 'utf8');
    expect(/RegExp/.test(text), `${name} must not name RegExp`).toBe(false);
  }

  // And at run time: compiling and matching the hostile globs constructs no RegExp object.
  const original = globalThis.RegExp;
  let built = 0;
  globalThis.RegExp = new Proxy(original, {
    construct(target, args, newTarget) {
      built += 1;
      return Reflect.construct(target, args, newTarget);
    },
  });
  try {
    // Hostile globs and what each one means for a path of 4,000 letters: 300 stars match any run of non-slash characters.
    const hostile: Array<[string, boolean]> = [
      ['*a'.repeat(300) + 'b', false],
      ['*'.repeat(300), true],
      ['{a,b}'.repeat(150), false],
      ['**/'.repeat(300) + 'x', false],
      ['[ab]*'.repeat(150), true],
      ['{a,b}'.repeat(150) + '*', true],
    ];
    for (const [glob, expected] of hostile) {
      const program = compileGlob(glob);
      expect(matchGlob(program, 'a'.repeat(4000), newBudget()), glob.slice(0, 12)).toBe(expected);
    }
  } finally {
    globalThis.RegExp = original;
  }
  expect(built).toBe(0);

  // 300 stars against a path of 4,000 characters: the answer comes back (a regular expression took 23 seconds for 6 stars on
  // 100 characters). Time doubling the path from 2,000 to 4,000 characters, and quadrupling it from 1,000, as the other
  // linear checks of this phase do (a doubling ratio alone does not see quadratic growth).
  const median = (values: number[]): number => [...values].sort((x, y) => x - y)[1] as number;
  const programs = [
    '*a'.repeat(300) + 'b',
    '*'.repeat(300) + 'b',
    '**/*'.repeat(150) + 'b',
    '{a,b}'.repeat(150) + 'b',
  ].map((glob) => compileGlob(glob));
  const paths: Array<(n: number) => string> = [
    (n) => 'a'.repeat(n),
    (n) => 'a/'.repeat(Math.floor(n / 2)),
    (n) => 'ab'.repeat(Math.floor(n / 2)),
  ];
  for (const program of programs) {
    for (const make of paths) {
      const run = (path: string): unknown => matchGlob(program, path, newBudget());
      const doublings: number[] = [];
      const fourfold: number[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const first = scalingRatio(run, make, 1000);
        const second = scalingRatio(run, make, 2000);
        doublings.push(second);
        fourfold.push(first * second);
      }
      expect(median(doublings)).toBeLessThanOrEqual(MAX_SCALING_RATIO);
      expect(median(fourfold)).toBeLessThanOrEqual(12);
    }
  }
}, 300_000);
