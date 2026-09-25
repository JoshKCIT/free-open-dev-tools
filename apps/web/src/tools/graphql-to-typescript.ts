import { meta, graphqlToTypeScript, GraphqlToTypeScriptError } from '@fodt/graphql-to-typescript';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** One `Name=TypeScript type` mapping per line; blank lines and lines with no `=` are ignored. */
function parseScalarMappings(text: string): Record<string, string> {
  const scalars: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const type = line.slice(eq + 1).trim();
    if (name !== '' && type !== '') scalars[name] = type;
  }
  return scalars;
}

export default defineTool({
  id: 'graphql-to-typescript',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'sdl',
      label: 'Schema definition',
      type: 'textarea',
      rows: 16,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'enumStyle',
      label: 'Enums as',
      type: 'radio',
      default: 'union',
      options: [
        { value: 'union', label: 'A union of string literals' },
        { value: 'enum', label: 'A TypeScript enum' },
      ],
    },
    { name: 'includeTypename', label: 'Include __typename', type: 'checkbox', default: false },
    {
      name: 'scalars',
      label: 'Custom scalar mapping',
      type: 'textarea',
      rows: 3,
      help: 'One Name=TypeScript type per line. Unmapped scalars stay unknown.',
      placeholder: 'DateTime=string',
    },
  ],
  examples: [
    {
      label: 'Object, enum and non-null',
      values: { sdl: 'type Person {\n  name: String!\n  age: Int\n}' },
    },
    {
      label: 'Field arguments',
      values: {
        sdl: 'enum Episode {\n  NEWHOPE\n  EMPIRE\n}\n\ntype Character {\n  name: String!\n}\n\ntype Query {\n  hero(episode: Episode): Character\n}',
      },
    },
  ],
  run(values): ToolResult {
    const sdl = str(values, 'sdl');
    if (!sdl.trim()) return { outputs: [] };

    const enumStyle = str(values, 'enumStyle', 'union') === 'enum' ? 'enum' : 'union';
    const includeTypename = bool(values, 'includeTypename');
    const scalars = parseScalarMappings(str(values, 'scalars'));

    try {
      const result = graphqlToTypeScript(sdl, { enumStyle, includeTypename, scalars });
      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: 'TypeScript',
          language: 'typescript',
          value: result.output,
          download: 'schema-types.ts',
        },
      ];
      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }
      return { outputs, stats: [['Types', String(result.types)]] };
    } catch (err) {
      if (err instanceof GraphqlToTypeScriptError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that schema.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
