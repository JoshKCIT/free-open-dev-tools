import {
  MAX_SHOWN_CHARACTERS,
  SemverCheckerError,
  checkVersions,
  explainRange,
  meta,
  sortVersions,
  visible,
  type CheckResult,
  type RangeExplanation,
  type SortResult,
} from '@fodt/semver-checker';
import { defineTool, bool, str, type OutputBlock, type ToolIssue, type ToolResult, type Values } from '../lib/tool-ui';

/** How many rows of a check are shown; the counts above them cover every pasted line. */
const MAX_ROWS_SHOWN = 1_000;
/** How many lines that are not versions are listed. */
const MAX_INVALID_SHOWN = 200;
/** How many characters of the range, as typed, are repeated in the result. */
const MAX_RANGE_SHOWN = 200;

type Mode = 'check' | 'sort' | 'explain';

function modeOf(values: Values): Mode {
  const mode = str(values, 'mode', 'check');
  return mode === 'sort' || mode === 'explain' ? mode : 'check';
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function checkOutputs(result: CheckResult, range: string, includePrerelease: boolean): ToolResult {
  const satisfy = result.rows.filter((row) => row.result === 'satisfies').length;
  const notVersions = result.rows.filter((row) => row.result === 'not a valid version').length;
  const outputs: OutputBlock[] = [
    {
      kind: 'keyvalue',
      label: 'The range',
      pairs: [
        ['Range as written', visible(range.trim(), MAX_RANGE_SHOWN)],
        ['Normalised range', result.normalized],
        ['Highest satisfying', result.maxSatisfying ?? 'none of the pasted versions satisfy it'],
        ['Lowest version the range allows', result.minVersion ?? 'none, this range allows no version'],
      ],
    },
    {
      kind: 'table',
      label: 'Result for each version',
      table: {
        headers: ['Line', 'Version', 'Result'],
        rows: result.rows.slice(0, MAX_ROWS_SHOWN).map((row) => [row.line, row.shown, row.result]),
        mono: [1],
      },
    },
  ];
  if (result.rows.length > MAX_ROWS_SHOWN) {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value: `Showing the first ${MAX_ROWS_SHOWN} of ${result.rows.length} lines; the counts above cover every line.`,
    });
  }
  if (result.prereleases > 0) {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value: includePrerelease
        ? 'Include pre-releases is ticked, so pre-release versions are judged like any other version.'
        : `${result.prereleases} of the pasted ${plural(result.prereleases, 'versions is a pre-release', 'versions are pre-releases')}. npm leaves out a pre-release version unless a comparator in the same alternative names the same major, minor and patch with a pre-release. Tick Include pre-releases to judge pre-releases like any other version.`,
    });
  }
  return {
    outputs,
    stats: [
      ['Lines', String(result.rows.length)],
      ['Satisfy', String(satisfy)],
      ['Do not satisfy', String(result.rows.length - satisfy - notVersions)],
      ['Not versions', String(notVersions)],
    ],
  };
}

function sortOutputs(result: SortResult): ToolResult {
  const outputs: OutputBlock[] = [];
  if (result.sorted.length > 0) {
    outputs.push({
      kind: 'code',
      label: 'Sorted versions, lowest first',
      value: result.sorted.map((entry) => entry.shown).join('\n'),
      download: 'versions.txt',
    });
  }
  if (result.invalid.length > 0) {
    const listed = result.invalid.slice(0, MAX_INVALID_SHOWN);
    outputs.push({
      kind: 'table',
      label: 'Lines that are not versions',
      table: {
        headers: ['Line', `Text (first ${MAX_SHOWN_CHARACTERS} characters)`],
        rows: listed.map((entry) => [entry.line, entry.shown]),
        mono: [1],
      },
    });
    if (result.invalid.length > MAX_INVALID_SHOWN) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `Showing the first ${MAX_INVALID_SHOWN} of ${result.invalid.length} lines that are not versions.`,
      });
    }
  }
  if (result.equalNote !== undefined) {
    outputs.push({ kind: 'note', tone: 'info', value: result.equalNote });
  }
  return {
    outputs,
    stats: [
      ['Sorted', String(result.sorted.length)],
      ['Not versions', String(result.invalid.length)],
    ],
  };
}

function explainOutputs(result: RangeExplanation): ToolResult {
  const outputs: OutputBlock[] = [
    {
      kind: 'list',
      label:
        result.alternatives.length === 1
          ? 'In words: a version satisfies the range when it is'
          : 'In words: a version satisfies the range when it satisfies any one of these',
      ordered: true,
      items: result.alternatives.map((alternative) => alternative.words),
    },
    { kind: 'code', label: 'Normalised range', value: result.normalized },
  ];
  if (result.prereleaseNote !== null) outputs.push({ kind: 'note', tone: 'info', value: result.prereleaseNote });
  return { outputs };
}

function failure(error: unknown): ToolResult {
  if (error instanceof SemverCheckerError) {
    const issue: ToolIssue =
      error.line === undefined ? { message: error.message } : { message: error.message, line: error.line };
    return { outputs: [], errors: [issue] };
  }
  return { outputs: [], errors: [{ message: 'Could not read this input.' }] };
}

export default defineTool({
  id: 'semver-checker',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'check',
      options: [
        { value: 'check', label: 'Check versions against a range' },
        { value: 'sort', label: 'Sort versions' },
        { value: 'explain', label: 'Explain a range' },
      ],
    },
    {
      name: 'versions',
      label: 'Versions',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'One version per line, such as 1.2.3 or 2.0.0-beta.1.',
      visible: (values) => modeOf(values) !== 'explain',
    },
    {
      name: 'range',
      label: 'Range',
      type: 'text',
      placeholder: '^1.2.3 || >=4.0.0 <5.0.0',
      help: 'A range as npm reads it. Type * for any version.',
      mono: true,
      visible: (values) => modeOf(values) !== 'sort',
    },
    {
      name: 'loose',
      label: 'Loose parsing',
      type: 'checkbox',
      default: false,
      help: 'Also accept forms such as =1.2.3 and 1.2.3beta.',
    },
    {
      name: 'includePrerelease',
      label: 'Include pre-releases',
      type: 'checkbox',
      default: false,
      help: 'Judge pre-release versions like any other version.',
      visible: (values) => modeOf(values) !== 'sort',
    },
  ],
  examples: [
    {
      label: 'Caret range',
      values: {
        mode: 'check',
        range: '^1.2.3',
        versions: '1.2.2\n1.9.9\n2.0.0\n1.3.0-beta.1',
      },
    },
    {
      label: 'Sort a release list',
      values: {
        mode: 'sort',
        versions: '1.10.0\n1.2.0\n1.2.0-rc.1\n1.2.0-beta.2\nv2.0.0\nlatest',
      },
    },
  ],
  run(values): ToolResult {
    const mode = modeOf(values);
    const loose = bool(values, 'loose');
    // Only the fields visible for the mode are read, so a hidden field keeps its value and never changes a result.
    try {
      if (mode === 'sort') {
        const versions = str(values, 'versions');
        if (versions.trim() === '') return { outputs: [] };
        return sortOutputs(sortVersions(versions, { loose }));
      }
      const range = str(values, 'range');
      const includePrerelease = bool(values, 'includePrerelease');
      if (range.trim() === '') return { outputs: [] };
      if (mode === 'explain') return explainOutputs(explainRange(range, { loose, includePrerelease }));
      const versions = str(values, 'versions');
      if (versions.trim() === '') return { outputs: [] };
      return checkOutputs(checkVersions(versions, range, { loose, includePrerelease }), range, includePrerelease);
    } catch (error) {
      return failure(error);
    }
  },
});
