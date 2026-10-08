import {
  ConventionalCommitError,
  MAX_SHOWN_CHARACTERS,
  MAX_SHOWN_HEADER,
  MAX_TABLE_ROWS,
  checkCommits,
  meta,
  visible,
  withCommas,
  type CheckResult,
  type CheckedMessage,
  type SplitMode,
} from '@fodt/conventional-commit';
import { defineTool, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

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

function versionChange(result: CheckResult): string {
  return result.bump.level === 'none' ? 'no release' : result.bump.level;
}

function summaryBlock(result: CheckResult): OutputBlock {
  const valid = result.messages.filter((m) => m.parsed.valid).length;
  const pairs: [string, string][] = [
    ['Messages read', withCommas(result.messages.length)],
    ['Valid', withCommas(valid)],
    ['Not valid', withCommas(result.messages.length - valid)],
    ['Skipped', withCommas(result.skipped.length)],
  ];
  if (result.unread > 0) pairs.push(['Not read (past the limit)', withCommas(result.unread)]);
  pairs.push(['Version change', versionChange(result)]);
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
  ],
  examples: [
    {
      label: 'Three examples from the specification',
      values: { messages: SPEC_EXAMPLES, split: 'separator', separator: '---' },
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
    try {
      const result = checkCommits({
        text,
        mode,
        ...(mode === 'separator' ? { separator: str(values, 'separator', '---') } : {}),
      });
      const outputs: OutputBlock[] = [summaryBlock(result)];
      if (result.messages.length === 0) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value:
            'No message was found in the paste. Check how the messages are cut: a paste of only separator lines or blank lines holds none.',
        });
      }
      outputs.push(...tableBlocks(result));
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
