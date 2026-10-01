import { meta, hasPhpOpeningTag, PhpFormatterError, PHP_VERSIONS, type PhpBraceStyle } from '@fodt/php-formatter';
import { phpFormatterInWorker, PhpFormatterRunError } from '../lib/run-php-formatter-in-worker';
import { defineTool, bool, num, str, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'php-formatter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Every run goes through a background worker with a 10 second time limit
  // (see run-php-formatter-in-worker.ts's own comment): the parser may be
  // stuck inside one long call, so the page, not the formatter, decides when
  // a run has taken too long.
  cancellable: true,
  fields: [
    {
      name: 'input',
      label: 'PHP source',
      type: 'textarea',
      rows: 14,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    {
      name: 'printWidth',
      label: 'Print width',
      type: 'number',
      default: 80,
      min: 20,
      max: 200,
      help: "Prettier's own default is 80.",
    },
    {
      name: 'tabWidth',
      label: 'Indent width',
      type: 'number',
      default: 4,
      min: 1,
      max: 16,
      help: "The PHP plugin's own default is 4.",
    },
    { name: 'useTabs', label: 'Indent with tabs', type: 'checkbox', default: false },
    { name: 'singleQuote', label: 'Prefer single quotes', type: 'checkbox', default: false },
    { name: 'trailingCommaPHP', label: 'Trailing commas', type: 'checkbox', default: true },
    {
      name: 'braceStyle',
      label: 'Brace style',
      type: 'select',
      default: 'per-cs',
      options: [
        { value: 'per-cs', label: 'PER Coding Style' },
        { value: '1tbs', label: 'One true brace style' },
      ],
    },
    {
      name: 'phpVersion',
      label: 'PHP version',
      type: 'text',
      mono: true,
      default: '8.5',
      help: `Any version from ${PHP_VERSIONS[0]} to ${PHP_VERSIONS[PHP_VERSIONS.length - 1]}, such as 7.4 or 8.5. Automatic detection is not available in a browser.`,
    },
  ],
  examples: [
    {
      label: 'Tidy a class',
      values: {
        input:
          "<?php\nclass Greeter{\nprivate $name;\nfunction __construct($name){$this->name=$name;}\nfunction greet($other){return 'Hello, '.$other.', I am '.$this->name;}\n}\n",
      },
    },
    {
      label: 'One true brace style',
      values: {
        input:
          "<?php\nclass Greeter\n{\n    public function greet($name)\n    {\n        if ($name) {\n            return 'hello';\n        }\n        return 'hi';\n    }\n}\n",
        braceStyle: '1tbs',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    // A blank number field uses the default. Any number typed in, such as the large negative one the privacy
    // harness types, goes to the package, which refuses it by name before Prettier runs; so does a PHP version
    // that is not one of the plugin's own.
    const options = {
      printWidth: num(values, 'printWidth', 80),
      tabWidth: num(values, 'tabWidth', 4),
      useTabs: bool(values, 'useTabs', false),
      singleQuote: bool(values, 'singleQuote', false),
      trailingCommaPHP: bool(values, 'trailingCommaPHP', true),
      braceStyle: str(values, 'braceStyle', 'per-cs') as PhpBraceStyle,
      phpVersion: str(values, 'phpVersion', '8.5').trim(),
    };

    try {
      const result = await phpFormatterInWorker({ type: 'php-formatter-job', source: input, options }, ctx);

      const outputs: OutputBlock[] = [];
      // Text outside PHP tags is inline HTML to the plugin, so source with no opening tag comes back as it went in.
      if (!hasPhpOpeningTag(input)) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value:
            'This source has no <?php (or <?=) opening tag, so it is treated as plain text and left as it is. Start the code with <?php to have it formatted.',
        });
      }
      outputs.push({
        kind: 'code',
        label: 'Formatted PHP',
        language: 'php',
        value: result.output,
        download: 'formatted.php',
      });

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
      if (err instanceof PhpFormatterError || err instanceof PhpFormatterRunError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
