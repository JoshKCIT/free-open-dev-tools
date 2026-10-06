import {
  GlobTesterError,
  MAX_SHOWN_PATH,
  MAX_SHOWN_PATTERN,
  checkInput,
  meta,
  parsePaths,
  visible,
  type GitignoreRow,
  type GlobRegex,
  type GlobRow,
  type TestResult,
} from '@fodt/glob-tester';
import {
  GLOB_TESTER_TIME_LIMIT_MS,
  GLOB_TESTER_NOT_STARTED_MESSAGE,
  GLOB_TESTER_START_LIMIT_MESSAGE,
  GLOB_TESTER_STOPPED_MESSAGE,
  GLOB_TESTER_TIME_LIMIT_MESSAGE,
  GlobTesterRunError,
  globTesterInWorker,
} from '../lib/run-glob-tester-in-worker';
import { defineTool, bool, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

/** How many paths a result list names before it says how many more there are. */
const MAX_LISTED = 500;
/** How many pattern lines have their regular expression shown. */
const MAX_REGEXES_SHOWN = 50;

/** The fixed sentences the worker helper can give, which are shown as they are. */
const FIXED_MESSAGES = new Set([
  GLOB_TESTER_NOT_STARTED_MESSAGE,
  GLOB_TESTER_START_LIMIT_MESSAGE,
  GLOB_TESTER_STOPPED_MESSAGE,
  GLOB_TESTER_TIME_LIMIT_MESSAGE,
]);

function shownPattern(text: string): string {
  return visible(text, MAX_SHOWN_PATTERN);
}

function shownPath(path: string, isDirectory: boolean): string {
  return visible(path, MAX_SHOWN_PATH) + (isDirectory ? '/' : '');
}

/** The "Decided by" cell of a .gitignore row, in words. */
function decidedText(row: GitignoreRow): string {
  const by = row.decidedBy;
  if (by.kind === 'rule') return `line ${by.line}: ${shownPattern(by.pattern)}`;
  if (by.kind === 'parent')
    return `the directory ${visible(by.directory, MAX_SHOWN_PATH)} is excluded by line ${by.line}`;
  if (by.kind === 'none') return 'no rule matched';
  return 'decided by the .gitignore text';
}

function listBlock(label: string, paths: string[]): OutputBlock {
  const items = paths.slice(0, MAX_LISTED);
  if (paths.length > MAX_LISTED) items.push(`and ${paths.length - MAX_LISTED} more`);
  return { kind: 'list', label, items };
}

function gitignoreOutputs(rows: GitignoreRow[]): Pick<ToolResult, 'outputs' | 'stats'> {
  const ignored = rows.filter((r) => r.ignored);
  const outputs: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Result for each path',
      table: {
        headers: ['Path', 'Result', 'Decided by'],
        rows: rows.map((r) => [
          shownPath(r.path, r.isDirectory),
          r.ignored ? 'ignored' : 'not ignored',
          decidedText(r),
        ]),
        mono: [0, 2],
      },
    },
  ];
  if (ignored.length === 0) outputs.push({ kind: 'note', tone: 'info', value: 'No path is ignored.' });
  else
    outputs.push(
      listBlock(
        'Ignored paths',
        ignored.map((r) => shownPath(r.path, r.isDirectory)),
      ),
    );
  return {
    outputs,
    stats: [
      ['Paths', String(rows.length)],
      ['Ignored', String(ignored.length)],
      ['Not ignored', String(rows.length - ignored.length)],
    ],
  };
}

function alsoText(row: GlobRow): string {
  if (row.also.length === 0) return '';
  const more = row.moreAlso > 0 ? ` and ${row.moreAlso} more` : '';
  return (row.also.length === 1 && row.moreAlso === 0 ? 'line ' : 'lines ') + row.also.join(', ') + more;
}

function regexBlock(regexes: GlobRegex[]): OutputBlock {
  const shown = regexes.slice(0, MAX_REGEXES_SHOWN).map((r) => {
    return `line ${r.line}: ${visible(r.source, r.source.length)}${r.truncated ? ' (cut)' : ''}`;
  });
  if (regexes.length > MAX_REGEXES_SHOWN)
    shown.push(`and ${regexes.length - MAX_REGEXES_SHOWN} more patterns not shown`);
  return { kind: 'code', label: 'The regular expression each pattern becomes', value: shown.join('\n') };
}

function globOutputs(rows: GlobRow[], regexes: GlobRegex[]): Pick<ToolResult, 'outputs' | 'stats'> {
  const matched = rows.filter((r) => r.matched);
  const outputs: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Result for each path',
      table: {
        headers: ['Path', 'Result', 'First matching line', 'Also matched by'],
        rows: rows.map((r) => [
          shownPath(r.path, false),
          r.matched ? 'matched' : 'not matched',
          r.line === null ? '' : `line ${r.line}: ${shownPattern(r.pattern)}`,
          alsoText(r),
        ]),
        mono: [0, 2],
      },
    },
  ];
  if (matched.length === 0) outputs.push({ kind: 'note', tone: 'info', value: 'No path matched.' });
  else
    outputs.push(
      listBlock(
        'Matching paths',
        matched.map((r) => shownPath(r.path, false)),
      ),
    );
  if (regexes.length > 0) outputs.push(regexBlock(regexes));
  return {
    outputs,
    stats: [
      ['Paths', String(rows.length)],
      ['Matched', String(matched.length)],
      ['Not matched', String(rows.length - matched.length)],
    ],
  };
}

function resultOutputs(result: TestResult): Pick<ToolResult, 'outputs' | 'stats'> {
  return result.mode === 'glob'
    ? globOutputs(result.rows as GlobRow[], result.regexes)
    : gitignoreOutputs(result.rows as GitignoreRow[]);
}

function failure(err: unknown): ToolResult {
  const issue = (message: string): ToolIssue => ({ message });
  if (err instanceof GlobTesterError || err instanceof GlobTesterRunError) {
    return { outputs: [], errors: [issue(err.message)] };
  }
  if (err instanceof Error && FIXED_MESSAGES.has(err.message)) return { outputs: [], errors: [issue(err.message)] };
  return { outputs: [], errors: [issue('Could not test these patterns.')] };
}

export default defineTool({
  id: 'glob-tester',
  // Both kinds of matching run in a new background worker with a 5 second limit (see run-glob-tester-in-worker.ts's own
  // comment): a pattern that backtracks is stuck inside one synchronous call, so the page, not the matcher, decides when
  // it has taken too long, and Cancel stops it at once.
  cancellable: true,
  runLimit: { ms: GLOB_TESTER_TIME_LIMIT_MS },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'gitignore',
      options: [
        { value: 'gitignore', label: '.gitignore rules' },
        { value: 'glob', label: 'Glob patterns' },
      ],
    },
    {
      name: 'patterns',
      label: 'Patterns',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'The lines of a .gitignore file in .gitignore mode, or one glob per line in glob mode.',
    },
    {
      name: 'paths',
      label: 'Paths',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Paths, one per line; end a directory with /.',
    },
    {
      name: 'dot',
      label: 'Match dotfiles',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'mode', 'gitignore') === 'glob',
    },
    {
      name: 'nocase',
      label: 'Ignore case',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'mode', 'gitignore') === 'glob',
    },
  ],
  examples: [
    {
      label: '.gitignore with a re-included file',
      values: {
        mode: 'gitignore',
        patterns: '*.log\n!keep.log',
        paths: 'debug.log\nkeep.log\nlogs/\nlogs/a.txt',
      },
    },
    {
      label: 'Globs for TypeScript sources',
      values: {
        mode: 'glob',
        patterns: 'src/**/*.ts\n**/*.test.ts',
        paths: 'src/index.ts\nsrc/lib/util.ts\nsrc/lib/util.test.ts\ntest/api.test.ts\ndocs/readme.md',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const mode = str(values, 'mode', 'gitignore') === 'glob' ? 'glob' : 'gitignore';
    const patterns = str(values, 'patterns');
    const paths = str(values, 'paths');
    if (paths.trim() === '') return { outputs: [] };

    try {
      // Refused before any worker starts, so an over-limit paste or a path that is not allowed never reaches matching.
      checkInput(patterns, paths);
      parsePaths(paths);
      // The two options belong to glob mode: in .gitignore mode they are never sent, so they can never change a result.
      const result = await globTesterInWorker(
        {
          type: 'glob-tester-job',
          mode,
          patterns,
          paths,
          dot: mode === 'glob' && bool(values, 'dot'),
          nocase: mode === 'glob' && bool(values, 'nocase'),
        },
        ctx,
      );
      return resultOutputs(result);
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note already owns that
      // message.
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
