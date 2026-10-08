import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { codeownersRows } from '../src/index';

// Expected values come from GitHub's "About code owners" page (blob a0ff66d59c8819c28c87e94c61195e175afd8ec2, CC BY 4.0,
// see test/fixtures/codeowners/UPSTREAM.md): the example file and the comments written beside its lines, re-typed as two
// files, 14 paths and 28 answers in docs-example.json. The deciding line is counted over every pasted line, comment
// lines included. The owners were also checked against the recorded codeowners 0.9.0 package.

interface DocsAnswer {
  file: 'A' | 'B';
  path: string;
  owners: string[];
  line: number | null;
}

interface DocsExample {
  blob: string;
  files: Record<'A' | 'B', string>;
  paths: string[];
  answers: DocsAnswer[];
}

const docs = JSON.parse(
  readFileSync(new URL('./fixtures/codeowners/docs-example.json', import.meta.url), 'utf8'),
) as DocsExample;

it('the documented example file gives the owners and deciding line GitHub describes for every listed path', () => {
  expect(docs.blob).toBe('a0ff66d59c8819c28c87e94c61195e175afd8ec2');
  expect(docs.paths).toHaveLength(14);
  expect(docs.answers).toHaveLength(28);
  for (const file of ['A', 'B'] as const) {
    const { rows, skipped } = codeownersRows(docs.files[file], docs.paths.join('\n'));
    // The documented example holds no line GitHub does not support.
    expect(skipped, `file ${file}`).toEqual([]);
    // One row for each path, in the order the paths were pasted.
    expect(rows.map((row) => row.path)).toEqual(docs.paths);
    for (const answer of docs.answers.filter((a) => a.file === file)) {
      const row = rows.find((r) => r.path === answer.path);
      expect(row?.owners, `${file} ${answer.path} owners`).toEqual(answer.owners);
      expect(row?.line, `${file} ${answer.path} deciding line`).toBe(answer.line);
    }
  }

  // The comments in the documentation, spelled out for the paths they talk about.
  const a = codeownersRows(docs.files.A, docs.paths.join('\n')).rows;
  const by = (path: string) => a.find((row) => row.path === path);
  // "*       @global-owner1 @global-owner2" is line 2, after the comment line.
  expect(by('README.md')).toMatchObject({ owners: ['@global-owner1', '@global-owner2'], line: 2, pattern: '*' });
  // "*.js    @js-owner #This is an inline comment." : the inline comment is not an owner.
  expect(by('src/app.js')).toMatchObject({ owners: ['@js-owner'], line: 3, pattern: '*.js' });
  // "**/logs @octocat" comes after "/build/logs/ @doctocat", so it decides build/logs/x.log.
  expect(by('build/logs/x.log')).toMatchObject({ owners: ['@octocat'], line: 11, pattern: '**/logs' });
  // "/apps/github" has no owners: the path has no owner, and that line is the one that decided it.
  expect(by('apps/github/readme.md')).toMatchObject({ owners: [], line: 13, pattern: '/apps/github' });
  // File B names @doctocat for the same path.
  const b = codeownersRows(docs.files.B, 'apps/github/readme.md').rows;
  expect(b[0]).toMatchObject({ owners: ['@doctocat'], line: 2 });
});

it('the last matching line wins and the owners of earlier lines are never merged', () => {
  // GitHub: "Order is important; the last matching pattern takes the most precedence." The example file's own comment
  // adds that a pull request that only changes JS files asks only @js-owner and not the global owners.
  const global = '* @global-owner1 @global-owner2\n';
  const js = '*.js @js-owner\n';
  const forward = codeownersRows(global + js, 'src/app.js\nREADME.md').rows;
  expect(forward[0]).toMatchObject({ path: 'src/app.js', owners: ['@js-owner'], line: 2 });
  expect(forward[1]).toMatchObject({ path: 'README.md', owners: ['@global-owner1', '@global-owner2'], line: 1 });

  // The same two lines the other way round: now the global line is the later one and decides, with its owners alone.
  const reversed = codeownersRows(js + global, 'src/app.js').rows;
  expect(reversed[0]).toMatchObject({ owners: ['@global-owner1', '@global-owner2'], line: 2 });
  expect(reversed[0]?.owners).not.toContain('@js-owner');

  // Three matching lines: only the last one's owners are shown.
  const three = codeownersRows('* @a\n*.js @b\nsrc/ @c @d\n', 'src/app.js').rows;
  expect(three[0]).toMatchObject({ owners: ['@c', '@d'], line: 3 });
});
