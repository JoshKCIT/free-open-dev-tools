import { meta, buildPackageJson, findField, SPDX_LICENSES } from '@fodt/package-json-generator';
import { defineTool, str, bool, type ToolResult } from '../lib/tool-ui';

function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function parsePairs(text: string, sep: string): { a: string; b: string }[] {
  const out: { a: string; b: string }[] = [];
  for (const line of parseLines(text)) {
    const i = line.indexOf(sep);
    if (i === -1) continue;
    const a = line.slice(0, i).trim();
    const b = line.slice(i + sep.length).trim();
    if (a && b) out.push({ a, b });
  }
  return out;
}

function parseSpecifiers(text: string): { name: string; specifier: string }[] {
  const out: { name: string; specifier: string }[] = [];
  for (const line of parseLines(text)) {
    // "name@specifier" -- searching from index 1 (not 0) skips a scoped
    // name's own leading '@', so this finds the real name/specifier
    // separator whether or not the specifier itself contains another '@'
    // (an npm: alias, or a scoped alias target).
    const at = line.indexOf('@', 1);
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    const specifier = line.slice(at + 1).trim();
    if (name && specifier) out.push({ name, specifier });
  }
  return out;
}

const LICENSE_OPTIONS = [
  { value: '', label: '(none)' },
  ...SPDX_LICENSES.map((id) => ({ value: id, label: id })),
  { value: 'UNLICENSED', label: 'UNLICENSED' },
];

export default defineTool({
  id: 'package-json-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'name', label: 'name', type: 'text', default: '', placeholder: 'my-lib or @scope/my-lib' },
    { name: 'version', label: 'version', type: 'text', default: '1.0.0' },
    { name: 'description', label: 'description', type: 'text', default: '' },
    { name: 'author', label: 'author', type: 'text', default: '' },
    { name: 'homepage', label: 'homepage', type: 'text', default: '' },
    { name: 'repository', label: 'repository', type: 'text', default: '', help: 'A git URL.' },
    { name: 'license', label: 'license', type: 'select', default: '', options: LICENSE_OPTIONS },
    {
      name: 'type',
      label: 'type',
      type: 'select',
      default: '',
      options: [
        { value: '', label: '(omit)' },
        { value: 'module', label: 'module' },
        { value: 'commonjs', label: 'commonjs' },
      ],
    },
    { name: 'main', label: 'main', type: 'text', default: '' },
    {
      name: 'exports',
      label: 'exports',
      type: 'textarea',
      rows: 3,
      default: '',
      help: 'One subpath=target per line, for example .=./index.js',
    },
    { name: 'bin', label: 'bin', type: 'textarea', rows: 2, default: '', help: 'One command=path per line.' },
    { name: 'scripts', label: 'scripts', type: 'textarea', rows: 3, default: '', help: 'One name=command per line.' },
    {
      name: 'dependencies',
      label: 'dependencies',
      type: 'textarea',
      rows: 3,
      default: '',
      help: 'One name@specifier per line, for example lodash@^4.17.21',
    },
    { name: 'devDependencies', label: 'devDependencies', type: 'textarea', rows: 2, default: '' },
    { name: 'peerDependencies', label: 'peerDependencies', type: 'textarea', rows: 2, default: '' },
    { name: 'files', label: 'files', type: 'textarea', rows: 2, default: '', help: 'One glob per line.' },
    { name: 'keywords', label: 'keywords', type: 'textarea', rows: 2, default: '', help: 'One keyword per line.' },
    { name: 'engineNode', label: 'engines.node', type: 'text', default: '', placeholder: '>=20' },
    { name: 'private', label: 'private', type: 'checkbox', default: false },
  ],
  examples: [
    {
      label: 'A scoped library',
      values: {
        name: '@scope/my-lib',
        version: '1.0.0',
        description: 'A scoped library.',
        license: 'MIT',
        bin: 'my-lib=./bin/cli.js',
        scripts: 'build=tsc',
      },
    },
  ],
  run(values): ToolResult {
    const result = buildPackageJson({
      name: str(values, 'name'),
      version: str(values, 'version'),
      description: str(values, 'description'),
      author: str(values, 'author'),
      homepage: str(values, 'homepage'),
      repository: str(values, 'repository'),
      license: str(values, 'license'),
      type: (str(values, 'type') || undefined) as 'module' | 'commonjs' | undefined,
      main: str(values, 'main'),
      exports: parsePairs(str(values, 'exports'), '=').map(({ a, b }) => ({ subpath: a, target: b })),
      bin: parsePairs(str(values, 'bin'), '=').map(({ a, b }) => ({ command: a, path: b })),
      scripts: parsePairs(str(values, 'scripts'), '=').map(({ a, b }) => ({ name: a, command: b })),
      dependencies: parseSpecifiers(str(values, 'dependencies')),
      devDependencies: parseSpecifiers(str(values, 'devDependencies')),
      peerDependencies: parseSpecifiers(str(values, 'peerDependencies')),
      files: parseLines(str(values, 'files')),
      keywords: parseLines(str(values, 'keywords')),
      engineNode: str(values, 'engineNode'),
      private: bool(values, 'private'),
    });

    const rows = Object.entries(result.object).map(([name, value]) => {
      const field = findField(name);
      const display = typeof value === 'string' ? value : JSON.stringify(value);
      return [name, field?.readBy ?? '', field?.explanation ?? '', field?.docsUrl ?? '', display];
    });

    const outputs: ToolResult['outputs'] = [
      { kind: 'code', label: 'package.json', language: 'json', value: result.output, download: 'package.json' },
    ];
    if (rows.length > 0) {
      outputs.push({
        kind: 'table',
        label: 'Fields',
        table: { headers: ['Field', 'Read by', 'What it does', 'Reference', 'Value'], rows, mono: [0, 4] },
      });
    }

    const warnings = [...result.problems, ...result.warnings];

    return {
      outputs,
      warnings: warnings.length > 0 ? warnings : undefined,
      stats: [['Fields set', String(rows.length)]],
    };
  },
});
