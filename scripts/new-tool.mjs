#!/usr/bin/env node
/**
 * Creates the skeleton for a new tool package from a catalog entry.
 *
 *   node scripts/new-tool.mjs <tool-id>
 *
 * It writes package.json, src/meta.json, a starter src/index.ts and a starter
 * test, then leaves the real work to you. Run `node scripts/sync-tools.mjs`
 * afterwards to fill in the generated files.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadCatalog } from './lib/catalog.mjs';

const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/new-tool.mjs <tool-id>');
  process.exit(1);
}

const entry = loadCatalog().find((c) => c.id === id);
if (!entry) {
  console.error(
    `"${id}" is not in docs/catalog.json, the list of every tool this project intends to have. Add an entry there first.`,
  );
  process.exit(1);
}

const dir = join(ROOT, 'tools', id);
if (existsSync(dir)) {
  console.error(`tools/${id} already exists.`);
  process.exit(1);
}

mkdirSync(join(dir, 'src'), { recursive: true });
mkdirSync(join(dir, 'test'), { recursive: true });

writeFileSync(
  join(dir, 'package.json'),
  JSON.stringify(
    {
      name: `@fodt/${id}`,
      version: '1.0.0',
      description: entry.summary,
      license: 'MIT',
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      files: ['dist', 'src', 'README.md', 'LICENSE'],
      sideEffects: false,
      scripts: {
        build: 'tsc -p tsconfig.json',
        test: 'vitest run',
        'test:watch': 'vitest',
      },
      devDependencies: { typescript: '^5.7.3', vitest: '^3.2.4' },
      repository: {
        type: 'git',
        url: 'https://github.com/JoshKCIT/free-open-dev-tools.git',
        directory: `tools/${id}`,
      },
    },
    null,
    2,
  ) + '\n',
);

writeFileSync(
  join(dir, 'src', 'meta.json'),
  JSON.stringify(
    {
      id,
      name: entry.name,
      summary: entry.summary,
      about: 'TODO: two or three sentences on what this does and when to reach for it.',
      supports: ['TODO'],
      limits: ['TODO: what this will not do. Never leave this empty.'],
      standards: [],
      primaryExport: 'run',
    },
    null,
    2,
  ) + '\n',
);

writeFileSync(
  join(dir, 'src', 'index.ts'),
  `import meta from './meta.json';

export { meta };

export function run(input: string): string {
  throw new Error('not implemented');
}
`,
);

writeFileSync(
  join(dir, 'test', 'index.test.ts'),
  `import { describe, it, expect } from 'vitest';
import { run } from '../src/index';

describe('${entry.name}', () => {
  it.todo('has tests written from the specification');
});
`,
);

console.log(`Created tools/${id}. Now write src/index.ts and test/, then run: node scripts/sync-tools.mjs`);
