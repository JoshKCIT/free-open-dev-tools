/**
 * Uses the real, pinned TypeScript compiler (a devDependency only, per
 * D-80 -- see the TS-ORACLE-PINNED structural check) as an oracle for every
 * option, value, preset and conflict rule this package's catalogue claims.
 *
 * Sources fetched and quoted this session:
 * - TypeScript 6.0 Release Notes, "Breaking Changes and Deprecations"
 *   (https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
 * - TSConfig Reference (https://www.typescriptlang.org/tsconfig/)
 */
import ts from 'typescript';
import { it, expect, vi } from 'vitest';
import { OPTIONS } from '../src/options-catalogue';
import { PRESETS } from '../src/presets';
import { buildTsconfig } from '../src/index';

function convertErrors(json: Record<string, unknown>): readonly ts.Diagnostic[] {
  return ts.convertCompilerOptionsFromJson(json, '/virtual').errors;
}

function makeHost(compilerOptions: ts.CompilerOptions) {
  const files: Record<string, string> = { '/virtual/a.ts': 'export const x = 1;\n' };
  const host = ts.createCompilerHost(compilerOptions);
  host.getSourceFile = (fileName, lv) => {
    const text = files[fileName] ?? ts.sys.readFile(fileName);
    if (text === undefined) return undefined;
    return ts.createSourceFile(fileName, text, lv, true);
  };
  host.fileExists = (fileName) => fileName in files || ts.sys.fileExists(fileName);
  host.readFile = (fileName) => files[fileName] ?? ts.sys.readFile(fileName);
  return host;
}

function optionDiagnosticCodes(jsonOptions: Record<string, unknown>): number[] {
  const { options, errors } = ts.convertCompilerOptionsFromJson(jsonOptions, '/virtual');
  if (errors.length > 0) throw new Error('bad test input: ' + errors.map((e) => e.messageText).join(', '));
  const host = makeHost(options);
  const program = ts.createProgram(['/virtual/a.ts'], options, host);
  return program.getOptionsDiagnostics().map((d) => d.code);
}

it('every option in the catalogue is accepted by the TypeScript 5 compiler with every value the catalogue offers', () => {
  for (const option of OPTIONS) {
    const values: unknown[] =
      option.type === 'boolean'
        ? [true, false]
        : option.type === 'enum'
          ? [...(option.values ?? [])]
          : option.type === 'list'
            ? option.values
              ? option.values.map((v) => [v])
              : [['./virtual-dir']]
            : ['./virtual-value'];
    for (const value of values) {
      const errors = convertErrors({ [option.name]: value });
      expect(
        errors,
        `${option.name} = ${JSON.stringify(value)}: ${errors.map((e) => e.messageText).join(', ')}`,
      ).toEqual([]);
    }
  }
});

it('every preset parses with parseJsonConfigFileContent with no errors', () => {
  for (const preset of PRESETS) {
    const parsed = ts.parseJsonConfigFileContent(
      { compilerOptions: preset.options, files: ['/virtual/a.ts'] },
      ts.sys,
      '/virtual',
    );
    const realErrors = parsed.errors.filter((e) => e.code !== 18003);
    expect(realErrors, `${preset.id}: ${realErrors.map((e) => e.messageText).join(', ')}`).toEqual([]);
  }
});

it('the compiler reports no option diagnostics for any preset', () => {
  for (const preset of PRESETS) {
    const codes = optionDiagnosticCodes({ ...preset.options });
    expect(codes, `${preset.id}: ${codes.join(', ')}`).toEqual([]);
  }
});

it('each option conflict the builder warns about is one the compiler also reports, and none the compiler reports on the battery is missed', () => {
  const battery: { name: string; options: Record<string, unknown> }[] = [
    {
      name: 'bundler resolution with an old module',
      options: { module: 'commonjs', moduleResolution: 'bundler', noEmit: true },
    },
    {
      name: 'bundler resolution with node18 module',
      options: { module: 'node18', moduleResolution: 'bundler', noEmit: true },
    },
    {
      name: 'nodenext module with bundler resolution',
      options: { module: 'nodenext', moduleResolution: 'bundler', noEmit: true },
    },
    {
      name: 'node16 module with classic resolution',
      options: { module: 'node16', moduleResolution: 'classic', noEmit: true },
    },
    { name: 'emitDeclarationOnly without declaration', options: { emitDeclarationOnly: true, noEmit: false } },
    { name: 'isolatedDeclarations without declaration', options: { isolatedDeclarations: true, noEmit: true } },
    { name: 'declarationMap without declaration', options: { declarationMap: true, noEmit: true } },
    {
      name: 'allowImportingTsExtensions without noEmit or emitDeclarationOnly',
      options: { allowImportingTsExtensions: true, module: 'esnext', moduleResolution: 'bundler' },
    },
    { name: 'outFile with an unsupported module', options: { outFile: 'out.js', module: 'esnext' } },
    { name: 'outFile with amd (allowed, no conflict)', options: { outFile: 'out.js', module: 'amd' } },
    { name: 'inlineSourceMap with sourceMap', options: { inlineSourceMap: true, sourceMap: true, noEmit: true } },
    { name: 'composite with declaration explicitly false', options: { composite: true, declaration: false } },
    {
      name: 'node-library preset shape (clean control)',
      options: { module: 'nodenext', moduleResolution: 'nodenext', declaration: true, strict: true },
    },
    {
      name: 'bundler-app preset shape (clean control)',
      options: { module: 'esnext', moduleResolution: 'bundler', noEmit: true, esModuleInterop: true },
    },
  ];

  for (const entry of battery) {
    const realCodes = optionDiagnosticCodes(entry.options).sort((a, b) => a - b);
    const { conflicts } = buildTsconfig({ options: entry.options as Record<string, boolean | string> });
    const ourCodes = conflicts.map((c) => c.code).sort((a, b) => a - b);
    // De-duplicated comparison: two of our rules can share one compiler code
    // (5069 covers three different option names), while the compiler itself
    // only ever reports it once per distinct message.
    const realSet = [...new Set(realCodes)];
    const ourSet = [...new Set(ourCodes)];
    expect(ourSet, `${entry.name}: our=${ourSet.join(',')} real=${realSet.join(',')}`).toEqual(realSet);
  }
}, 15000);

it('every option carries an explanation and its tsconfig reference link', () => {
  for (const option of OPTIONS) {
    expect(option.explanation.length, option.name).toBeGreaterThan(10);
    expect(option.docsUrl, option.name).toContain('typescriptlang.org/tsconfig/#');
  }
});

it('options deprecated by TypeScript 6.0 are flagged as the release notes list them', () => {
  const flagged = OPTIONS.filter((o) => o.ts6 && o.ts6.length > 0);
  expect(flagged.length).toBeGreaterThanOrEqual(6);

  const cases: { options: Record<string, boolean | string>; expectSubstring: string }[] = [
    { options: { downlevelIteration: true }, expectSubstring: 'downlevelIteration' },
    { options: { baseUrl: './src' }, expectSubstring: 'baseUrl' },
    { options: { moduleResolution: 'node', module: 'commonjs' }, expectSubstring: 'moduleResolution' },
    { options: { module: 'amd' }, expectSubstring: 'module' },
    { options: { alwaysStrict: false }, expectSubstring: 'alwaysStrict' },
    { options: { esModuleInterop: false }, expectSubstring: 'esModuleInterop' },
    { options: { outFile: 'out.js', module: 'amd' }, expectSubstring: 'outFile' },
    { options: { target: 'es5' }, expectSubstring: 'target' },
  ];
  for (const c of cases) {
    const { warnings } = buildTsconfig({ options: c.options });
    const hit = warnings.some(
      (w) => w.includes(c.expectSubstring) && (w.includes('deprecated') || w.includes('removed')),
    );
    expect(hit, `${JSON.stringify(c.options)} -> ${warnings.join(' | ')}`).toBe(true);
  }
});

it('output with explanation comments parses to the same configuration as the plain output', () => {
  const input = {
    preset: 'node-library',
    options: { noUncheckedIndexedAccess: true, jsx: 'react-jsx' as const },
    include: ['src'],
    exclude: ['dist'],
  };
  const plain = buildTsconfig(input);
  const commented = buildTsconfig({ ...input, comments: true });
  expect(commented.output).not.toEqual(plain.output);
  expect(commented.output).toContain('//');

  const plainParsed = ts.parseConfigFileTextToJson('tsconfig.json', plain.output);
  const commentedParsed = ts.parseConfigFileTextToJson('tsconfig.json', commented.output);
  expect(plainParsed.error).toBeUndefined();
  expect(commentedParsed.error).toBeUndefined();
  expect(commentedParsed.config).toEqual(plainParsed.config);
});

it('nothing is written to the console while building', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    buildTsconfig({ preset: 'node-library' });
    buildTsconfig({
      options: { module: 'nodenext', moduleResolution: 'bundler', bogus: true } as unknown as Record<
        string,
        boolean | string
      >,
    });
    buildTsconfig({ options: { target: 'es5' }, comments: true });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  }
});
