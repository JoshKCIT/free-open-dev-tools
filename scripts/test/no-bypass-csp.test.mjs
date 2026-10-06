import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ROOT } from '../lib/catalog.mjs';

/**
 * HARD-05 (D-220): the browser tests prove the page policy by running with the policy in force. Playwright has an
 * option that switches the page policy off for a test context; one test that sets it would make every other proof in
 * that file meaningless while staying green. This test scans the Playwright config and every script file under
 * e2e for the option used as code (the name followed by optional spaces and a colon or an equals sign, bare or quoted
 * as an object key) and fails the build if it appears. Comments are removed first, so the rule can be written about in
 * prose. The scan is proved able to fail on a scratch copy of the real config.
 */

const OPTION = 'bypass' + 'CSP';
const USAGE = new RegExp(`(?<![A-Za-z0-9_$])["']?${OPTION}["']?\\s*[:=]`);

/** Removes line and block comments, keeping line breaks so reported line numbers stay right. */
export function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_all, lead) => lead);
}

/** The 1-based lines of `text` that use the option as code. */
export function bypassUsageLines(text) {
  const found = [];
  withoutComments(text)
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (USAGE.test(line)) found.push({ line: index + 1, text: line.trim() });
    });
  return found;
}

function scriptFilesUnder(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...scriptFilesUnder(path));
    else if (/\.(?:ts|mts|cts|js|mjs|cjs)$/.test(name)) files.push(path);
  }
  return files;
}

const SCANNED = [join(ROOT, 'playwright.config.ts'), ...scriptFilesUnder(join(ROOT, 'e2e'))];

describe('no test or configuration switches the page policy off', () => {
  it('scans the Playwright config and a real set of files under e2e', () => {
    expect(SCANNED).toContain(join(ROOT, 'playwright.config.ts'));
    expect(SCANNED.length).toBeGreaterThan(20);
    expect(SCANNED.some((path) => path.endsWith('csp.spec.ts'))).toBe(true);
    expect(SCANNED.some((path) => path.endsWith('csp-probe.ts'))).toBe(true);
  });

  for (const path of SCANNED) {
    it(`${relative(ROOT, path).replace(/\\/g, '/')} never sets the option`, () => {
      expect(bypassUsageLines(readFileSync(path, 'utf8'))).toEqual([]);
    });
  }

  it('matches the option as an object key, an assignment and a quoted key', () => {
    expect(bypassUsageLines(`test.use({ ${OPTION}: true });`)).toHaveLength(1);
    expect(bypassUsageLines(`const options = {}; options.${OPTION} = true;`)).toHaveLength(1);
    expect(bypassUsageLines(`newContext({ '${OPTION}' : true })`)).toHaveLength(1);
    expect(bypassUsageLines(`use: { ${OPTION}:true }`)).toHaveLength(1);
  });

  it('does not match prose in a comment, a longer name or a plain mention', () => {
    expect(bypassUsageLines(`// never set ${OPTION}: true here`)).toEqual([]);
    expect(bypassUsageLines(`/* ${OPTION} = true is forbidden */`)).toEqual([]);
    expect(bypassUsageLines(`const my${OPTION}Flag = 1; const ${OPTION}Other: number = 2;`)).toEqual([]);
    expect(bypassUsageLines(`the option named ${OPTION} is never used`)).toEqual([]);
  });

  it('fails on a scratch copy of the real config that sets the option', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fodt-bypass-'));
    try {
      const real = readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8');
      const scratch = join(dir, 'playwright.config.ts');
      writeFileSync(
        scratch,
        real.replace("trace: 'retain-on-failure',", `trace: 'retain-on-failure',\n    ${OPTION}: true,`),
      );
      const found = bypassUsageLines(readFileSync(scratch, 'utf8'));
      expect(found).toHaveLength(1);
      expect(found[0].text).toContain(OPTION);
      expect(bypassUsageLines(real)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
