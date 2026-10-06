import {
  meta,
  checkSource,
  isBlankSource,
  StylesheetError,
  type Language,
  type OutputStyle,
} from '@fodt/sass-less-compiler';
import {
  SASS_LESS_COMPILER_TIME_LIMIT_MS,
  compileInWorker,
  SassLessCompilerRunError,
} from '../lib/run-sass-less-compiler-in-worker';
import { defineTool, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

/** The languages and output styles a stylesheet can be compiled as. Maps, so a stray value is just a miss. */
const LANGUAGES: ReadonlyMap<string, Language> = new Map([
  ['scss', 'scss'],
  ['sass', 'sass'],
  ['less', 'less'],
]);

const STYLES: ReadonlyMap<string, OutputStyle> = new Map([
  ['expanded', 'expanded'],
  ['compressed', 'compressed'],
]);

const SCSS_EXAMPLE = `@use "sass:color";

$brand: #336699;
$radius: 4px;

.button {
  color: white;
  background: $brand;
  border-radius: $radius;

  &:hover {
    background: color.adjust($brand, $lightness: -10%);
  }
}
`;

const SASS_EXAMPLE = `$gap: 8px

.card
  padding: $gap * 2

  .title
    margin-bottom: $gap
    font-weight: bold
`;

const LESS_EXAMPLE = `@base: #336699;

.rounded(@radius: 4px) {
  border-radius: @radius;
}

.text-on(@background) when (lightness(@background) > 50%) {
  color: #222222;
}

.text-on(@background) when (lightness(@background) <= 50%) {
  color: #ffffff;
}

.card {
  background: @base;
  .rounded(8px);
  .text-on(@base);
}
`;

/**
 * The refusal or mistake as the page lists it: the sentence the package wrote. The sentence already names the position
 * (line and column in the pasted stylesheet, or in the compiled CSS for a plain CSS import), so the position is not
 * repeated as the runner's own prefix.
 */
function issueOf(err: StylesheetError | SassLessCompilerRunError): ToolIssue {
  return { message: err.message };
}

function bytesOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

export default defineTool({
  id: 'sass-less-compiler',
  // Compiling is real background work in a module worker, so this waits for a deliberate Run press and offers a Cancel
  // button while that work is in flight.
  autoRun: false,
  cancellable: true,
  runLimit: { ms: SASS_LESS_COMPILER_TIME_LIMIT_MS },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'language',
      label: 'Language',
      type: 'radio',
      default: 'scss',
      options: [
        { value: 'scss', label: 'SCSS' },
        { value: 'sass', label: 'Indented Sass' },
        { value: 'less', label: 'Less' },
      ],
    },
    {
      name: 'style',
      label: 'Output',
      type: 'radio',
      default: 'expanded',
      options: [
        { value: 'expanded', label: 'Expanded' },
        { value: 'compressed', label: 'Compressed' },
      ],
    },
    {
      name: 'source',
      label: 'Stylesheet',
      type: 'textarea',
      rows: 16,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Up to 256 KiB. Imports of other files and addresses are refused.',
    },
  ],
  examples: [
    { label: 'SCSS with variables, nesting and a built-in module', values: { language: 'scss', source: SCSS_EXAMPLE } },
    { label: 'Indented Sass with nesting', values: { language: 'sass', source: SASS_EXAMPLE } },
    { label: 'Less with a mixin and a guard', values: { language: 'less', source: LESS_EXAMPLE } },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const source = str(values, 'source');
    if (isBlankSource(source)) return { outputs: [] };
    const language = LANGUAGES.get(str(values, 'language', 'scss')) ?? 'scss';
    const style = STYLES.get(str(values, 'style', 'expanded')) ?? 'expanded';

    try {
      // A paste over the limit is refused here, before any worker starts.
      checkSource(source);
      const result = await compileInWorker({ source, language, style }, ctx);
      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Compiled CSS', language: 'css', value: result.css, download: 'compiled.css' },
      ];
      return {
        outputs,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
        stats: [
          ['Engine', result.engine],
          ['Source bytes', String(bytesOf(source))],
          ['CSS bytes', String(bytesOf(result.css))],
        ],
      };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof StylesheetError || err instanceof SassLessCompilerRunError) {
        return { outputs: [], errors: [issueOf(err)] };
      }
      return { outputs: [], errors: [{ message: 'Could not compile this stylesheet.' }] };
    }
  },
});
