import {
  meta,
  CFamilyFormatterError,
  C_FAMILY_LANGUAGES,
  C_FAMILY_PRESETS,
  type CFamilyLanguage,
  type CFamilyPreset,
} from '@fodt/c-family-formatter';
import { cFamilyFormatterInWorker, CFamilyFormatterRunError } from '../lib/run-c-family-formatter-in-worker';
import { defineTool, num, str, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** What the visitor reads for each language, the language name the output block is highlighted as, and the file extension of the download. */
const LANGUAGE_DETAILS: Record<CFamilyLanguage, { label: string; highlight: string; extension: string }> = {
  c: { label: 'C', highlight: 'c', extension: 'c' },
  cpp: { label: 'C++', highlight: 'cpp', extension: 'cpp' },
  csharp: { label: 'C#', highlight: 'csharp', extension: 'cs' },
  java: { label: 'Java', highlight: 'java', extension: 'java' },
  objc: { label: 'Objective-C', highlight: 'objectivec', extension: 'm' },
  proto: { label: 'Protocol Buffers', highlight: 'protobuf', extension: 'proto' },
};

export default defineTool({
  id: 'c-family-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Every run goes through a background worker with a 10 second time limit
  // (see run-c-family-formatter-in-worker.ts's own comment): the engine is a
  // WebAssembly build that may be stuck inside one synchronous call, so the
  // page, not the engine, decides when a run has taken too long.
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'Source',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'language',
      label: 'Language',
      type: 'select',
      default: 'cpp',
      options: C_FAMILY_LANGUAGES.map(({ value }) => ({ value, label: LANGUAGE_DETAILS[value].label })),
    },
    {
      name: 'preset',
      label: 'Style preset',
      type: 'select',
      default: 'LLVM',
      options: C_FAMILY_PRESETS.map((value) => ({ value, label: value })),
    },
    {
      name: 'indentWidth',
      label: 'Indent width',
      type: 'number',
      min: 1,
      max: 16,
      help: "Leave blank to use the preset's own width.",
    },
  ],
  examples: [
    {
      label: 'Tidy a C++ function',
      values: {
        input: 'int add(int a,int b){return a+b;}\nint main(){int x=add(1,2);if(x>2){return 0;}return 1;}\n',
      },
    },
    {
      label: 'Google style Java',
      values: {
        input:
          'public class Greeter{\npublic String greet(String name){\nif(name==null){return "hello";}\nreturn "hello, "+name;\n}\n}\n',
        language: 'java',
        preset: 'Google',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    const language = str(values, 'language', 'cpp') as CFamilyLanguage;
    // A blank field keeps the preset's own width; anything else is checked by the package, which refuses a
    // value that is not a whole number from 1 to 16 before the engine runs.
    const rawWidth = values['indentWidth'];
    const blankWidth =
      rawWidth === undefined || rawWidth === null || (typeof rawWidth === 'string' && !rawWidth.trim());
    const options = {
      language,
      preset: str(values, 'preset', 'LLVM') as CFamilyPreset,
      indentWidth: blankWidth ? undefined : num(values, 'indentWidth', Number.NaN),
    };

    try {
      const result = await cFamilyFormatterInWorker({ type: 'c-family-formatter-job', source: input, options }, ctx);

      const details = LANGUAGE_DETAILS[language];
      const outputs: OutputBlock[] = [
        {
          kind: 'code',
          label: `Formatted ${details.label}`,
          language: details.highlight,
          value: result.output,
          download: `formatted.${details.extension}`,
        },
      ];

      return {
        outputs,
        stats: [
          ['Input', formatBytes(result.inputBytes)],
          ['Output', formatBytes(result.outputBytes)],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own cancellation note already owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof CFamilyFormatterError || err instanceof CFamilyFormatterRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
