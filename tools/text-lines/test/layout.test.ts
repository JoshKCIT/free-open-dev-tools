/**
 * Tab conversion, word wrap and IP ordering for the Line Toolkit.
 *
 * Expected values come from programs that are not this package, run on 2026-10-02 and pasted below as literals:
 * GNU coreutils 8.32 `expand`, `unexpand` and `fold` (Git Bash on Windows), and Python 3.14.3's `ipaddress` module
 * (its parsing decides what is an address; the order is the sort key `(version, int(address), prefix length)`, with a
 * bare address taking the prefix length of a single host, as `ip_interface` reports it). The programs are byte based,
 * so the lines given to them are ASCII; this package counts code points, and a test below says so.
 *
 * Other specifications: RFC 791 (the dotted-quad form), RFC 4291 section 2.2 (the text forms of an IPv6 address,
 * including :: and a trailing IPv4 address) and RFC 5952 (the same address may be written many ways, so order is by
 * value and not by spelling).
 */
import { test, expect } from 'vitest';
import { processLines, OPERATIONS, ALL_OPERATIONS } from '../src/index';
import { expandTabs, unexpandTabs, wrapLines, parseIp, compareIp } from '../src/layout';

/** `expand -t 4` run over each input (GNU coreutils 8.32, Git Bash, 2026-10-02). */
const EXPAND_4: [string, string][] = [
  ['a\tb', 'a   b'],
  ['\tx', '    x'],
  ['abcd\te', 'abcd    e'],
  ['ab\t\tc', 'ab      c'],
  ['   \tx', '    x'],
  ['x\t', 'x   '],
  ['\t\t', '        '],
  ['a\tb\tc\td', 'a   b   c   d'],
  ['abc\td', 'abc d'],
  ['', ''],
  ['no tabs here', 'no tabs here'],
  ['abcdefg\th', 'abcdefg h'],
  ['12345678\tx', '12345678    x'],
  ['\t \tx', '        x'],
  ['abc\b\tx', 'abc\b  x'],
  ['\b\tx', '\b    x'],
  ['ab\b\b\b\tc', 'ab\b\b\b    c'],
  ['a\b', 'a\b'],
  ['abc\bd\te', 'abc\bd e'],
];

/** `expand -t 8` run over each input (GNU coreutils 8.32, Git Bash, 2026-10-02). */
const EXPAND_8: [string, string][] = [
  ['a\tb', 'a       b'],
  ['\tx', '        x'],
  ['abcd\te', 'abcd    e'],
  ['ab\t\tc', 'ab              c'],
  ['   \tx', '        x'],
  ['x\t', 'x       '],
  ['\t\t', '                '],
  ['a\tb\tc\td', 'a       b       c       d'],
  ['abc\td', 'abc     d'],
  ['', ''],
  ['no tabs here', 'no tabs here'],
  ['abcdefg\th', 'abcdefg h'],
  ['12345678\tx', '12345678        x'],
  ['\t \tx', '                x'],
  ['abc\b\tx', 'abc\b      x'],
  ['\b\tx', '\b        x'],
  ['ab\b\b\b\tc', 'ab\b\b\b        c'],
  ['a\b', 'a\b'],
  ['abc\bd\te', 'abc\bd     e'],
];

/** `expand -t 3` run over each input (GNU coreutils 8.32, Git Bash, 2026-10-02). */
const EXPAND_3: [string, string][] = [
  ['a\tb', 'a  b'],
  ['\tx', '   x'],
  ['abcd\te', 'abcd  e'],
  ['ab\t\tc', 'ab    c'],
  ['   \tx', '      x'],
  ['x\t', 'x  '],
  ['\t\t', '      '],
  ['a\tb\tc\td', 'a  b  c  d'],
  ['abc\td', 'abc   d'],
  ['', ''],
  ['no tabs here', 'no tabs here'],
  ['abcdefg\th', 'abcdefg  h'],
  ['12345678\tx', '12345678 x'],
  ['\t \tx', '      x'],
  ['abc\b\tx', 'abc\b x'],
  ['\b\tx', '\b   x'],
  ['ab\b\b\b\tc', 'ab\b\b\b   c'],
  ['a\b', 'a\b'],
  ['abc\bd\te', 'abc\bd   e'],
];

/** `unexpand -t 4 --first-only` run over each input (GNU coreutils 8.32, Git Bash, 2026-10-02). */
const UNEXPAND_4_FIRST: [string, string][] = [
  ['a   b', 'a   b'],
  ['    x', '\tx'],
  ['        x', '\t\tx'],
  ['      x', '\t  x'],
  ['abc d', 'abc d'],
  ['abc  d', 'abc  d'],
  ['ab  cd', 'ab  cd'],
  ['x    y', 'x    y'],
  ['  \t x', '\t x'],
  ['a\t  b', 'a\t  b'],
  ['    a    b', '\ta    b'],
  ['', ''],
  ['   ', '   '],
  ['abcd    ', 'abcd    '],
  ['  ', '  '],
  ['     ', '\t '],
  ['a  b  c', 'a  b  c'],
  ['   a   b', '   a   b'],
  [' \t', '\t'],
  ['abc   d', 'abc   d'],
  ['ab      cd', 'ab      cd'],
  ['\t  x', '\t  x'],
  ['word     word', 'word     word'],
  ['       x', '\t   x'],
  ['abc \tx', 'abc \tx'],
  ['abc  \tx', 'abc  \tx'],
  ['a \tb', 'a \tb'],
  ['ab\b    c', 'ab\b    c'],
  ['abc\b d', 'abc\b d'],
  ['   \b    x', '   \b    x'],
  ['abcdefg   \tx', 'abcdefg   \tx'],
];

/** `unexpand -t 4 (all runs)` run over each input (GNU coreutils 8.32, Git Bash, 2026-10-02). */
const UNEXPAND_4_ALL: [string, string][] = [
  ['a   b', 'a\tb'],
  ['    x', '\tx'],
  ['        x', '\t\tx'],
  ['      x', '\t  x'],
  ['abc d', 'abc d'],
  ['abc  d', 'abc\t d'],
  ['ab  cd', 'ab\tcd'],
  ['x    y', 'x\t y'],
  ['  \t x', '\t x'],
  ['a\t  b', 'a\t  b'],
  ['    a    b', '\ta\t b'],
  ['', ''],
  ['   ', '   '],
  ['abcd    ', 'abcd\t'],
  ['  ', '  '],
  ['     ', '\t '],
  ['a  b  c', 'a  b  c'],
  ['   a   b', '   a   b'],
  [' \t', '\t'],
  ['abc   d', 'abc\t  d'],
  ['ab      cd', 'ab\t\tcd'],
  ['\t  x', '\t  x'],
  ['word     word', 'word\t word'],
  ['       x', '\t   x'],
  ['abc \tx', 'abc\t\tx'],
  ['abc  \tx', 'abc\t\tx'],
  ['a \tb', 'a\tb'],
  ['ab\b    c', 'ab\b\t c'],
  ['abc\b d', 'abc\b d'],
  ['   \b    x', '   \b\t  x'],
  ['abcdefg   \tx', 'abcdefg\t\tx'],
];

/** `unexpand -t 8 --first-only` run over each input (GNU coreutils 8.32, Git Bash, 2026-10-02). */
const UNEXPAND_8_FIRST: [string, string][] = [
  ['a   b', 'a   b'],
  ['    x', '    x'],
  ['        x', '\tx'],
  ['      x', '      x'],
  ['abc d', 'abc d'],
  ['abc  d', 'abc  d'],
  ['ab  cd', 'ab  cd'],
  ['x    y', 'x    y'],
  ['  \t x', '\t x'],
  ['a\t  b', 'a\t  b'],
  ['    a    b', '    a    b'],
  ['', ''],
  ['   ', '   '],
  ['abcd    ', 'abcd    '],
  ['  ', '  '],
  ['     ', '     '],
  ['a  b  c', 'a  b  c'],
  ['   a   b', '   a   b'],
  [' \t', '\t'],
  ['abc   d', 'abc   d'],
  ['ab      cd', 'ab      cd'],
  ['\t  x', '\t  x'],
  ['word     word', 'word     word'],
  ['       x', '       x'],
  ['abc \tx', 'abc \tx'],
  ['abc  \tx', 'abc  \tx'],
  ['a \tb', 'a \tb'],
  ['ab\b    c', 'ab\b    c'],
  ['abc\b d', 'abc\b d'],
  ['   \b    x', '   \b    x'],
  ['abcdefg   \tx', 'abcdefg   \tx'],
];

/** `unexpand -t 8 (all runs)` run over each input (GNU coreutils 8.32, Git Bash, 2026-10-02). */
const UNEXPAND_8_ALL: [string, string][] = [
  ['a   b', 'a   b'],
  ['    x', '    x'],
  ['        x', '\tx'],
  ['      x', '      x'],
  ['abc d', 'abc d'],
  ['abc  d', 'abc  d'],
  ['ab  cd', 'ab  cd'],
  ['x    y', 'x    y'],
  ['  \t x', '\t x'],
  ['a\t  b', 'a\t  b'],
  ['    a    b', '    a\t b'],
  ['', ''],
  ['   ', '   '],
  ['abcd    ', 'abcd\t'],
  ['  ', '  '],
  ['     ', '     '],
  ['a  b  c', 'a  b  c'],
  ['   a   b', '   a   b'],
  [' \t', '\t'],
  ['abc   d', 'abc   d'],
  ['ab      cd', 'ab\tcd'],
  ['\t  x', '\t  x'],
  ['word     word', 'word\t word'],
  ['       x', '       x'],
  ['abc \tx', 'abc\tx'],
  ['abc  \tx', 'abc\tx'],
  ['a \tb', 'a\tb'],
  ['ab\b    c', 'ab\b    c'],
  ['abc\b d', 'abc\b d'],
  ['   \b    x', '   \b    x'],
  ['abcdefg   \tx', 'abcdefg\t\tx'],
];

/** `fold -s -w 10` run over each input (GNU coreutils 8.32, Git Bash, 2026-10-02). */
const FOLD_10: [string, string[]][] = [
  ['the quick brown fox jumps', ['the quick ', 'brown fox ', 'jumps']],
  ['aaa bbb ccc ddd eee fff ggg', ['aaa bbb ', 'ccc ddd ', 'eee fff ', 'ggg']],
  [
    'one two three four five six seven eight nine ten',
    ['one two ', 'three ', 'four five ', 'six seven ', 'eight ', 'nine ten'],
  ],
  ['short', ['short']],
  ['', ['']],
  ['abcd efgh ijkl mnop', ['abcd efgh ', 'ijkl mnop']],
  ['a b c d e f g h i j k l m n o p', ['a b c d e ', 'f g h i j ', 'k l m n o ', 'p']],
];

/** `fold -s -w 7` run over each input (GNU coreutils 8.32, Git Bash, 2026-10-02). */
const FOLD_7: [string, string[]][] = [
  ['the quick brown fox jumps', ['the ', 'quick ', 'brown ', 'fox ', 'jumps']],
  ['aaa bbb ccc ddd eee fff ggg', ['aaa ', 'bbb ', 'ccc ', 'ddd ', 'eee ', 'fff ggg']],
  [
    'one two three four five six seven eight nine ten',
    ['one ', 'two ', 'three ', 'four ', 'five ', 'six ', 'seven ', 'eight ', 'nine ', 'ten'],
  ],
  ['short', ['short']],
  ['', ['']],
  ['abcd efgh ijkl mnop', ['abcd ', 'efgh ', 'ijkl ', 'mnop']],
  ['a b c d e f g h i j k l m n o p', ['a b c ', 'd e f ', 'g h i ', 'j k l ', 'm n o p']],
];

/** `fold -s -w 20` run over each input (GNU coreutils 8.32, Git Bash, 2026-10-02). */
const FOLD_20: [string, string[]][] = [
  ['the quick brown fox jumps', ['the quick brown fox ', 'jumps']],
  ['aaa bbb ccc ddd eee fff ggg', ['aaa bbb ccc ddd eee ', 'fff ggg']],
  ['one two three four five six seven eight nine ten', ['one two three four ', 'five six seven ', 'eight nine ten']],
  ['short', ['short']],
  ['', ['']],
  ['abcd efgh ijkl mnop', ['abcd efgh ijkl mnop']],
  ['a b c d e f g h i j k l m n o p', ['a b c d e f g h i j ', 'k l m n o p']],
];

// Fold -s -w W on a long word breaks it at exactly W, which is what Break long words does; fold keeps the space at a
// break, and this tool drops it.
const FOLD_LONG: [string, number, string[]][] = [
  ['abcdefghijkl', 10, ['abcdefghij', 'kl']],
  ['ab abcdefghijkl cd', 10, ['ab ', 'abcdefghij', 'kl cd']],
  ['abcdefghijk lm', 10, ['abcdefghij', 'k lm']],
  ['xx abcdefghijklmnopqrstuvwxyz yy', 10, ['xx ', 'abcdefghij', 'klmnopqrst', 'uvwxyz yy']],
  ['aaaa bbbbb', 5, ['aaaa ', 'bbbbb']],
  ['aaaa bbbbbb', 5, ['aaaa ', 'bbbbb', 'b']],
];

// Lines (by their index in the fold tables) whose break differs from fold's for the reason the page states: fold
// counts the space at a break inside the width, so it breaks one word earlier whenever a line would be exactly as
// wide as the width before that space. This tool lets such a line be exactly the width.
const FOLD_EXACT_FIT = new Set(['10:2', '7:1', '7:2', '7:6', '20:2']);

const stripEnd = (lines: string[]): string[] => lines.map((line) => line.replace(/ +$/, ''));
const text = (lines: string[]): string => lines.join('\n');

test('tabs expand to the next tab stop as GNU expand prints for the same lines', () => {
  for (const [width, table] of [
    [4, EXPAND_4],
    [8, EXPAND_8],
    [3, EXPAND_3],
  ] as const) {
    // One line at a time and all lines at once give what the program printed, line for line.
    for (const [input, printed] of table)
      expect(expandTabs(input, width), `-t ${width} ${JSON.stringify(input)}`).toBe(printed);
    expect(expandTabs(text(table.map(([input]) => input)), width)).toBe(text(table.map(([, printed]) => printed)));
  }

  // A tab exactly at a tab stop expands to the full tab width (the second line of this table), and a tab is never
  // less than one space.
  expect(expandTabs('abcd\te', 4)).toBe('abcd    e');
  expect(expandTabs('abc\td', 4)).toBe('abc d');
  expect(expandTabs('x\t', 1)).toBe('x ');
  expect(expandTabs('a\tb', 16)).toBe('a' + ' '.repeat(15) + 'b');
  // Every character counts one column, whatever it is; a code point outside the basic plane is one column.
  expect(expandTabs('😀\tx', 4)).toBe('😀   x');
  // Other line endings are read as line breaks, and the output uses line feeds.
  expect(expandTabs('a\tb\r\nc\td\re\tf', 4)).toBe('a   b\nc   d\ne   f');
});

test('leading spaces become tabs as GNU unexpand prints, and inner runs only when asked', () => {
  // `unexpand -t N --first-only` converts only the run of blanks at the start of the line: that is the default here.
  for (const [width, first, all] of [
    [4, UNEXPAND_4_FIRST, UNEXPAND_4_ALL],
    [8, UNEXPAND_8_FIRST, UNEXPAND_8_ALL],
  ] as const) {
    for (const [input, printed] of first) {
      expect(unexpandTabs(input, width, false), `-t ${width} --first-only ${JSON.stringify(input)}`).toBe(printed);
    }
    // `unexpand -t N` converts every run, which is the All runs option.
    for (const [input, printed] of all) {
      expect(unexpandTabs(input, width, true), `-t ${width} ${JSON.stringify(input)}`).toBe(printed);
    }
    expect(unexpandTabs(text(first.map(([input]) => input)), width, false)).toBe(
      text(first.map(([, printed]) => printed)),
    );
    expect(unexpandTabs(text(all.map(([input]) => input)), width, true)).toBe(text(all.map(([, printed]) => printed)));
  }

  // The two properties the manual states: four leading spaces are one tab at width 4, and a single space before a
  // tab stop is left alone ("abc d" keeps its space).
  expect(unexpandTabs('    x', 4, false)).toBe('\tx');
  expect(unexpandTabs('abc d', 4, true)).toBe('abc d');
  // Existing tabs and the spaces before them are read by their columns, so the result keeps every text column.
  expect(expandTabs(unexpandTabs('        deep   x    y', 4, true), 4)).toBe('        deep   x    y');
  expect(unexpandTabs('a\r\n    b\n  c', 4, false)).toBe('a\n\tb\n  c');
});

test('wrap breaks at spaces at the chosen width, keeps blank lines and leaves a long word whole unless asked', () => {
  // Worked by hand: "the quick" is 9 characters and adding " brown" makes 15, so the line breaks there.
  expect(wrapLines('the quick brown fox jumps', 10, false)).toBe('the quick\nbrown fox\njumps');
  // A line that fits is left exactly as it is, trailing spaces and all, and a blank line stays a blank line.
  expect(wrapLines('ab   ', 10, false)).toBe('ab   ');
  expect(wrapLines('a\n\nb\n   \nc', 1, false)).toBe('a\n\nb\n   \nc');
  // Adjacency: a word exactly as long as the width fits on a line of its own, and one character longer stays whole.
  expect(wrapLines('aaaa bbbbb', 5, false)).toBe('aaaa\nbbbbb');
  expect(wrapLines('aaaa bbbbbb', 5, false)).toBe('aaaa\nbbbbbb');
  expect(wrapLines('abcdefghijkl', 5, false)).toBe('abcdefghijkl');
  // With Break long words on, it splits at exactly the width: a word one longer gives one extra character, and the
  // rest of the line carries on after the last piece.
  expect(wrapLines('aaaa bbbbbb', 5, true)).toBe('aaaa\nbbbbb\nb');
  expect(wrapLines('abcdefghijkl', 5, true)).toBe('abcde\nfghij\nkl');
  expect(wrapLines('ab abcdefghijkl cd', 10, true)).toBe('ab\nabcdefghij\nkl cd');
  // A run of spaces is kept inside a line and dropped at a break, trailing spaces are dropped at a break, and the
  // indentation of the first line is kept and counts toward the width.
  expect(wrapLines('a   b', 5, false)).toBe('a   b');
  expect(wrapLines('a   b cccccc', 7, false)).toBe('a   b\ncccccc');
  expect(wrapLines('ab   ', 5, false)).toBe('ab   ');
  expect(wrapLines('a   b', 3, false)).toBe('a\nb');
  expect(wrapLines('aaa bbb  ', 5, false)).toBe('aaa\nbbb');
  expect(wrapLines('  ab cd ef', 6, false)).toBe('  ab\ncd ef');
  // The width counts code points, so an emoji is one and a wide East Asian character is one.
  expect(wrapLines('😀😀😀 x', 3, false)).toBe('😀😀😀\nx');
  expect(wrapLines('日本語 日本語', 3, false)).toBe('日本語\n日本語');
  // Four code points are four, though each emoji is two UTF-16 units: this line fits a width of 4 as it is.
  expect(wrapLines('😀😀 x', 4, false)).toBe('😀😀 x');
  expect(wrapLines('😀😀 x', 3, false)).toBe('😀😀\nx');
  // Width 1 puts every word on its own line; each line of the input is wrapped on its own and the line count says so.
  expect(wrapLines('a b c', 1, false)).toBe('a\nb\nc');
  const result = processLines('one two\nthree four five', 'wrap', { wrapWidth: 8 });
  expect(result.output).toBe('one two\nthree\nfour\nfive');
  expect(result.linesIn).toBe(2);
  expect(result.linesOut).toBe(4);
  // The page's default width is 80: a line of 79 characters is left as it is, and a longer one breaks after exactly 80.
  expect(processLines('x '.repeat(40).trim(), 'wrap').output).toBe('x '.repeat(40).trim());
  expect(processLines('ab '.repeat(30).trim(), 'wrap').output.split('\n')[0]!.length).toBe(80);
});

test('wrap differs from fold only in dropping the trailing space at a break', () => {
  const tables: [number, [string, string[]][]][] = [
    [10, FOLD_10],
    [7, FOLD_7],
    [20, FOLD_20],
  ];
  for (const [width, table] of tables) {
    table.forEach(([input, folded], index) => {
      const ours = wrapLines(input, width, false).split('\n');
      const label = `fold -s -w ${width} ${JSON.stringify(input)}`;
      if (FOLD_EXACT_FIT.has(`${width}:${index}`)) {
        // The one other difference, stated on the page: this tool lets a line be exactly the width. Every line of
        // both outputs is still no longer than the width once the break space is dropped.
        expect(ours, label).not.toEqual(stripEnd(folded));
        for (const line of [...ours, ...stripEnd(folded)]) expect(line.length, label).toBeLessThanOrEqual(width);
      } else {
        expect(ours, label).toEqual(stripEnd(folded));
      }
    });
  }
  // With Break long words on it cuts a long word at the width exactly as fold does.
  for (const [input, width, folded] of FOLD_LONG) {
    expect(wrapLines(input, width, true).split('\n'), `fold -s -w ${width} ${JSON.stringify(input)}`).toEqual(
      stripEnd(folded),
    );
  }
  // A line of exactly the width followed by more text: fold counts the space after it and breaks a word earlier.
  expect(wrapLines('aaa bbb ccc', 7, false)).toBe('aaa bbb\nccc');
});

// The research list, shuffled, and Python's `sorted(..., key=(version, int(address), prefix length))` over the
// addresses read by ipaddress.ip_interface (Python 3.14.3). A bare address has the prefix length of a single host.
const IP_SORTED = ['10.0.0.2', '10.0.0.10', '192.168.1.1', '::1', '2001:db8::1', '2001:db8::a'];
const IP_MIXED = [
  '10.0.0.1/24',
  '10.0.0.1',
  '10.0.0.1/8',
  '10.0.0.1/32',
  '::ffff:10.0.0.1',
  '::ffff:a00:1',
  '2001:DB8::1/64',
  '2001:db8::1',
  '1:2:3:4:5:6:7:8',
  '::',
  '0:0:0:0:0:0:0:0',
  '255.255.255.255',
  '0.0.0.0',
  '::ffff:0:0',
  '2001:db8::',
  '2001:db8::/32',
  '10.0.0.1/0',
  '2001:0db8:0000:0000:0000:0000:0000:0001',
];
// sorted(IP_MIXED, key=key): equal keys ('10.0.0.1' and '10.0.0.1/32', '::' and '0:0:0:0:0:0:0:0', the two spellings
// of ::ffff:10.0.0.1, and the two of 2001:db8::1) stay in the order they were given.
const IP_MIXED_SORTED = [
  '0.0.0.0',
  '10.0.0.1/0',
  '10.0.0.1/8',
  '10.0.0.1/24',
  '10.0.0.1',
  '10.0.0.1/32',
  '255.255.255.255',
  '::',
  '0:0:0:0:0:0:0:0',
  '::ffff:0:0',
  '::ffff:10.0.0.1',
  '::ffff:a00:1',
  '1:2:3:4:5:6:7:8',
  '2001:db8::/32',
  '2001:db8::',
  '2001:DB8::1/64',
  '2001:db8::1',
  '2001:0db8:0000:0000:0000:0000:0000:0001',
];
// What ipaddress.ip_interface accepts and refuses, for strings that are near misses (Python 3.14.3). White space around
// an address is the one place this tool is more lenient, and it is tested after this list.
const IP_VALID = ['1:2:3:4:5:6:7::', '1:2:3:4:5:6:1.2.3.4', '::1.2.3.4', '::1/01', '1:2:3:4:5:6:7:8/128', '1::'];
const IP_REFUSED = [
  '10.0.0.256',
  '10.0.0.01',
  '1.2.3',
  '1.2.3.4.5',
  'abc',
  '::g',
  '1::2::3',
  ':1:2:3:4:5:6:7',
  '1:2:3:4:5:6:7:8:9',
  '10.0.0.1/33',
  '2001:db8::/129',
  '1:2:3:4:5:6:7:8::',
  ':::',
  '1:2:3:4:5:6:7:1.2.3.4',
  '::ffff:1.2.3',
  '12345::1',
  '',
  '10.0.0.1/',
  '10.0.0.1/ 8',
  '10.0.0.-1',
  '+1.2.3.4',
  '1.2.3.4/+8',
  '0x7f.0.0.1',
  '1.2.3.04',
  '::1:',
  '1:2:3:4:5:6:7:8:',
];

test('sort as IP orders addresses as Python ipaddress does, keeps equal ones in input order and puts other lines after', () => {
  // Which strings are addresses is what Python's ipaddress says.
  for (const valid of IP_VALID) expect(parseIp(valid), valid).not.toBeNull();
  for (const refused of IP_REFUSED) expect(parseIp(refused), JSON.stringify(refused)).toBeNull();

  // The research list, reversed, comes back in Python's order: IPv4 before IPv6, then by address (10.0.0.2 before
  // 10.0.0.10, 2001:db8::1 before 2001:db8::a).
  const reversed = [...IP_SORTED].reverse();
  const sorted = processLines(text(reversed), 'sort', { order: 'ip' });
  expect(sorted.output.split('\n')).toEqual(IP_SORTED);
  expect(sorted.nonAddressLines).toBe(0);

  // Prefix lengths, spellings of one address, and equal keys in input order.
  expect(processLines(text(IP_MIXED), 'sort', { order: 'ip' }).output.split('\n')).toEqual(IP_MIXED_SORTED);

  // Lines that are not addresses follow, in their original order, wherever they were; the page is told how many.
  const noisy = ['10.0.0.10', 'not an address', '10.0.0.2', '', '10.0.0.256', '::1', 'comment # here', '10.0.0.1'];
  const result = processLines(text(noisy), 'sort', { order: 'ip' });
  expect(result.output.split('\n')).toEqual([
    '10.0.0.1',
    '10.0.0.2',
    '10.0.0.10',
    '::1',
    'not an address',
    '',
    '10.0.0.256',
    'comment # here',
  ]);
  expect(result.nonAddressLines).toBe(4);
  expect(result.linesIn).toBe(8);
  expect(result.linesOut).toBe(8);

  // White space around an address is ignored when deciding, and the line comes back as it was written.
  expect(processLines('  10.0.0.10\n10.0.0.2 \t', 'sort', { order: 'ip' }).output).toBe('10.0.0.2 \t\n  10.0.0.10');

  // Comparing two read addresses directly: version first, then the 128-bit value, then the prefix length.
  const a = parseIp('10.0.0.1/24')!;
  const b = parseIp('10.0.0.1/8')!;
  const v6 = parseIp('::')!;
  expect(compareIp(b, a)).toBeLessThan(0);
  expect(compareIp(a, b)).toBeGreaterThan(0);
  expect(compareIp(a, parseIp('10.0.0.1/24')!)).toBe(0);
  expect(compareIp(a, v6)).toBeLessThan(0);
  expect(compareIp(v6, a)).toBeGreaterThan(0);
  expect(compareIp(parseIp('::ffff:10.0.0.1')!, parseIp('::ffff:a00:1')!)).toBe(0);
  // The largest and smallest 128-bit values are compared exactly, not as doubles.
  expect(
    compareIp(parseIp('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')!, parseIp('ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe')!),
  ).toBeGreaterThan(0);
});

test('descending reverses only the address part', () => {
  const noisy = ['10.0.0.1', 'zzz', '10.0.0.10', 'aaa', '::1', '10.0.0.1/32', '10.0.0.2'];
  const result = processLines(text(noisy), 'sort', { order: 'ip', descending: true });
  // Python: sorted(addresses, key=key, reverse=True) keeps equal keys in input order ('10.0.0.1' before '10.0.0.1/32');
  // the lines that are not addresses are not reversed and still follow.
  expect(result.output.split('\n')).toEqual(['::1', '10.0.0.10', '10.0.0.2', '10.0.0.1', '10.0.0.1/32', 'zzz', 'aaa']);
  expect(result.nonAddressLines).toBe(2);
  // Python: sorted(IP_MIXED, key=key, reverse=True), which also keeps equal keys in the order they were given.
  expect(processLines(text(IP_MIXED), 'sort', { order: 'ip', descending: true }).output.split('\n')).toEqual([
    '2001:db8::1',
    '2001:0db8:0000:0000:0000:0000:0000:0001',
    '2001:DB8::1/64',
    '2001:db8::',
    '2001:db8::/32',
    '1:2:3:4:5:6:7:8',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '::ffff:0:0',
    '::',
    '0:0:0:0:0:0:0:0',
    '255.255.255.255',
    '10.0.0.1',
    '10.0.0.1/32',
    '10.0.0.1/24',
    '10.0.0.1/8',
    '10.0.0.1/0',
    '0.0.0.0',
  ]);
});

test('empty input gives empty output for every new operation', () => {
  for (const [operation, options] of [
    ['tabs-to-spaces', {}],
    ['spaces-to-tabs', {}],
    ['spaces-to-tabs', { allRuns: true }],
    ['wrap', {}],
    ['wrap', { breakLongWords: true, wrapWidth: 1 }],
    ['sort', { order: 'ip' }],
    ['sort', { order: 'ip', descending: true }],
  ] as const) {
    const result = processLines('', operation, options);
    expect(result.output, operation).toBe('');
    expect(result.linesIn, operation).toBe(0);
    expect(result.linesOut, operation).toBe(0);
  }
  expect(expandTabs('', 4)).toBe('');
  expect(unexpandTabs('', 4, true)).toBe('');
  expect(wrapLines('', 4, true)).toBe('');

  // Blank lines are kept by wrap and by tab conversion, in place.
  expect(processLines('a\t\n\n   \n\tb', 'tabs-to-spaces').output).toBe('a   \n\n   \n    b');
  expect(processLines('a\n\n   \nb', 'spaces-to-tabs').output).toBe('a\n\n   \nb');
  expect(processLines('one two three\n\n   \nfour five', 'wrap', { wrapWidth: 8 }).output).toBe(
    'one two\nthree\n\n   \nfour\nfive',
  );

  // Sorting as IP with no address lines keeps every line in its original order and says how many were not addresses.
  const none = processLines('b\na\n\nc', 'sort', { order: 'ip' });
  expect(none.output).toBe('b\na\n\nc');
  expect(none.nonAddressLines).toBe(4);
  const noneDescending = processLines('b\na\n\nc', 'sort', { order: 'ip', descending: true });
  expect(noneDescending.output).toBe('b\na\n\nc');

  // Widths outside the page's limits are refused naming the field, and never size anything.
  for (const bad of [0, -1, 17, 1.5, Number.NaN, -1e9, Infinity]) {
    expect(() => processLines('a', 'tabs-to-spaces', { tabWidth: bad }), `tab width ${bad}`).toThrow(/Tab width/);
    expect(() => processLines('a', 'spaces-to-tabs', { tabWidth: bad }), `tab width ${bad}`).toThrow(/Tab width/);
  }
  for (const bad of [0, -1, 1001, 2.5, Number.NaN, -1e9, Infinity]) {
    expect(() => processLines('a', 'wrap', { wrapWidth: bad }), `width ${bad}`).toThrow(/Width/);
  }
  expect(() => processLines('a', 'tabs-to-spaces', { tabWidth: 16 })).not.toThrow();
  expect(() => processLines('a', 'wrap', { wrapWidth: 1000 })).not.toThrow();
  // The defaults are the page's: tab width 4 and width 80.
  expect(processLines('a\tb', 'tabs-to-spaces').output).toBe('a   b');
  expect(processLines('    x', 'spaces-to-tabs').output).toBe('\tx');
});

test('OPERATIONS is unchanged and ALL_OPERATIONS adds the three new operations', () => {
  expect(OPERATIONS).toEqual([
    'sort',
    'dedupe',
    'shuffle',
    'number',
    'trim',
    'filter',
    'join',
    'split',
    'affix',
    'reverse',
  ]);
  expect(ALL_OPERATIONS).toEqual([...OPERATIONS, 'tabs-to-spaces', 'spaces-to-tabs', 'wrap']);
  expect(ALL_OPERATIONS.length).toBe(OPERATIONS.length + 3);
  // The All runs option reaches the conversion: only the leading run by default, every run when asked.
  expect(processLines('a   b', 'spaces-to-tabs').output).toBe('a   b');
  expect(processLines('a   b', 'spaces-to-tabs', { allRuns: true }).output).toBe('a\tb');
  // Every earlier operation still behaves as before when the new options are not given.
  expect(processLines('b\na', 'sort').output).toBe('a\nb');
  expect(processLines('a\nb', 'reverse').output).toBe('b\na');
  // The new operations go through the same entry point and keep the counts honest.
  const result = processLines('a\tb', 'tabs-to-spaces', { tabWidth: 8 });
  expect(result).toEqual({ output: 'a       b', linesIn: 1, linesOut: 1 });
  // An ordinary sort result has no address count: the result of the earlier operations is exactly as before.
  expect(processLines('b\na', 'sort')).toEqual({ output: 'a\nb', linesIn: 2, linesOut: 2 });
});
