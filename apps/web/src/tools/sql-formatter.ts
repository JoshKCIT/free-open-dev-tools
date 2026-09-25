import { meta, SQL_DIALECTS } from '@fodt/sql-formatter';
import { sqlFormatterInWorker, SqlFormatterRunError } from '../lib/run-sql-formatter-in-worker';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'sql-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Formatting runs in a background worker with a 1.5 second time limit
  // (a deeply nested parenthesised expression showed super-linear growth
  // against the installed grammar), so the run can be cancelled.
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'SQL',
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
        { value: 'minify', label: 'Minify' },
      ],
    },
    {
      name: 'dialect',
      label: 'Dialect',
      type: 'select',
      default: 'sql',
      options: SQL_DIALECTS,
    },
    {
      name: 'keywordCase',
      label: 'Keyword case',
      type: 'select',
      default: 'preserve',
      options: [
        { value: 'preserve', label: 'Keep as written' },
        { value: 'upper', label: 'UPPER CASE' },
        { value: 'lower', label: 'lower case' },
      ],
      visible: (values) => values.mode !== 'minify',
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
      visible: (values) => values.mode !== 'minify',
    },
  ],
  examples: [
    {
      label: 'sql-formatter README example',
      values: { input: 'SELECT * FROM tbl', dialect: 'mysql' },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const mode = str(values, 'mode', 'format') as 'format' | 'minify';
    const dialect = str(values, 'dialect', 'sql');
    const keywordCase = str(values, 'keywordCase', 'preserve') as 'preserve' | 'upper' | 'lower';
    const indent = Number(str(values, 'indent', '2'));

    try {
      const result = await sqlFormatterInWorker(
        { type: 'sql-formatter-job', source: input, options: { mode, dialect, keywordCase, indent } },
        ctx,
      );

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Output', language: 'sql', value: result.output, download: 'query.sql' },
      ];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }

      return {
        outputs,
        stats: [
          ['Input size', `${input.length} chars`],
          ['Output size', `${result.output.length} chars`],
        ],
      };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof SqlFormatterRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
