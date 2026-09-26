import { expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeGitignore, listTemplates, GITIGNORE_TEMPLATES, GITIGNORE_COMMIT } from '../src/index';
import { buildTemplates } from './build-templates';
import { readUpstreamShas, gitBlobShaOfFile } from './upstream';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'github-gitignore');
const TREE = JSON.parse(readFileSync(join(FIXTURES_DIR, 'tree.json'), 'utf8')).tree as {
  path: string;
  mode: string;
  type: string;
  sha: string;
}[];

it('every bundled template is byte-identical to its github gitignore blob at the pinned commit', () => {
  const byPath = new Map(TREE.map((entry) => [entry.path, entry.sha]));
  expect(GITIGNORE_TEMPLATES.length).toBeGreaterThan(0);
  for (const template of GITIGNORE_TEMPLATES) {
    const expectedSha = byPath.get(template.path);
    expect(expectedSha, `no tree entry for ${template.path}`).toBeDefined();
    const actualSha = gitBlobShaOfFile(join(FIXTURES_DIR, ...template.path.split('/')));
    expect(actualSha, `${template.path} does not match its recorded blob SHA`).toBe(expectedSha);
  }
});

it('the bundled templates are exactly the root and Global templates at the pinned commit', () => {
  const realTreePaths = new Set(
    TREE.filter((entry) => entry.type === 'blob' && entry.mode !== '120000' && entry.path.endsWith('.gitignore'))
      .filter((entry) => {
        const segments = entry.path.split('/');
        return segments.length === 1 || (segments.length === 2 && segments[0] === 'Global');
      })
      .map((entry) => entry.path),
  );
  const bundledPaths = new Set(GITIGNORE_TEMPLATES.map((t) => t.path));
  expect(bundledPaths).toEqual(realTreePaths);
});

it('the bundled templates are exactly what the generator builds from the upstream tree', () => {
  const fresh = buildTemplates(FIXTURES_DIR, TREE);
  expect(fresh.templates).toEqual(GITIGNORE_TEMPLATES);
});

it('selected templates are joined in the order chosen under a header naming each source template', () => {
  const result = composeGitignore({ templates: ['Node', 'macOS'] });
  expect(result.unknown).toEqual([]);
  expect(result.used.map((u) => u.name)).toEqual(['Node', 'macOS']);
  const nodeIndex = result.output.indexOf('### Node ###');
  const macIndex = result.output.indexOf('### macOS ###');
  expect(nodeIndex).toBeGreaterThanOrEqual(0);
  expect(macIndex).toBeGreaterThan(nodeIndex);
  const nodeContent = GITIGNORE_TEMPLATES.find((t) => t.name === 'Node')!.content;
  const macContent = GITIGNORE_TEMPLATES.find((t) => t.name === 'macOS')!.content;
  expect(result.output).toContain(`### Node ###\n${nodeContent}`);
  expect(result.output).toContain(`### macOS ###\n${macContent}`);
});

it('an unknown template name is listed with the closest names instead of being dropped', () => {
  const result = composeGitignore({ templates: ['Pythn'] });
  expect(result.used).toEqual([]);
  expect(result.unknown).toHaveLength(1);
  expect(result.unknown[0]!.name).toBe('Pythn');
  expect(result.unknown[0]!.suggestions).toContain('Python');
});

it('template names match case-insensitively against a name or a file name', () => {
  const byName = composeGitignore({ templates: ['node'] });
  expect(byName.used.map((u) => u.name)).toEqual(['Node']);
  const byFileName = composeGitignore({ templates: ['NODE.GITIGNORE'] });
  expect(byFileName.used.map((u) => u.name)).toEqual(['Node']);
});

it('a repeated template name is used only once, and extra lines get their own Custom section', () => {
  const result = composeGitignore({ templates: ['Node', 'node'], extra: 'my-secret.env\n' });
  expect(result.used).toHaveLength(1);
  expect(result.output).toContain('### Custom ###\nmy-secret.env\n');
});

it('git check-ignore agrees with the composed file on a sample tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitignore-generator-'));
  execFileSync('git', ['init', '--quiet'], { cwd: dir });

  const result = composeGitignore({ templates: ['Node', 'macOS'] });
  writeFileSync(join(dir, '.gitignore'), result.output);

  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'a.js'), '// placeholder\n');
  writeFileSync(join(dir, '.DS_Store'), 'placeholder');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.js'), '// placeholder\n');

  const stdinPaths = 'node_modules/a.js\n.DS_Store\nsrc/index.js\n';
  const output = execFileSync('git', ['check-ignore', '--no-index', '-v', '--stdin'], {
    cwd: dir,
    input: stdinPaths,
    encoding: 'utf8',
  });

  expect(output).toMatch(/node_modules\/a\.js/);
  expect(output).toMatch(/\.DS_Store/);
  expect(output).not.toMatch(/src\/index\.js/);
});

it('every vendored upstream file matches the git blob SHA recorded in UPSTREAM.md', () => {
  const upstreamMd = readFileSync(join(FIXTURES_DIR, 'UPSTREAM.md'), 'utf8');
  const entries = readUpstreamShas(upstreamMd);
  expect(entries.length).toBeGreaterThan(200);
  for (const entry of entries) {
    const actual = gitBlobShaOfFile(join(FIXTURES_DIR, ...entry.path.split('/')));
    expect(actual, `${entry.path} does not match UPSTREAM.md`).toBe(entry.sha);
  }
});

it('nothing is written to the console while composing', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    composeGitignore({ templates: ['Node', 'macOS', 'Bogus'], extra: 'x' });
    listTemplates();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('GITIGNORE_COMMIT is the 40-character pinned commit SHA', () => {
  expect(GITIGNORE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
});
