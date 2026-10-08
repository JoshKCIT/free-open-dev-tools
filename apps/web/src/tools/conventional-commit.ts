import {
  ConventionalCommitError,
  MAX_CHANGELOG_LINES,
  MAX_SHOWN_CHARACTERS,
  MAX_SHOWN_HEADER,
  MAX_TABLE_ROWS,
  checkCommits,
  meta,
  visible,
  withCommas,
  type AdviceEntry,
  type CheckResult,
  type CheckedMessage,
  type SkipKind,
  type SplitMode,
} from '@fodt/conventional-commit';
import { bool, defineTool, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

const SPEC_EXAMPLES = [
  'feat!: send an email to the customer when a product is shipped',
  'fix: prevent racing of requests\n\nIntroduce a request id and a reference to latest request. Dismiss\nincoming responses other than from latest request.\n\nReviewed-by: Z\nRefs: #123',
  'docs: correct spelling of CHANGELOG',
].join('\n---\n');

const GIT_LOG_EXAMPLE = [
  'commit 3f2a9c1',
  'Author: Example Author <author@example.invalid>',
  'Date:   Mon Jan 5 10:00:00 2026 +0000',
  '',
  '    feat(api): add a health check',
  '',
  'commit 9b8a7c6',
  'Author: Example Author <author@example.invalid>',
  'Date:   Sun Jan 4 09:30:00 2026 +0000',
  '',
  '    Update the readme',
  '',
].join('\n');

/** How many skipped lines a note names before it says how many more there were. */
const MAX_SKIPPED_NAMED = 20;

const SKIP_NAMES: Record<SkipKind, string> = {
  merge: 'a merge line',
  revert: 'a revert line',
  fixup: 'a fixup! line',
  squash: 'a squash! line',
  amend: 'an amend! line',
  comment: 'a comment line',
};

function versionChange(result: CheckResult): string {
  return result.bump.level === 'none' ? 'no release' : result.bump.level;
}

function summaryBlock(result: CheckResult, hasVersion: boolean): OutputBlock {
  const valid = result.messages.filter((m) => m.parsed.valid).length;
  const pairs: [string, string][] = [
    ['Messages read', withCommas(result.messages.length)],
    ['Valid', withCommas(valid)],
    ['Not valid', withCommas(result.messages.length - valid)],
    ['Skipped', withCommas(result.skipped.length)],
  ];
  if (result.unread > 0) pairs.push(['Not read (past the limit)', withCommas(result.unread)]);
  pairs.push(['Version change', versionChange(result)]);
  if (hasVersion) {
    pairs.push(['Next version', result.bump.next ?? 'No new version: nothing here calls for a release']);
  }
  return { kind: 'keyvalue', label: 'Summary', pairs };
}

function problems(message: CheckedMessage): string {
  return message.parsed.failures.map((f) => `Rule ${f.rule}: ${f.message}`).join(' ');
}

function messageRow(message: CheckedMessage): (string | number)[] {
  const parsed = message.parsed;
  return [
    message.number,
    visible(parsed.header, MAX_SHOWN_HEADER),
    parsed.valid ? 'valid' : 'not valid',
    parsed.type === null ? '' : visible(parsed.type, MAX_SHOWN_CHARACTERS),
    parsed.scope === null ? '' : visible(parsed.scope, MAX_SHOWN_CHARACTERS),
    parsed.valid ? (parsed.breaking ? 'yes' : 'no') : '',
    problems(message),
  ];
}

function tableBlocks(result: CheckResult): OutputBlock[] {
  if (result.messages.length === 0) return [];
  const shown = result.messages.slice(0, MAX_TABLE_ROWS);
  const blocks: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Each message',
      table: {
        headers: ['No.', 'Header', 'Result', 'Type', 'Scope', 'Breaking', 'Problems'],
        rows: shown.map(messageRow),
        mono: [1, 3, 4],
      },
    },
  ];
  const rest = result.messages.length - shown.length;
  if (rest > 0) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `${withCommas(rest)} more ${rest === 1 ? 'message is' : 'messages are'} read but not listed: the table stops at ${MAX_TABLE_ROWS} rows.`,
    });
  }
  return blocks;
}

function skippedBlocks(result: CheckResult): OutputBlock[] {
  if (result.skipped.length === 0) return [];
  const named = result.skipped.slice(0, MAX_SKIPPED_NAMED).map((s) => `message ${s.number} is ${SKIP_NAMES[s.kind]}`);
  const rest = result.skipped.length - named.length;
  const more = rest > 0 ? `, and ${withCommas(rest)} more` : '';
  return [
    {
      kind: 'note',
      tone: 'info',
      value: `Skipped, not judged, because git writes these lines itself: ${named.join(', ')}${more}.`,
    },
  ];
}

function adviceBlock(label: string, notes: AdviceEntry[]): OutputBlock[] {
  if (notes.length === 0) return [];
  const shown = notes.slice(0, MAX_TABLE_ROWS);
  const blocks: OutputBlock[] = [{ kind: 'list', label, items: shown.map((n) => `Message ${n.number}: ${n.message}`) }];
  const rest = notes.length - shown.length;
  if (rest > 0) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `${withCommas(rest)} more ${rest === 1 ? 'note is' : 'notes are'} not listed: the list stops at ${MAX_TABLE_ROWS} items.`,
    });
  }
  return blocks;
}

function changelogBlocks(result: CheckResult): OutputBlock[] {
  if (result.messages.length === 0) return [];
  if (result.changelog === '') {
    return [
      {
        kind: 'note',
        tone: 'info',
        value:
          'The draft changelog is empty: no valid message is a feat, a fix, a performance change, a revert or a breaking change. Tick the option to list the other types to include docs, chore and the rest.',
      },
    ];
  }
  const lines = result.changelog.split('\n');
  const cut = lines.length > MAX_CHANGELOG_LINES;
  const blocks: OutputBlock[] = [
    {
      kind: 'code',
      label: 'Draft changelog',
      language: 'markdown',
      value: cut ? lines.slice(0, MAX_CHANGELOG_LINES).join('\n') : result.changelog,
    },
  ];
  if (cut) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `The draft changelog is shown up to ${withCommas(MAX_CHANGELOG_LINES)} lines; ${withCommas(lines.length - MAX_CHANGELOG_LINES)} more lines are left out.`,
    });
  }
  blocks.push({
    kind: 'note',
    tone: 'info',
    value:
      'The specification defines only the types feat and fix and the two ways to mark a breaking change. The headings of this draft and the choice of which types to list are a common convention, not part of the specification.',
  });
  return blocks;
}

export default defineTool({
  id: 'conventional-commit',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'messages',
      label: 'Commit messages',
      type: 'textarea',
      rows: 12,
      wide: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'One or more commit messages, cut as the choice below says.',
    },
    {
      name: 'split',
      label: 'How the messages are cut',
      type: 'radio',
      default: 'separator',
      options: [
        { value: 'separator', label: 'Messages separated by a line' },
        { value: 'lines', label: 'One message per line' },
        { value: 'gitlog', label: 'git log output' },
      ],
    },
    {
      name: 'separator',
      label: 'Separator line',
      type: 'text',
      default: '---',
      placeholder: '---',
      help: 'A line that holds only this text ends a message.',
      visible: (values) => str(values, 'split', 'separator') === 'separator',
    },
    {
      name: 'currentVersion',
      label: 'Current version (optional)',
      type: 'text',
      placeholder: '1.4.2',
      help: 'Gives the next version. A Semantic Versioning number such as 1.4.2, with an optional -pre-release and +build part.',
    },
    {
      name: 'zeroMajor',
      label: 'Raise the minor number for a breaking change while the major number is 0',
      type: 'checkbox',
      default: false,
    },
    {
      name: 'includeHidden',
      label: 'List the other types in the changelog too (docs, chore, test and the rest)',
      type: 'checkbox',
      default: false,
    },
    {
      name: 'advice',
      label: 'Show convention notes',
      type: 'checkbox',
      default: true,
    },
  ],
  examples: [
    {
      label: 'Three examples from the specification',
      values: { messages: SPEC_EXAMPLES, split: 'separator', separator: '---', currentVersion: '1.4.2' },
    },
    {
      label: 'git log output',
      values: { messages: GIT_LOG_EXAMPLE, split: 'gitlog' },
    },
  ],
  run(values): ToolResult {
    const text = str(values, 'messages');
    if (text === '') return { outputs: [] };
    const chosen = str(values, 'split', 'separator');
    const mode: SplitMode = chosen === 'lines' ? 'lines' : chosen === 'gitlog' ? 'gitlog' : 'separator';
    const currentVersion = str(values, 'currentVersion').trim();
    try {
      const result = checkCommits({
        text,
        mode,
        ...(mode === 'separator' ? { separator: str(values, 'separator', '---') } : {}),
        currentVersion,
        zeroMajor: bool(values, 'zeroMajor'),
        includeHidden: bool(values, 'includeHidden'),
        advice: bool(values, 'advice', true),
      });
      const outputs: OutputBlock[] = [summaryBlock(result, currentVersion !== '')];
      if (result.messages.length === 0) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value:
            'No message was found in the paste. Check how the messages are cut: a paste of only separator lines or blank lines holds none.',
        });
      }
      outputs.push(...tableBlocks(result), ...skippedBlocks(result));
      outputs.push(
        ...adviceBlock(
          'Convention notes (not part of the specification)',
          result.advice.filter((n) => n.label === 'convention'),
        ),
        ...adviceBlock(
          'Notes on how the specification was applied',
          result.advice.filter((n) => n.label === 'specification'),
        ),
      );
      outputs.push(...changelogBlocks(result));
      if (result.unread > 0) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `${withCommas(result.unread)} more ${result.unread === 1 ? 'message came' : 'messages came'} after the limit and ${result.unread === 1 ? 'was' : 'were'} counted, not read.`,
        });
      }
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'This page reads only the messages you pasted: it sees no repository, earlier tags or merge commits, so the version change is the highest change among them and not the next release of your project. Nothing is sent anywhere.',
      });
      return { outputs };
    } catch (err) {
      if (err instanceof ConventionalCommitError) {
        const issue: ToolIssue =
          err.line === undefined ? { message: err.message } : { message: err.message, line: err.line };
        return { outputs: [], errors: [issue] };
      }
      return { outputs: [], errors: [{ message: 'Could not check these messages.' }] };
    }
  },
});
