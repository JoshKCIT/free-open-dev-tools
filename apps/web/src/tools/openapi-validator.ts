import { meta, validateOpenApi, OpenApiValidatorError } from '@fodt/openapi-validator';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'openapi-validator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Input',
      type: 'textarea',
      rows: 16,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'format',
      label: 'Format',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto-detect' },
        { value: 'json', label: 'JSON' },
        { value: 'yaml', label: 'YAML' },
      ],
    },
    {
      name: 'checkFormats',
      label: 'Check format keywords (date-time, email, uri, ...)',
      type: 'checkbox',
      default: true,
    },
  ],
  examples: [
    {
      label: 'OpenAPI 3.0 petstore',
      values: {
        input: JSON.stringify(
          {
            openapi: '3.0.4',
            info: { title: 'Petstore', version: '1.0.0' },
            paths: { '/pets': { get: { responses: { '200': { description: 'A list of pets.' } } } } },
          },
          null,
          2,
        ),
      },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const format = str(values, 'format', 'auto') as 'auto' | 'json' | 'yaml';
    const checkFormats = bool(values, 'checkFormats', true);

    try {
      const result = validateOpenApi(input, { format, checkFormats });
      const outputs: OutputBlock[] = [];

      if (result.valid) {
        outputs.push({
          kind: 'note',
          label: 'Result',
          tone: 'success',
          value: `Valid ${versionLabel(result.version)} document.`,
        });
      } else {
        outputs.push({
          kind: 'table',
          label: 'Problems',
          table: {
            headers: ['Path', 'Line', 'Problem', 'Keyword'],
            rows: result.errors.map((e) => [e.path || '(whole document)', e.line ?? '', e.message, e.keyword]),
            mono: [0],
          },
        });
        if (result.collapsed > 0) {
          outputs.push({
            kind: 'note',
            label: 'Note',
            tone: 'info',
            value: `${result.collapsed} additional combinator ${result.collapsed === 1 ? 'error was' : 'errors were'} collapsed because a more specific problem above already explains it.`,
          });
        }
      }

      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }

      return {
        outputs,
        stats: [
          ['Version', versionLabel(result.version)],
          ['Paths', String(result.counts.paths)],
          ['Operations', String(result.counts.operations)],
          ['Schemas', String(result.counts.schemas)],
          ['Errors', String(result.counts.errors)],
        ],
      };
    } catch (err) {
      if (err instanceof OpenApiValidatorError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});

function versionLabel(version: string): string {
  switch (version) {
    case 'swagger-2.0':
      return 'Swagger 2.0';
    case 'openapi-3.0':
      return 'OpenAPI 3.0';
    case 'openapi-3.1':
      return 'OpenAPI 3.1';
    case 'openapi-3.2':
      return 'OpenAPI 3.2';
    default:
      return version;
  }
}
