#!/usr/bin/env node
/**
 * Keeps every tool folder self-contained and consistent.
 *
 * For each `tools/<id>` it writes the files that must never drift: the
 * standalone tsconfig, the standalone vitest config, the MIT licence, and the
 * README, which is generated from `src/meta.json` so the documentation on the
 * website and the documentation in the folder cannot disagree.
 *
 * It never touches `src/index.ts`, `test/`, or the dependency lists in
 * `package.json`. Those are hand-written per tool.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/catalog.mjs';

const TOOLS_DIR = join(ROOT, 'tools');
const OWNER = 'JoshKCIT';
const REPO = 'free-open-dev-tools';
const YEAR = 2026;
const HOLDER = 'Free & Open Dev Tools contributors';

const MIT = `MIT License

Copyright (c) ${YEAR} ${HOLDER}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    // DOM is here for the type declarations, not for the DOM itself. TextEncoder,
    // TextDecoder, atob and crypto are declared in it and exist in both Node 20+
    // and every browser, so a copied-out folder compiles without extra setup.
    // Using the document or window objects is separately forbidden by ESLint.
    lib: ['ES2022', 'DOM'],
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    noUncheckedIndexedAccess: true,
    declaration: true,
    declarationMap: true,
    sourceMap: true,
    resolveJsonModule: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    outDir: 'dist',
    rootDir: 'src',
  },
  include: ['src'],
};

const VITEST = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
`;

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function writeIfChanged(path, content) {
  const next = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n';
  if (existsSync(path) && readFileSync(path, 'utf8') === next) return false;
  writeFileSync(path, next);
  return true;
}

function bullets(items) {
  return items.map((i) => `- ${i}`).join('\n');
}

function buildReadme(id, meta, pkg) {
  const deps = Object.entries(pkg.dependencies ?? {});
  const usage = meta.usage ?? `import { ${meta.primaryExport ?? 'run'} } from '${pkg.name}';`;

  return `# ${meta.name}

${meta.summary}

Part of [Free & Open Dev Tools](https://github.com/${OWNER}/${REPO}). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

${meta.about}

## Supported

${bullets(meta.supports)}

## Limits

${bullets(meta.limits)}
${
  meta.ambiguities && meta.ambiguities.length
    ? `
## Ambiguous cases, and what this does about them

${bullets(meta.ambiguities)}
`
    : ''
}${
    meta.standards && meta.standards.length
      ? `
## Defined by

${meta.standards.map((s) => `- [${s.label}](${s.url})`).join('\n')}
`
      : ''
  }${
    meta.bundledData && meta.bundledData.length
      ? `
## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

${meta.bundledData.map((d) => `- **${d.name}** (${d.licence}) — [source](${d.source}). ${d.attribution}`).join('\n')}
`
      : ''
  }
## Use it on its own

\`\`\`sh
npx degit ${OWNER}/${REPO}/tools/${id} ${id}
cd ${id}
npm install
npm test
\`\`\`

## Install into a project

\`\`\`sh
npm install ${pkg.name}
\`\`\`

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

\`\`\`ts
${usage}
\`\`\`

${meta.apiNotes ?? ''}

## Dependencies

${
  deps.length === 0
    ? 'None. This package has no runtime dependencies.'
    : deps.map(([n, v]) => `- \`${n}\` ${v}`).join('\n')
}

## Tests

\`\`\`sh
npm test
\`\`\`

${meta.testNotes ?? 'Tests are written against the specifications listed above rather than against another implementation.'}

## Licence

MIT. See [LICENSE](./LICENSE).
`;
}

const ids = existsSync(TOOLS_DIR)
  ? readdirSync(TOOLS_DIR).filter((d) => statSync(join(TOOLS_DIR, d)).isDirectory())
  : [];

const manifest = {};
const problems = [];
let changed = 0;

for (const id of ids.sort()) {
  const dir = join(TOOLS_DIR, id);
  const pkgPath = join(dir, 'package.json');
  const metaPath = join(dir, 'src', 'meta.json');

  if (!existsSync(metaPath)) {
    problems.push(`${id}: missing src/meta.json`);
    continue;
  }
  // package.json is generated from meta.json so a new tool only needs its
  // logic, its tests and its metadata. Runtime dependencies are declared in
  // meta.json under "dependencies" and flow through to here.
  {
    const m = readJson(metaPath);
    const existing = existsSync(pkgPath) ? readJson(pkgPath) : {};
    writeIfChanged(pkgPath, {
      name: `@fodt/${id}`,
      version: existing.version ?? '1.0.0',
      description: m.summary,
      license: 'MIT',
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './meta.json': './src/meta.json' },
      files: ['dist', 'src', 'README.md', 'LICENSE'],
      sideEffects: false,
      keywords: m.keywords ?? [],
      scripts: { build: 'tsc -p tsconfig.json', test: 'vitest run', 'test:watch': 'vitest' },
      ...(m.dependencies && Object.keys(m.dependencies).length ? { dependencies: m.dependencies } : {}),
      devDependencies: { typescript: '^5.7.3', vitest: '^3.2.4', ...(m.devDependencies ?? {}) },
      repository: { type: 'git', url: 'https://github.com/JoshKCIT/free-open-dev-tools.git', directory: `tools/${id}` },
    });
  }
  if (!existsSync(join(dir, 'src', 'index.ts'))) {
    problems.push(`${id}: missing src/index.ts`);
    continue;
  }
  if (!existsSync(join(dir, 'test'))) {
    problems.push(`${id}: missing test/ directory`);
    continue;
  }

  const pkg = readJson(pkgPath);
  const meta = readJson(metaPath);

  if (meta.id !== id) problems.push(`${id}: src/meta.json declares id "${meta.id}"`);
  for (const key of ['name', 'summary', 'about', 'supports', 'limits']) {
    if (!meta[key] || (Array.isArray(meta[key]) && meta[key].length === 0)) {
      problems.push(`${id}: src/meta.json is missing a non-empty "${key}"`);
    }
  }

  if (writeIfChanged(join(dir, 'tsconfig.json'), TSCONFIG)) changed++;
  if (writeIfChanged(join(dir, 'vitest.config.ts'), VITEST)) changed++;
  if (writeIfChanged(join(dir, 'LICENSE'), MIT)) changed++;
  if (writeIfChanged(join(dir, 'README.md'), buildReadme(id, meta, pkg))) changed++;

  manifest[id] = {
    id,
    name: meta.name,
    version: pkg.version,
    license: pkg.license,
    dependencies: pkg.dependencies ?? {},
    keywords: meta.keywords ?? [],
  };
}

writeIfChanged(join(ROOT, 'apps', 'web', 'src', 'generated-tools.json'), manifest);

if (problems.length) {
  console.error('Tool folders are not consistent:\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`Synced ${ids.length} tool folders (${changed} file${changed === 1 ? '' : 's'} written).`);
