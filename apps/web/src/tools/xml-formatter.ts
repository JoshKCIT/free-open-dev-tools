import {
  checkC14nInput,
  formatXml,
  meta,
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

export default defineTool({
  id: 'xml-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Format, minify and check stay on the page and run as you type. Canonical XML goes through a new background worker
  // for every run, with a 20 second limit (see run-xml-formatter-in-worker.ts's own comment), so the page offers
  // Cancel while one is in flight.
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
      visible: (values) => str(values, 'mode', 'format') === 'canonical',
    },
    {
      name: 'withComments',
      label: 'Keep comments',
      type: 'checkbox',
      default: false,
      visible: (values) => str(values, 'mode', 'format') === 'canonical',
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
