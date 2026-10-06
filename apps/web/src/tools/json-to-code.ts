import { meta, jsonToCode, LANGUAGES, JsonToCodeError, type InputFormat, type Language } from '@fodt/json-to-code';
import { JSON_TO_CODE_TIME_LIMIT_MS, jsonToCodeInWorker, JsonToCodeRunError } from '../lib/run-json-to-code-in-worker';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

const LANGUAGE_LABELS: Record<Language, string> = {
  typescript: 'TypeScript',
  go: 'Go',
  rust: 'Rust',
  python: 'Python',
  java: 'Java',
  csharp: 'C#',
  kotlin: 'Kotlin',
  php: 'PHP',
  swift: 'Swift',
  dart: 'Dart',
  protobuf: 'Protocol Buffers',
};

export default defineTool({
  id: 'json-to-code',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // A YAML sample is read in a background worker with a 5 second time limit (checking a mapping's keys for
  // duplicates grows with the square of the key count), so that run can be cancelled. JSON and XML samples stay
  // synchronous.
  cancellable: true,
  runLimit: { ms: JSON_TO_CODE_TIME_LIMIT_MS },
  fields: [
    {
      name: 'input',
      label: 'Sample',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'inputFormat',
      label: 'Input format',
      type: 'select',
      default: 'json',
      help: 'The sample above is read in this format. XML attributes become fields named with @_ and text beside them #text.',
      options: [
        { value: 'json', label: 'JSON' },
        { value: 'yaml', label: 'YAML' },
        { value: 'xml', label: 'XML' },
      ],
    },
    {
      name: 'parseValues',
      label: 'Read numbers and booleans',
      type: 'checkbox',
      default: true,
      help: 'XML text is a number or boolean only when written the way JSON writes one; otherwise every XML value is a string.',
      visible: (values) => str(values, 'inputFormat', 'json') === 'xml',
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
    { label: 'Java record with Jackson', values: { input: '{"class":"admin","score":9.5}', language: 'java' } },
    { label: 'PHP readonly properties', values: { input: '{"weird key":"x"}', language: 'php' } },
    {
      label: 'Protocol Buffers message',
      values: { input: '{"userId":1,"weird key":"x","tags":["a"],"extra":[1,"a"]}', language: 'protobuf' },
    },
    {
      label: 'YAML input',
      values: { inputFormat: 'yaml', input: 'name: Ada\nage: 36\ntags:\n  - a', language: 'typescript' },
    },
    {
      label: 'XML input with an attribute',
      values: { inputFormat: 'xml', input: '<person id="1"><name>Ada</name></person>', language: 'typescript' },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const language = str(values, 'language', 'typescript') as Language;
    const rootName = str(values, 'rootName', 'Root');
    const inputFormat = str(values, 'inputFormat', 'json') as InputFormat;
    const parseValues = bool(values, 'parseValues', true);

    try {
      const options = { language, rootName: rootName.trim() === '' ? 'Root' : rootName, inputFormat, parseValues };
      // Only a YAML sample carries the quadratic duplicate-key risk, so only it is routed through the worker.
      const result =
        inputFormat === 'yaml'
          ? await jsonToCodeInWorker({ type: 'json-to-code-job', text: input, options }, ctx)
          : jsonToCode(input, options);
      return {
        outputs: [{ kind: 'code', label: LANGUAGE_LABELS[language], language, value: result.output }],
        warnings: result.warnings,
        stats: [['Types', String(result.typeCount)]],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof JsonToCodeError || err instanceof JsonToCodeRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that document.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
