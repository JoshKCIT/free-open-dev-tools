#!/usr/bin/env node
/**
 * Writes the release manifest: what shipped, from which commit, and what was
 * actually verified about it.
 *
 * It reads real results rather than restating intentions. Anything it could not
 * read is recorded as "not run", never as passing, because a manifest that
 * guesses is worse than no manifest.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, loadCatalog } from './lib/catalog.mjs';

function git(args, fallback = 'unknown') {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

const commit = process.env.GITHUB_SHA ?? git(['rev-parse', 'HEAD']);
const shortCommit = commit.slice(0, 8);
const branch = process.env.GITHUB_REF_NAME ?? git(['rev-parse', '--abbrev-ref', 'HEAD']);
const dirty = git(['status', '--porcelain']) !== '';
const builtAt = new Date().toISOString();

const toolsDir = join(ROOT, 'tools');
const ids = readdirSync(toolsDir)
  .filter((d) => statSync(join(toolsDir, d)).isDirectory())
  .sort();

const catalog = loadCatalog();

/** Reads the vitest JSON report if one was produced, so counts are real. */
function unitResults() {
  const path = join(ROOT, 'test-results', 'unit.json');
  if (!existsSync(path)) return null;
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    const perTool = {};
    for (const suite of report.testResults ?? []) {
      const match = /tools[\\/]([^\\/]+)[\\/]test/.exec(suite.name ?? '');
      if (!match) continue;
      const id = match[1];
      const bucket = (perTool[id] ??= { passed: 0, failed: 0 });
      for (const t of suite.assertionResults ?? []) {
        if (t.status === 'passed') bucket.passed++;
        else if (t.status === 'failed') bucket.failed++;
      }
    }
    return {
      total: report.numTotalTests ?? 0,
      passed: report.numPassedTests ?? 0,
      failed: report.numFailedTests ?? 0,
      perTool,
    };
  } catch {
    return null;
  }
}

/** Reads the Playwright JSON report, including which privacy checks ran. */
function browserResults() {
  const path = join(ROOT, 'test-results', 'e2e.json');
  if (!existsSync(path)) return null;
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const privacyByTool = {};
    const projects = new Set();

    const walk = (suites) => {
      for (const suite of suites ?? []) {
        for (const spec of suite.specs ?? []) {
          for (const run of spec.tests ?? []) {
            projects.add(run.projectName);
            const status = run.results?.[0]?.status ?? 'unknown';
            if (status === 'passed' || status === 'expected') passed++;
            else if (status === 'skipped') skipped++;
            else failed++;

            const match = /^(.+): input never leaves the page$/.exec(spec.title);
            if (match) {
              const id = match[1];
              const current = privacyByTool[id] ?? 'passed';
              privacyByTool[id] = status === 'passed' || status === 'expected' ? current : 'failed';
            }
          }
        }
        walk(suite.suites);
      }
    };
    walk(report.suites);
    return { passed, failed, skipped, privacyByTool, engines: [...projects].sort() };
  } catch {
    return null;
  }
}

const unit = unitResults();
const browser = browserResults();

const tools = ids.map((id) => {
  const pkg = JSON.parse(readFileSync(join(toolsDir, id, 'package.json'), 'utf8'));
  const meta = JSON.parse(readFileSync(join(toolsDir, id, 'src', 'meta.json'), 'utf8'));
  const entry = catalog.find((c) => c.id === id);
  const lastChange = git(['log', '-1', '--format=%H', '--', `tools/${id}`], commit);

  return {
    id,
    name: meta.name,
    version: pkg.version,
    category: entry?.category ?? 'unknown',
    license: pkg.license,
    dependencies: pkg.dependencies ?? {},
    sourcePath: `tools/${id}`,
    sourceUrl: `https://github.com/JoshKCIT/free-open-dev-tools/tree/${commit}/tools/${id}`,
    sourceCommit: lastChange,
    pageUrl: `/tools/${id}`,
    standards: (meta.standards ?? []).map((s) => s.label),
    verification: {
      unitTests: unit?.perTool?.[id]
        ? `${unit.perTool[id].passed} passed, ${unit.perTool[id].failed} failed`
        : 'not run in this build',
      privacyCheck: browser?.privacyByTool?.[id] ?? 'not run in this build',
      standaloneStructure: 'checked by scripts/check-standalone.mjs',
    },
  };
});

const planned = catalog.filter((c) => !ids.includes(c.id));

const manifest = {
  $schema: './release-manifest.schema.json',
  project: 'Free & Open Dev Tools',
  builtAt,
  commit,
  shortCommit,
  branch,
  workingTreeClean: !dirty,
  deployment: {
    target: 'GitHub Pages',
    url: 'https://joshkcit.github.io/free-open-dev-tools/',
    note: 'A URL here records the intended destination. Whether a build actually reached it is recorded by the deploy workflow run, not by this file.',
  },
  verification: {
    unitTests: unit ? `${unit.passed} passed, ${unit.failed} failed, ${unit.total} total` : 'not run in this build',
    browserTests: browser
      ? `${browser.passed} passed, ${browser.failed} failed, ${browser.skipped} skipped`
      : 'not run in this build',
    browserEngines: browser?.engines ?? [],
    privacyHarness: browser
      ? `${Object.values(browser.privacyByTool).filter((v) => v === 'passed').length} of ${tools.length} tools verified to leak nothing`
      : 'not run in this build',
    note: 'These are results read from the reports produced by this build. A check with no report is reported as not run, never as passed.',
  },
  tools,
  plannedTools: planned.map((p) => ({ id: p.id, name: p.name, tier: p.tier, category: p.category })),
};

writeFileSync(join(ROOT, 'docs', 'RELEASE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');

const md = [];
md.push('# Release manifest');
md.push('');
md.push('Generated by `pnpm manifest`. Do not edit by hand.');
md.push('');
md.push(`- Built: ${builtAt}`);
md.push(`- Commit: \`${commit}\``);
md.push(`- Branch: \`${branch}\``);
md.push(`- Working tree clean: ${!dirty}`);
md.push('');
md.push('## What was verified');
md.push('');
md.push('| Check | Result |');
md.push('| --- | --- |');
md.push(`| Unit tests | ${manifest.verification.unitTests} |`);
md.push(`| Browser tests | ${manifest.verification.browserTests} |`);
md.push(`| Browser engines | ${manifest.verification.browserEngines.join(', ') || 'none recorded'} |`);
md.push(`| Privacy harness | ${manifest.verification.privacyHarness} |`);
md.push('');
md.push('A check with no report is listed as "not run". It is never listed as passing.');
md.push('');
md.push('## Shipped tools');
md.push('');
md.push('| Tool | Version | Source | Last changed | Unit tests | Privacy check |');
md.push('| --- | --- | --- | --- | --- | --- |');
for (const t of tools) {
  md.push(
    `| [${t.name}](${t.pageUrl}) | ${t.version} | [\`${t.sourcePath}\`](${t.sourceUrl}) | \`${t.sourceCommit.slice(0, 8)}\` | ${t.verification.unitTests} | ${t.verification.privacyCheck} |`,
  );
}
md.push('');
md.push(`## Planned, not shipped (${planned.length})`);
md.push('');
md.push('These are in the catalog and not built. There is no partial version of any of them on the site.');
md.push('');
md.push('| Tool | Category | Tier |');
md.push('| --- | --- | --- |');
for (const p of manifest.plannedTools) md.push(`| ${p.name} | ${p.category} | ${p.tier} |`);
md.push('');
writeFileSync(join(ROOT, 'docs', 'RELEASE-MANIFEST.md'), md.join('\n'));

console.log(`Release manifest written for commit ${shortCommit}: ${tools.length} shipped, ${planned.length} planned.`);
