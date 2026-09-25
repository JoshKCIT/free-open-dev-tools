import { meta } from '@fodt/yaml-formatter';
import { yamlFormatterInWorker, YamlFormatterRunError } from '../lib/run-yaml-formatter-in-worker';
import { defineTool, str, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'yaml-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Parsing runs in a background worker with a 1.5 second time limit
  // (checking duplicate mapping keys grows quadratically with a flat
  // mapping's key count), so the run can be cancelled.
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'YAML',
      type: 'textarea',
      rows: 16,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'format',
      options: [
        { value: 'format', label: 'Format' },
        { value: 'check', label: 'Check only' },
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
      visible: (values) => values.mode !== 'check',
    },
    {
      name: 'lineWidth',
      label: 'Line width',
      type: 'number',
      default: 80,
      min: 40,
      max: 200,
      visible: (values) => values.mode !== 'check',
    },
  ],
  examples: [
    {
      label: 'Anchors and aliases (YAML 1.2.2 Example 2.10)',
      values: {
        input:
          '---\nhr:\n- Mark McGwire\n# Following node labeled SS\n- &SS Sammy Sosa\nrbi:\n- *SS # Subsequent occurrence\n- Ken Griffey\n',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const mode = str(values, 'mode', 'format') as 'format' | 'check';
    const indent = num(values, 'indent', 2);
    const lineWidthRaw = num(values, 'lineWidth', 80);
    const lineWidth = Math.max(40, Math.min(200, lineWidthRaw));

    try {
      const result = await yamlFormatterInWorker(
        { type: 'yaml-formatter-job', source: input, options: { mode, indent, lineWidth } },
        ctx,
      );

      const outputs: OutputBlock[] = [];

      if (mode === 'format') {
        outputs.push({
          kind: 'code',
          label: 'Output',
          language: 'yaml',
          value: result.output,
          download: 'formatted.yaml',
        });
      } else if (result.duplicates.length === 0) {
        outputs.push({ kind: 'note', tone: 'success', value: 'Valid YAML 1.2.' });
      }

      if (result.anchors.length > 0) {
        outputs.push({
          kind: 'table',
          label: 'Anchors',
          table: {
            headers: ['Name', 'Line', 'Kind', 'Aliases'],
            rows: result.anchors.map((a) => [a.name, a.line, a.kind, a.aliasCount]),
            mono: [0],
          },
        });
      }

      if (result.duplicates.length > 0) {
        outputs.push({
          kind: 'table',
          label: 'Duplicate keys',
          table: {
            headers: ['Key', 'Line', 'First seen at line'],
            rows: result.duplicates.map((d) => [d.key, d.line, d.firstLine]),
            mono: [0],
          },
        });
      }

      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }

      return {
        outputs,
        stats: [
          ['Documents', String(result.documents)],
          ['Anchors', String(result.anchors.length)],
          ['Aliases', String(result.aliases.length)],
          ['Duplicate keys', String(result.duplicates.length)],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own cancellation note already owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof YamlFormatterRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
