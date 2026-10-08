import {
  GlobTesterError,
  MAX_SHOWN_PATH,
  MAX_SHOWN_PATTERN,
  checkCodeownersInput,
  checkInput,
  meta,
  parsePaths,
  visible,
  type CodeownersRow,
  type GitignoreRow,
  type GlobRegex,
  type GlobRow,
  type SkippedLine,
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

/** What the CODEOWNERS note says, in the page's own words: the mode follows GitHub's documentation and checks no owner. */
const CODEOWNERS_NOTE =
  'This mode follows the rules GitHub documents for CODEOWNERS files: the last line that matches a path decides, and the owners of earlier lines are never merged. This page cannot check that an owner exists or has write access, and where GitHub documents nothing it shows its own reading, marked not documented by GitHub.';

function ownersText(row: CodeownersRow): string {
  return row.owners.length === 0 ? 'no owner' : visible(row.owners.join(' '), MAX_SHOWN_PATH);
}

/** The "Decided by" cell of a CODEOWNERS row, in words. */
function codeownersDecidedText(row: CodeownersRow): string {
  return row.line === null ? 'no line matched' : `line ${row.line}: ${shownPattern(row.pattern)}`;
}

function skippedItem(skipped: SkippedLine): string {
  const label = skipped.documented ? '' : ' (not documented by GitHub)';
  return `line ${skipped.line}: ${skipped.shown}: ${skipped.reason}${label}`;
}

function codeownersOutputs(rows: CodeownersRow[], skipped: SkippedLine[]): Pick<ToolResult, 'outputs' | 'stats'> {
  const unowned = rows.filter((r) => r.owners.length === 0);
  const outputs: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Owners for each path',
      table: {
        headers: ['Path', 'Owners', 'Decided by', 'Notes'],
        rows: rows.map((r) => [shownPath(r.path, false), ownersText(r), codeownersDecidedText(r), r.note]),
        mono: [0, 2],
      },
    },
  ];
  if (unowned.length === 0) outputs.push({ kind: 'note', tone: 'info', value: 'Every path has an owner.' });
  else
    outputs.push(
      listBlock(
        'Paths with no owner',
        unowned.map((r) => shownPath(r.path, false)),
      ),
    );
  if (skipped.length > 0) outputs.push(listBlock('Lines GitHub does not support or skipped', skipped.map(skippedItem)));
  outputs.push({ kind: 'note', tone: 'info', value: CODEOWNERS_NOTE });
  return {
    outputs,
    stats: [
      ['Paths', String(rows.length)],
      ['Owned', String(rows.length - unowned.length)],
      ['No owner', String(unowned.length)],
    ],
  };
}

function resultOutputs(result: TestResult): Pick<ToolResult, 'outputs' | 'stats'> {
  if (result.mode === 'codeowners') return codeownersOutputs(result.rows, result.skipped);
  return result.mode === 'glob'
    ? globOutputs(result.rows as GlobRow[], result.regexes)
    : gitignoreOutputs(result.rows as GitignoreRow[]);
}

/**
 * What the 5 second stop says in CODEOWNERS mode. The worker helper's own sentence blames one slow pattern and talks about
 * a .gitignore paste; in this mode the cause is the size of the file and the paths together.
 */
const CODEOWNERS_TIME_LIMIT_MESSAGE =
  'Stopped after 5 seconds: this CODEOWNERS file and these paths take too long to match together. Try fewer paths or fewer rules.';

type Mode = 'glob' | 'gitignore' | 'codeowners';

/** One of the worker helper's fixed sentences, as the page shows it: the time limit has its own words in CODEOWNERS mode. */
function fixedFailure(sentence: string, mode: Mode): ToolResult {
  const shown =
    mode === 'codeowners' && sentence === GLOB_TESTER_TIME_LIMIT_MESSAGE ? CODEOWNERS_TIME_LIMIT_MESSAGE : sentence;
  return { outputs: [], errors: [{ message: shown }] };
}

function failure(err: unknown, mode: Mode): ToolResult {
  const issue = (message: string): ToolIssue => ({ message });
  if (err instanceof GlobTesterError || err instanceof GlobTesterRunError) {
    return { outputs: [], errors: [issue(err.message)] };
  }
  if (err instanceof Error && FIXED_MESSAGES.has(err.message)) return fixedFailure(err.message, mode);
  return { outputs: [], errors: [issue('Could not test these patterns.')] };
}

export default defineTool({
  id: 'glob-tester',
  // All three modes run in a new background worker with a 5 second limit (see run-glob-tester-in-worker.ts's own
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
        { value: 'codeowners', label: 'CODEOWNERS file' },
      ],
    },
    {
      name: 'patterns',
      label: 'Patterns',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'The lines of a .gitignore file in .gitignore mode, or one glob per line in glob mode. In CODEOWNERS mode paste the whole CODEOWNERS file here.',
    },
    {
      name: 'paths',
      label: 'Paths',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Paths, one per line; end a directory with /. In CODEOWNERS mode every path names a file.',
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
    const chosen = str(values, 'mode', 'gitignore');
    const mode = chosen === 'glob' ? 'glob' : chosen === 'codeowners' ? 'codeowners' : 'gitignore';
    const patterns = str(values, 'patterns');
    const paths = str(values, 'paths');
    if (paths.trim() === '') return { outputs: [] };

    try {
      // Refused before any worker starts, so an over-limit paste or a path that is not allowed never reaches matching.
      // CODEOWNERS mode has its own limits and path rules, so it is checked on its own.
      if (mode === 'codeowners') {
        checkCodeownersInput(patterns, paths);
      } else {
        checkInput(patterns, paths);
        parsePaths(paths);
      }
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
      return failure(err, mode);
    }
  },
});
