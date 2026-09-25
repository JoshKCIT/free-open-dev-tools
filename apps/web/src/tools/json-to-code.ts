import { meta, jsonToCode, LANGUAGES, JsonToCodeError, type Language } from '@fodt/json-to-code';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

const LANGUAGE_LABELS: Record<Language, string> = {
  typescript: 'TypeScript',
  go: 'Go',
  rust: 'Rust',
  python: 'Python',
  java: 'Java',
  csharp: 'C#',
  kotlin: 'Kotlin',
  php: 'PHP',
};

export default defineTool({
  id: 'json-to-code',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'JSON sample',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'language',
      label: 'Language',
      type: 'select',
      default: 'typescript',
      options: LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABELS[l] })),
    },
    { name: 'rootName', label: 'Root type name', type: 'text', default: 'Root' },
  ],
  examples: [
    {
      label: 'Nested with an array',
      values: { input: '{"id":1,"name":"Ada","tags":["x"],"manager":null}', language: 'typescript' },
    },
    { label: 'A key that is a keyword', values: { input: '{"type":"user","class":"admin"}', language: 'go' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const language = str(values, 'language', 'typescript') as Language;
    const rootName = str(values, 'rootName', 'Root');

    try {
      const result = jsonToCode(input, { language, rootName: rootName.trim() === '' ? 'Root' : rootName });
      return {
        outputs: [{ kind: 'code', label: LANGUAGE_LABELS[language], language, value: result.output }],
        warnings: result.warnings,
        stats: [['Types', String(result.typeCount)]],
      };
    } catch (err) {
      if (err instanceof JsonToCodeError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that document.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
