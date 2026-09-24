import { meta, SUPPORTED_FLAGS, type RegexJob, type MatchRow, type ExplainPart } from '@fodt/regex-tester';
import { regexInWorker } from '../lib/run-regex-in-worker';
import { defineTool, str, bool, type Field, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const FLAG_LABELS: Record<(typeof SUPPORTED_FLAGS)[number], string> = {
  g: 'Global — find every match, not just the first',
  i: 'Case-insensitive',
  m: 'Multiline — ^ and $ also match at line breaks',
  s: 'Dot matches line breaks too',
  u: 'Unicode — read the pattern as a sequence of code points',
  y: 'Sticky — match only starting at the search position',
};

const flagFields: Field[] = SUPPORTED_FLAGS.map((flag) => ({
  name: `flag-${flag}`,
  label: FLAG_LABELS[flag],
  type: 'checkbox',
  default: flag === 'g',
}));

export default defineTool({
  id: 'regex-tester',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  cancellable: true,
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'test',
      options: [
        { value: 'test', label: 'Test' },
        { value: 'replace', label: 'Replace' },
        { value: 'explain', label: 'Explain' },
      ],
    },
    {
      name: 'pattern',
      label: 'Pattern',
      type: 'text',
      mono: true,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    ...flagFields,
    {
      name: 'replacement',
      label: 'Replacement',
      type: 'text',
      mono: true,
      visible: (values) => values.mode === 'replace',
      help: 'ECMA-262 replacement patterns: $& the whole match, $1 a numbered group, $<name> a named group, $$ a literal dollar sign.',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'input',
      label: 'Text',
      type: 'textarea',
      rows: 10,
      visible: (values) => values.mode !== 'explain',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
  ],
  examples: [
    {
      label: 'Dates',
      values: { pattern: '([0-9]{4})-([0-9]{2})-([0-9]{2})', input: 'Shipped 2024-03-05 and 2024-11-20.' },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const mode = str(values, 'mode', 'test') as RegexJob['mode'];
    const pattern = str(values, 'pattern');
    if (!pattern) return { outputs: [] };
    const input = str(values, 'input');
    if (mode !== 'explain' && !input) return { outputs: [] };

    const flags = SUPPORTED_FLAGS.filter((flag) => bool(values, `flag-${flag}`, flag === 'g')).join('');
    const job: RegexJob = { mode, pattern, flags, input, replacement: str(values, 'replacement') };

    try {
      const result = await regexInWorker(job, ctx);
      if (result.mode === 'test') return renderTest(result.matches, result.total, result.truncated);
      if (result.mode === 'replace') return renderReplace(result.output, result.count);
      return renderExplain(result.parts);
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own cancellation note already owns that message. Every
      // other rejection -- including the time-limit message this worker
      // helper composes on its own -- is shown as an input problem, the
      // same as an invalid pattern would be.
      if (ctx.signal.aborted) throw err;
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This pattern could not be run.' }],
      };
    }
  },
});

function renderTest(matches: MatchRow[], total: number, truncated: boolean): ToolResult {
  const outputs: OutputBlock[] = [];
  if (matches.length === 0) {
    outputs.push({ kind: 'note', tone: 'info', value: 'No match.' });
  } else {
    outputs.push({
      kind: 'table',
      label: 'Matches',
      table: {
        headers: ['Index', 'Match', 'Groups'],
        rows: matches.map((m) => [
          m.index,
          m.text,
          m.groups.map((g) => `${g.name}=${g.value === undefined ? '(no match)' : g.value}`).join(', '),
        ]),
        mono: [0, 1, 2],
      },
    });
  }
  const stats: [string, string][] = [['Matches', truncated ? `${total} (showing first 1000)` : String(total)]];
  return { outputs, stats };
}

function renderReplace(output: string, count: number): ToolResult {
  return {
    outputs: [{ kind: 'code', label: 'Result', value: output }],
    stats: [['Replacements', String(count)]],
  };
}

function renderExplain(parts: ExplainPart[]): ToolResult {
  if (parts.length === 0) {
    return { outputs: [{ kind: 'note', tone: 'info', value: 'Nothing to explain yet.' }] };
  }
  return {
    outputs: [
      {
        kind: 'table',
        label: 'Explanation',
        table: {
          // Non-breaking spaces, not regular ones: a plain space run collapses in HTML, so it would not indent at all.
          headers: ['Part', 'Meaning'],
          rows: parts.map((p) => ['  '.repeat(p.depth) + p.source, p.description]),
          mono: [0],
        },
      },
    ],
  };
}
