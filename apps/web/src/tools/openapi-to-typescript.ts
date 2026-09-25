import { meta, openApiToTypeScript, OpenApiToTypeScriptError } from '@fodt/openapi-to-typescript';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'openapi-to-typescript',
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
      name: 'includeOperations',
      label: 'Include operation parameter, request body and response types',
      type: 'checkbox',
      default: true,
    },
    {
      name: 'declarationStyle',
      label: 'Object schemas as',
      type: 'radio',
      default: 'interface',
      options: [
        { value: 'interface', label: 'export interface' },
        { value: 'type', label: 'export type' },
      ],
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
            paths: {
              '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'A list of pets.' } } } },
            },
            components: {
              schemas: {
                Pet: {
                  type: 'object',
                  required: ['id', 'name'],
                  properties: { id: { type: 'integer' }, name: { type: 'string' }, tag: { type: 'string' } },
                },
              },
            },
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
    const includeOperations = bool(values, 'includeOperations', true);
    const declarationStyle = str(values, 'declarationStyle', 'interface') as 'interface' | 'type';

    try {
      const result = openApiToTypeScript(input, { format, includeOperations, declarationStyle });
      return {
        outputs: [
          {
            kind: 'code',
            label: 'TypeScript',
            language: 'typescript',
            value: result.output,
            download: 'openapi-types.ts',
          },
        ],
        warnings: result.warnings,
        stats: [
          ['Types', String(result.types)],
          ['Operations', String(result.operations)],
        ],
      };
    } catch (err) {
      if (err instanceof OpenApiToTypeScriptError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
