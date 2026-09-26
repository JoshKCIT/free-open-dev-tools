import { meta, buildTsconfig, findOption, TsconfigBuilderError, PRESETS } from '@fodt/tsconfig-builder';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

const LIB_PRESETS: { value: string; label: string }[] = [
  { value: '', label: '(let target decide)' },
  { value: 'es2022', label: 'ES2022' },
  { value: 'es2022-dom', label: 'ES2022 + DOM' },
  { value: 'esnext-dom', label: 'ESNext + DOM' },
  { value: 'es2015', label: 'ES2015' },
];

function libsFor(preset: string): readonly string[] {
  switch (preset) {
    case 'es2022':
      return ['es2022'];
    case 'es2022-dom':
      return ['es2022', 'dom', 'dom.iterable'];
    case 'esnext-dom':
      return ['esnext', 'dom', 'dom.iterable'];
    case 'es2015':
      return ['es2015'];
    default:
      return [];
  }
}

function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseExtraOptions(text: string): { pairs: Record<string, string>; problems: string[] } {
  const pairs: Record<string, string> = {};
  const problems: string[] = [];
  let lineNo = 0;
  for (const rawLine of text.split('\n')) {
    lineNo++;
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) {
      problems.push(`Line ${lineNo}: "${line}" is not in the form name=value, so it was ignored.`);
      continue;
    }
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!name) {
      problems.push(`Line ${lineNo}: no option name before "=", so it was ignored.`);
      continue;
    }
    pairs[name] = value;
  }
  return { pairs, problems };
}

const EXAMPLE_INCLUDE = 'src';

export default defineTool({
  id: 'tsconfig-builder',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'preset',
      label: 'Starting preset',
      type: 'select',
      default: '',
      options: [{ value: '', label: '(none)' }, ...PRESETS.map((p) => ({ value: p.id, label: p.label }))],
      help: 'Fills in a recommended starting set of options; every checkbox and select below still overrides it.',
    },
    {
      name: 'target',
      label: 'Target',
      type: 'select',
      default: '',
      options: [
        { value: '', label: '(default)' },
        { value: 'es2020', label: 'ES2020' },
        { value: 'es2021', label: 'ES2021' },
        { value: 'es2022', label: 'ES2022' },
        { value: 'es2023', label: 'ES2023' },
        { value: 'es2024', label: 'ES2024' },
        { value: 'esnext', label: 'ESNext' },
      ],
    },
    {
      name: 'module',
      label: 'Module',
      type: 'select',
      default: '',
      options: [
        { value: '', label: '(default)' },
        { value: 'nodenext', label: 'nodenext' },
        { value: 'node18', label: 'node18' },
        { value: 'preserve', label: 'preserve' },
        { value: 'esnext', label: 'esnext' },
        { value: 'commonjs', label: 'commonjs' },
      ],
    },
    {
      name: 'moduleResolution',
      label: 'Module resolution',
      type: 'select',
      default: '',
      options: [
        { value: '', label: '(default)' },
        { value: 'nodenext', label: 'nodenext' },
        { value: 'node16', label: 'node16' },
        { value: 'bundler', label: 'bundler' },
        { value: 'node10', label: 'node10 (deprecated in TypeScript 6.0)' },
      ],
    },
    {
      name: 'jsx',
      label: 'JSX',
      type: 'select',
      default: '',
      options: [
        { value: '', label: '(none)' },
        { value: 'react-jsx', label: 'react-jsx' },
        { value: 'react-jsxdev', label: 'react-jsxdev' },
        { value: 'preserve', label: 'preserve' },
        { value: 'react', label: 'react (classic)' },
      ],
    },
    { name: 'libPreset', label: 'Lib', type: 'select', default: '', options: LIB_PRESETS },
    { name: 'strict', label: 'strict', type: 'checkbox', default: false },
    { name: 'noUncheckedIndexedAccess', label: 'noUncheckedIndexedAccess', type: 'checkbox', default: false },
    { name: 'exactOptionalPropertyTypes', label: 'exactOptionalPropertyTypes', type: 'checkbox', default: false },
    { name: 'declaration', label: 'declaration', type: 'checkbox', default: false },
    { name: 'sourceMap', label: 'sourceMap', type: 'checkbox', default: false },
    { name: 'noEmit', label: 'noEmit', type: 'checkbox', default: false },
    { name: 'skipLibCheck', label: 'skipLibCheck', type: 'checkbox', default: false },
    { name: 'verbatimModuleSyntax', label: 'verbatimModuleSyntax', type: 'checkbox', default: false },
    { name: 'isolatedModules', label: 'isolatedModules', type: 'checkbox', default: false },
    {
      name: 'extraOptions',
      label: 'Extra options',
      type: 'textarea',
      rows: 4,
      default: '',
      help: 'One name=value per line, for any other catalogued option (for example outDir=dist).',
    },
    { name: 'include', label: 'include', type: 'textarea', rows: 2, default: '', help: 'One glob per line.' },
    { name: 'exclude', label: 'exclude', type: 'textarea', rows: 2, default: '', help: 'One glob per line.' },
    {
      name: 'extendsPath',
      label: 'extends',
      type: 'text',
      default: '',
      help: 'A path to a base tsconfig.json to extend, if any.',
    },
    { name: 'comments', label: 'Explain each option with a comment', type: 'checkbox', default: false },
  ],
  examples: [{ label: 'Node.js library preset', values: { preset: 'node-library', include: EXAMPLE_INCLUDE } }],
  run(values): ToolResult {
    const manualOptions: Record<string, boolean | string | readonly string[]> = {};
    if (bool(values, 'strict')) manualOptions.strict = true;
    if (bool(values, 'noUncheckedIndexedAccess')) manualOptions.noUncheckedIndexedAccess = true;
    if (bool(values, 'exactOptionalPropertyTypes')) manualOptions.exactOptionalPropertyTypes = true;
    if (bool(values, 'declaration')) manualOptions.declaration = true;
    if (bool(values, 'sourceMap')) manualOptions.sourceMap = true;
    if (bool(values, 'noEmit')) manualOptions.noEmit = true;
    if (bool(values, 'skipLibCheck')) manualOptions.skipLibCheck = true;
    if (bool(values, 'verbatimModuleSyntax')) manualOptions.verbatimModuleSyntax = true;
    if (bool(values, 'isolatedModules')) manualOptions.isolatedModules = true;

    const target = str(values, 'target');
    if (target) manualOptions.target = target;
    const moduleValue = str(values, 'module');
    if (moduleValue) manualOptions.module = moduleValue;
    const moduleResolution = str(values, 'moduleResolution');
    if (moduleResolution) manualOptions.moduleResolution = moduleResolution;
    const jsx = str(values, 'jsx');
    if (jsx) manualOptions.jsx = jsx;
    const libPreset = str(values, 'libPreset');
    if (libPreset) manualOptions.lib = libsFor(libPreset);

    const { pairs: extraPairs, problems: extraProblems } = parseExtraOptions(str(values, 'extraOptions'));
    Object.assign(manualOptions, extraPairs);

    const preset = str(values, 'preset');

    try {
      const result = buildTsconfig({
        preset: preset || undefined,
        options: manualOptions,
        include: parseLines(str(values, 'include')),
        exclude: parseLines(str(values, 'exclude')),
        extendsPath: str(values, 'extendsPath') || undefined,
        comments: bool(values, 'comments'),
      });

      const rows = Object.entries(result.object.compilerOptions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => {
          const option = findOption(name);
          return [
            name,
            Array.isArray(value) ? value.join(', ') : String(value),
            option?.explanation ?? '',
            option?.docsUrl ?? '',
          ];
        });

      const warnings = [...extraProblems, ...result.warnings, ...result.conflicts.map((c) => c.message)];

      const outputs: ToolResult['outputs'] = [
        { kind: 'code', label: 'tsconfig.json', language: 'json', value: result.output, download: 'tsconfig.json' },
      ];
      if (rows.length > 0) {
        outputs.push({
          kind: 'table',
          label: 'Why each option',
          table: { headers: ['Option', 'Value', 'What it does', 'Reference'], rows, mono: [0, 1] },
        });
      }

      return {
        outputs,
        warnings: warnings.length > 0 ? warnings : undefined,
        stats: [['Options set', String(rows.length)]],
      };
    } catch (err) {
      if (err instanceof TsconfigBuilderError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      throw err;
    }
  },
});
