import {
  buildTreeHtml,
  checkC14nInput,
  formatXml,
  meta,
  positionInCanonical,
  XmlFormatterError,
  type C14nMode,
  type FormatMode,
} from '@fodt/xml-formatter';
import { xmlFormatterInWorker, XmlFormatterRunError } from '../lib/run-xml-formatter-in-worker';
import { defineTool, str, bool, num, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

/** Which of two compared documents a problem is in, as the heading of its message. */
function partLabel(part: 'first' | 'second' | undefined): string {
  if (part === 'first') return 'First document: ';
  if (part === 'second') return 'Second document: ';
  return '';
}

/** The tree stops here and says so; it is a view for reading a document, not for a document of 100,000 elements. */
const TREE_MAX_ELEMENTS = 2000;

/** How many characters of a long canonical line are shown before and after the first difference. */
const DIFF_BEFORE = 80;
const DIFF_AFTER = 160;

/** A long line is cut around the character that differs, so the difference is always in view. */
function excerpt(line: string, column: number): string {
  if (line.length <= DIFF_BEFORE + DIFF_AFTER) return line;
  const from = Math.max(0, column - DIFF_BEFORE);
  const to = Math.min(line.length, column + DIFF_AFTER);
  return `${from > 0 ? '...' : ''}${line.slice(from, to)}${to < line.length ? '...' : ''}`;
}

/**
 * The two canonical forms as a diff: up to three unchanged lines, then what differs from the first differing line to
 * the point where the endings agree again, then up to three unchanged lines. Canonical forms are often one long line,
 * so each differing line is cut around the first differing character.
 */
function diffBlock(a: string, b: string, offset: number): OutputBlock {
  const left = a.split('\n');
  const right = b.split('\n');
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix++;
  }
  // The differing column is counted inside the first differing line, which both forms share up to that character.
  const lineStart = left.slice(0, prefix).reduce((total, line) => total + line.length + 1, 0);
  const column = Math.max(0, offset - lineStart);
  const lines: { type: 'add' | 'del' | 'ctx' | 'meta'; text: string }[] = [
    { type: 'meta', text: '--- first document, canonical form' },
    { type: 'meta', text: '+++ second document, canonical form' },
  ];
  for (const line of left.slice(Math.max(0, prefix - 3), prefix)) {
    lines.push({ type: 'ctx', text: excerpt(line, column) });
  }
  for (const line of left.slice(prefix, left.length - suffix)) {
    lines.push({ type: 'del', text: excerpt(line, column) });
  }
  for (const line of right.slice(prefix, right.length - suffix)) {
    lines.push({ type: 'add', text: excerpt(line, column) });
  }
  for (const line of left.slice(left.length - suffix, left.length - suffix + 3)) {
    lines.push({ type: 'ctx', text: excerpt(line, column) });
  }
  return { kind: 'diff', label: 'Canonical forms', lines };
}

export default defineTool({
  id: 'xml-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Format, minify, check and the tree stay on the page and run as you type. Canonical XML and Compare go through a
  // new background worker for every run, with a 20 second limit (see run-xml-formatter-in-worker.ts's own comment), so
  // the page offers Cancel while one is in flight.
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'format',
      options: [
        { value: 'format', label: 'Format' },
        { value: 'minify', label: 'Minify' },
        { value: 'check', label: 'Check' },
        { value: 'canonical', label: 'Canonical XML' },
        { value: 'tree', label: 'Tree' },
        { value: 'compare', label: 'Compare' },
      ],
    },
    {
      name: 'indent',
      label: 'Indent',
      type: 'select',
      default: '2',
      options: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
      ],
      visible: (values) => str(values, 'mode', 'format') === 'format',
    },
    {
      name: 'removeComments',
      label: 'Remove comments',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'mode', 'format') === 'minify',
    },
    {
      name: 'c14n',
      label: 'Canonical form',
      type: 'select',
      default: '1.0',
      options: [
        { value: '1.0', label: 'Canonical XML 1.0' },
        { value: 'exclusive', label: 'Exclusive Canonical XML 1.0' },
        { value: '1.1', label: 'Canonical XML 1.1' },
      ],
      help: 'Compare uses this form too, always without comments.',
      visible: (values) => ['canonical', 'compare'].includes(str(values, 'mode', 'format')),
    },
    {
      name: 'withComments',
      label: 'Keep comments',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'mode', 'format') === 'canonical',
    },
    {
      name: 'second',
      label: 'Second document',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      visible: (values) => str(values, 'mode', 'format') === 'compare',
    },
  ],
  examples: [
    {
      label: 'Format',
      values: { mode: 'format', input: '<note><to>Ada</to><body>Hello</body></note>' },
    },
    {
      label: 'Check',
      values: { mode: 'check', input: '<note><to>Ada</to></note>' },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const chosen = str(values, 'mode', 'format');
    const mode = chosen as FormatMode;
    const indent = num(values, 'indent', 2);
    const removeComments = bool(values, 'removeComments', false);

    try {
      if (chosen === 'canonical') {
        const c14n = str(values, 'c14n', '1.0') as C14nMode;
        // Refused before any worker starts, so an oversize text or a DOCTYPE never reaches the engine.
        checkC14nInput(input);
        const done = await xmlFormatterInWorker(
          {
            type: 'xml-formatter-job',
            operation: 'canonical',
            text: input,
            second: '',
            mode: c14n,
            withComments: bool(values, 'withComments', false),
          },
          ctx,
        );
        if (done.operation !== 'canonical') return { outputs: [] };
        return {
          outputs: [
            { kind: 'code', label: 'Canonical XML', language: 'xml', value: done.output, download: 'canonical.xml' },
          ],
        };
      }

      if (chosen === 'compare') {
        const second = str(values, 'second');
        if (!second.trim()) {
          return {
            outputs: [{ kind: 'note', tone: 'info', value: 'Paste a second document to compare it with the first.' }],
          };
        }
        const c14n = str(values, 'c14n', '1.0') as C14nMode;
        // Both are refused before any worker starts, the first one first, each naming itself.
        checkC14nInput(input, 'first');
        checkC14nInput(second, 'second');
        const done = await xmlFormatterInWorker(
          { type: 'xml-formatter-job', operation: 'compare', text: input, second, mode: c14n, withComments: false },
          ctx,
        );
        if (done.operation !== 'compare') return { outputs: [] };
        const { equivalent, first } = done.result;
        if (equivalent || !first) {
          return { outputs: [{ kind: 'note', tone: 'success', value: 'Equivalent after canonicalization.' }] };
        }
        const where = positionInCanonical(first.a, first.offset);
        return {
          outputs: [
            {
              kind: 'note',
              tone: 'warn',
              value: `Not equivalent: the canonical forms first differ at character ${first.offset + 1} (line ${where.line}, column ${where.column}).`,
            },
            diffBlock(first.a, first.b, first.offset),
          ],
        };
      }

      if (chosen === 'tree') {
        const tree = buildTreeHtml(input, { maxElements: TREE_MAX_ELEMENTS, openLevels: 2 });
        const outputs: OutputBlock[] = [
          // The tree is a view of the document, not markup anyone would paste elsewhere, so it offers no Copy HTML.
          {
            kind: 'sandboxed-html',
            label: 'Tree (a view of the document, nothing is loaded)',
            html: tree.html,
            copy: false,
          },
        ];
        if (tree.truncated) {
          outputs.unshift({
            kind: 'note',
            tone: 'info',
            value: `Showing the first ${tree.elements.toLocaleString('en-US')} of ${tree.totalElements.toLocaleString('en-US')} elements.`,
          });
        }
        return { outputs };
      }

      const result = formatXml(input, { mode, indent, removeComments });
      const outputs: OutputBlock[] = [{ kind: 'code', label: 'Output', language: 'xml', value: result.output }];
      if (mode === 'check') {
        outputs.unshift({ kind: 'note', tone: 'success', value: 'Well-formed XML 1.0.' });
      }
      return {
        outputs,
        stats: [
          ['Elements', String(result.elements)],
          ['Attributes', String(result.attributes)],
          ['Deepest level', String(result.maxDepth)],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note already owns
      // that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof XmlFormatterError || err instanceof XmlFormatterRunError) {
        const problem: ToolIssue = {
          message: `${partLabel(err.part)}${err.message}`,
          line: err.line,
          column: err.column,
        };
        return { outputs: [], errors: [problem] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
