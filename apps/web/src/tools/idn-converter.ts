import {
  FAMILY_WORDS,
  IdnConverterError,
  convertNames,
  meta,
  visible,
  type ConvertedName,
  type Direction,
  type ProfileId,
} from '@fodt/idn-converter';
import { defineTool, str, type OutputBlock, type ToolIssue, type ToolResult, type Values } from '../lib/tool-ui';

/** How many names the table shows; the counts above it and the converted list cover every pasted name. */
const MAX_ROWS_SHOWN = 1_000;
/** How many explanations are listed. */
const MAX_PROBLEMS_SHOWN = 200;
/** What the table shows where a name has no converted form. */
const NOT_CONVERTED = 'not converted';

function directionOf(values: Values): Direction {
  const direction = str(values, 'direction', 'auto');
  return direction === 'to-ascii' || direction === 'to-unicode' ? direction : 'auto';
}

function profileOf(values: Values): ProfileId {
  return str(values, 'profile', 'strict') === 'browser' ? 'browser' : 'strict';
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** The form of a valid name that goes in the converted list: ASCII, except when the name was an xn-- name. */
function convertedForm(row: ConvertedName): string {
  return row.direction === 'to-unicode' ? (row.unicode ?? '') : (row.ascii ?? '');
}

function outputsFor(rows: ConvertedName[]): ToolResult {
  const valid = rows.filter((row) => row.valid);
  const invalid = rows.filter((row) => !row.valid);
  const outputs: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Each name in both forms (invisible characters are shown as escapes, so do not copy from this table)',
      table: {
        headers: ['Line', 'Name as pasted', 'ASCII form', 'Unicode form', 'Result'],
        rows: rows
          .slice(0, MAX_ROWS_SHOWN)
          .map((row) => [
            row.line,
            visible(row.input),
            row.ascii === null ? NOT_CONVERTED : visible(row.ascii),
            row.unicode === null ? NOT_CONVERTED : visible(row.unicode),
            row.valid
              ? 'valid'
              : `not valid: ${row.problems.length} ${plural(row.problems.length, 'problem', 'problems')}`,
          ]),
        mono: [1, 2, 3],
      },
    },
  ];
  if (rows.length > MAX_ROWS_SHOWN) {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value: `Showing the first ${MAX_ROWS_SHOWN} of ${rows.length} names; the counts above and the converted list cover every name.`,
    });
  }
  if (invalid.length > 0) {
    const items: string[] = [];
    let listed = 0;
    let total = 0;
    for (const row of invalid) {
      for (const problem of row.problems) {
        total += 1;
        if (listed >= MAX_PROBLEMS_SHOWN) continue;
        listed += 1;
        items.push(`Line ${row.line}, ${FAMILY_WORDS.get(problem.family) ?? 'Problem'}: ${problem.message}`);
      }
    }
    outputs.push({ kind: 'list', label: 'Why a name is invalid', items });
    if (total > listed) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `Showing the first ${listed} of ${total} explanations.`,
      });
    }
  }
  if (valid.length > 0) {
    outputs.push({
      kind: 'code',
      label: 'Converted names, one per line (copy this list)',
      // The real names, never the escape text of the table: a valid name can hold a zero width joiner or non-joiner, and a
      // copy or download that wrote its escape instead would be a different, invalid name.
      value: valid.map(convertedForm).join('\n'),
      download: 'domains.txt',
    });
  }
  outputs.push({
    kind: 'note',
    tone: 'warn',
    value:
      'Conversion does not judge look-alike characters: a name that converts can still imitate another name, so compare the ASCII form and the code points, not how a name looks. The mapping data is Unicode 17; a name that uses a code point added in Unicode 18 is judged by the Unicode 17 table. Label numbers count the labels of the name after UTS #46 has mapped it, from 1, and invisible, control and direction-changing characters are shown as escapes in the table and the explanations, never in the list of converted names, which holds the real names.',
  });
  return {
    outputs,
    stats: [
      ['Names', String(rows.length)],
      ['Valid', String(valid.length)],
      ['Not valid', String(invalid.length)],
    ],
  };
}

function failure(error: unknown): ToolResult {
  if (error instanceof IdnConverterError) {
    const issue: ToolIssue =
      error.line === undefined ? { message: error.message } : { message: error.message, line: error.line };
    return { outputs: [], errors: [issue] };
  }
  return { outputs: [], errors: [{ message: 'Could not convert these names.' }] };
}

/** A name with an invisible character built at run time, so the source file holds no hidden character. */
const WITH_HIDDEN_CHARACTER = 'ex' + String.fromCodePoint(0x200b) + 'ample.com';

export default defineTool({
  id: 'idn-converter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'direction',
      label: 'Direction',
      type: 'radio',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Automatic' },
        { value: 'to-ascii', label: 'Unicode to ASCII' },
        { value: 'to-unicode', label: 'ASCII to Unicode' },
      ],
      help: 'Automatic converts a name with a character that is not ASCII to ASCII, and a name with an xn-- label to Unicode.',
    },
    {
      name: 'profile',
      label: 'Profile',
      type: 'select',
      default: 'strict',
      options: [
        { value: 'strict', label: 'Strict, as for registering a name' },
        { value: 'browser', label: 'As a browser address bar reads it' },
      ],
      help: 'The browser profile switches off the hyphen, character, length and empty label checks; bidirectional text and joiners are still checked.',
    },
    {
      name: 'names',
      label: 'Names',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'One domain name per line, in Unicode or as xn-- labels.',
    },
  ],
  examples: [
    {
      label: 'Unicode to ASCII',
      values: {
        direction: 'to-ascii',
        profile: 'strict',
        names: ['bücher.example', 'München.example', WITH_HIDDEN_CHARACTER, 'a_b.example', '-start.example'].join('\n'),
      },
    },
    {
      label: 'ASCII to Unicode',
      values: {
        direction: 'to-unicode',
        profile: 'strict',
        names: ['xn--bcher-kva.example', 'xn--mnchen-3ya.example', 'xn--ab--.example', 'xn--99999999999.example'].join(
          '\n',
        ),
      },
    },
  ],
  run(values): ToolResult {
    const text = str(values, 'names');
    if (text.trim() === '') return { outputs: [] };
    try {
      const rows = convertNames(text, { direction: directionOf(values), profile: profileOf(values) });
      if (rows.length === 0) return { outputs: [] };
      return outputsFor(rows);
    } catch (error) {
      return failure(error);
    }
  },
});
