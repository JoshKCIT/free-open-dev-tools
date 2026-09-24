import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectBundledData, renderBundledDataSection } from '../lib/bundled-data.mjs';
import { ROOT } from '../lib/catalog.mjs';

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Writes a throwaway tool directory under `toolsDir`, with `src/meta.json` and any extra files. */
function writeTool(toolsDir, id, meta, files = {}) {
  mkdirSync(join(toolsDir, id, 'src'), { recursive: true });
  writeFileSync(join(toolsDir, id, 'src', 'meta.json'), JSON.stringify(meta));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(toolsDir, id, relativePath);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
}

describe('collectBundledData', () => {
  it('returns an empty list and no problems when no tool declares bundled data', () => {
    const toolsDir = makeTempDir('fodt-bundled-data-empty-');
    try {
      writeTool(toolsDir, 'plain-tool', { id: 'plain-tool' });
      const { entries, problems } = collectBundledData(toolsDir);
      expect(entries).toEqual([]);
      expect(problems).toEqual([]);
      expect(renderBundledDataSection(entries)).toBe('');
    } finally {
      rmSync(toolsDir, { recursive: true, force: true });
    }
  });

  it('collects one bundled entry carrying every declared field, including the notice text', () => {
    const toolsDir = makeTempDir('fodt-bundled-data-happy-');
    try {
      writeTool(
        toolsDir,
        'word-list-tool',
        {
          id: 'word-list-tool',
          bundledData: [
            {
              name: 'Example word list',
              source: 'https://example.com/wordlist',
              licence: 'CC BY 3.0',
              licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
              attribution: 'Example word list by Example Org, CC BY 3.0.',
              noticeFile: 'src/EXAMPLE-NOTICE.txt',
            },
          ],
        },
        { 'src/EXAMPLE-NOTICE.txt': 'This is the notice text.\n' },
      );

      const { entries, problems } = collectBundledData(toolsDir);

      expect(problems).toEqual([]);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        toolId: 'word-list-tool',
        name: 'Example word list',
        source: 'https://example.com/wordlist',
        licence: 'CC BY 3.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
        attribution: 'Example word list by Example Org, CC BY 3.0.',
      });
      expect(entries[0].noticeText).toContain('This is the notice text.');
    } finally {
      rmSync(toolsDir, { recursive: true, force: true });
    }
  });

  it('rejects an entry whose notice file does not exist, naming the tool, the entry and the missing path', () => {
    const toolsDir = makeTempDir('fodt-bundled-data-missing-notice-');
    try {
      writeTool(toolsDir, 'broken-tool', {
        id: 'broken-tool',
        bundledData: [
          {
            name: 'Missing notice data',
            source: 'https://example.com',
            licence: 'MIT',
            licenceUrl: 'https://opensource.org/licenses/MIT',
            attribution: 'Some attribution',
            noticeFile: 'src/DOES-NOT-EXIST.txt',
          },
        ],
      });

      const { entries, problems } = collectBundledData(toolsDir);

      expect(entries).toEqual([]);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('broken-tool');
      expect(problems[0]).toContain('Missing notice data');
      expect(problems[0]).toContain('src/DOES-NOT-EXIST.txt');
    } finally {
      rmSync(toolsDir, { recursive: true, force: true });
    }
  });

  it('rejects an entry whose notice file exists but is empty or whitespace-only', () => {
    const toolsDir = makeTempDir('fodt-bundled-data-empty-notice-');
    try {
      writeTool(
        toolsDir,
        'whitespace-tool',
        {
          id: 'whitespace-tool',
          bundledData: [
            {
              name: 'Whitespace notice data',
              source: 'https://example.com',
              licence: 'MIT',
              licenceUrl: 'https://opensource.org/licenses/MIT',
              attribution: 'Some attribution',
              noticeFile: 'src/BLANK-NOTICE.txt',
            },
          ],
        },
        { 'src/BLANK-NOTICE.txt': '   \n\t\n  ' },
      );

      const { entries, problems } = collectBundledData(toolsDir);

      expect(entries).toEqual([]);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('whitespace-tool');
      expect(problems[0]).toContain('Whitespace notice data');
      expect(problems[0]).toContain('empty');
    } finally {
      rmSync(toolsDir, { recursive: true, force: true });
    }
  });

  it('rejects an entry missing a required field, naming the tool, the entry and the missing field', () => {
    const toolsDir = makeTempDir('fodt-bundled-data-missing-field-');
    try {
      writeTool(
        toolsDir,
        'incomplete-tool',
        {
          id: 'incomplete-tool',
          bundledData: [
            {
              name: 'Incomplete data',
              source: 'https://example.com',
              licence: 'MIT',
              // licenceUrl deliberately omitted
              attribution: 'Some attribution',
              noticeFile: 'src/NOTICE.txt',
            },
          ],
        },
        { 'src/NOTICE.txt': 'Notice text.' },
      );

      const { entries, problems } = collectBundledData(toolsDir);

      expect(entries).toEqual([]);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('incomplete-tool');
      expect(problems[0]).toContain('licenceUrl');
    } finally {
      rmSync(toolsDir, { recursive: true, force: true });
    }
  });

  it('collects entries from two tools, ordered by tool id so output is stable across runs', () => {
    const toolsDir = makeTempDir('fodt-bundled-data-ordering-');
    try {
      writeTool(
        toolsDir,
        'zzz-tool',
        {
          id: 'zzz-tool',
          bundledData: [
            {
              name: 'Z data',
              source: 'https://example.com/z',
              licence: 'MIT',
              licenceUrl: 'https://opensource.org/licenses/MIT',
              attribution: 'Z attribution',
              noticeFile: 'src/NOTICE.txt',
            },
          ],
        },
        { 'src/NOTICE.txt': 'Z notice.' },
      );
      writeTool(
        toolsDir,
        'aaa-tool',
        {
          id: 'aaa-tool',
          bundledData: [
            {
              name: 'A data',
              source: 'https://example.com/a',
              licence: 'MIT',
              licenceUrl: 'https://opensource.org/licenses/MIT',
              attribution: 'A attribution',
              noticeFile: 'src/NOTICE.txt',
            },
          ],
        },
        { 'src/NOTICE.txt': 'A notice.' },
      );

      const { entries, problems } = collectBundledData(toolsDir);

      expect(problems).toEqual([]);
      expect(entries).toHaveLength(2);
      expect(entries[0].toolId).toBe('aaa-tool');
      expect(entries[1].toolId).toBe('zzz-tool');
    } finally {
      rmSync(toolsDir, { recursive: true, force: true });
    }
  });
});

describe('renderBundledDataSection', () => {
  it('returns an empty string for an empty list', () => {
    expect(renderBundledDataSection([])).toBe('');
  });

  const sampleEntries = [
    {
      toolId: 'word-list-tool',
      name: 'Example word list',
      source: 'https://example.com/wordlist',
      licence: 'CC BY 3.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
      attribution: 'Example word list by Example Org, CC BY 3.0.',
      noticeText: 'This is the full notice text.',
    },
  ];

  it('renders a section with a heading, a summary row per entry, and the full notice text per entry', () => {
    const section = renderBundledDataSection(sampleEntries);
    expect(section).toContain('## Bundled data');
    expect(section).toContain('Example word list');
    expect(section).toContain('CC BY 3.0');
    expect(section).toContain('word-list-tool');
    expect(section).toContain('Example word list by Example Org, CC BY 3.0.');
    expect(section).toContain('This is the full notice text.');
  });

  it('renders the same list twice identically, so a second run of the gate never dirties the working tree', () => {
    const first = renderBundledDataSection(sampleEntries);
    const second = renderBundledDataSection(sampleEntries);
    expect(first).toBe(second);
  });
});

describe('the real check-licenses.mjs script, run against a temporary repository fixture', () => {
  function makeFixtureRepo({ noticeContent }) {
    const dir = makeTempDir('fodt-check-licenses-fixture-');
    mkdirSync(join(dir, 'tools', 'fixture-tool', 'src'), { recursive: true });
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'tools', 'fixture-tool', 'package.json'),
      JSON.stringify({ name: '@fodt/fixture-tool', dependencies: {} }),
    );
    writeFileSync(join(dir, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@fodt/web', dependencies: {} }));

    const noticeFile = 'FIXTURE-NOTICE.txt';
    if (noticeContent !== null) {
      writeFileSync(join(dir, 'tools', 'fixture-tool', noticeFile), noticeContent);
    }

    writeFileSync(
      join(dir, 'tools', 'fixture-tool', 'src', 'meta.json'),
      JSON.stringify({
        id: 'fixture-tool',
        bundledData: [
          {
            name: 'Fixture data',
            source: 'https://example.com/fixture',
            licence: 'CC0-1.0',
            licenceUrl: 'https://example.com/licence',
            attribution: 'Fixture data by Example.',
            noticeFile,
          },
        ],
      }),
    );

    return dir;
  }

  function runCheckLicenses(rootDir) {
    try {
      const stdout = execFileSync('node', [join(ROOT, 'scripts', 'check-licenses.mjs')], {
        cwd: ROOT,
        env: { ...process.env, FODT_CHECK_LICENSES_ROOT: rootDir },
        encoding: 'utf8',
      });
      return { status: 0, stdout, stderr: '' };
    } catch (err) {
      return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
  }

  it('exits 0 for a valid notice', () => {
    const dir = makeFixtureRepo({ noticeContent: 'A real notice.\n' });
    try {
      const result = runCheckLicenses(dir);
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits non-zero, naming the tool and the path, for a missing notice file', () => {
    const dir = makeFixtureRepo({ noticeContent: null });
    try {
      const result = runCheckLicenses(dir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('fixture-tool');
      expect(result.stderr).toContain('FIXTURE-NOTICE.txt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits non-zero for an empty notice file', () => {
    const dir = makeFixtureRepo({ noticeContent: '   \n  ' });
    try {
      const result = runCheckLicenses(dir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('fixture-tool');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
