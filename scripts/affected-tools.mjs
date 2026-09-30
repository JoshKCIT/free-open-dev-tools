#!/usr/bin/env node
/**
 * Works out which checks a change needs, so a push that touches two tools does
 * not wait on the browser tests of the other 149. The rules live in
 * scripts/lib/affected.mjs; this file reads git, applies them, and prints the
 * plan with the reason for every changed file.
 *
 *   node scripts/affected-tools.mjs --base origin/main
 *       What pushing the working tree (uncommitted and untracked files
 *       included) would recheck.
 *   node scripts/affected-tools.mjs --base origin/main --run -- --project=chromium
 *       The same, then runs just those browser tests. Everything after `--`
 *       goes to Playwright unchanged.
 *   node scripts/affected-tools.mjs --base-candidates <file> --head HEAD --github-output <file> --summary <file>
 *       CI on a push. The file lists, newest first, the commits whose CI run
 *       passed, and the comparison is against the first one that is an
 *       ancestor of the head. Comparing with the last passing commit rather
 *       than the previous push means a tool broken by a failed push is still
 *       rechecked by the next push, whatever that push touches.
 *   node scripts/affected-tools.mjs --full --github-output <file> --summary <file>
 *       CI's nightly and hand-started runs: everything.
 *
 * Whatever this decides, typecheck, lint, format, unit tests and every release
 * gate still run in full in CI's static job, and the nightly full run catches
 * anything a gap in these rules lets through.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT } from './lib/catalog.mjs';
import {
  PRERENDER,
  SHELL_ENTRY,
  STANDALONE_CHECK,
  buildGraph,
  catalogImpact,
  grepInvertPattern,
  lockfileImpact,
  pathRule,
  reach,
  sameIgnoringComments,
} from './lib/affected.mjs';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Arguments

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const own = split === -1 ? argv : argv.slice(0, split);
const toPlaywright = split === -1 ? [] : argv.slice(split + 1);
const has = (name) => own.includes(name);
const value = (name) => {
  const i = own.indexOf(name);
  if (i === -1) return undefined;
  const v = own[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`${name} needs a value.`);
  return v;
};

function fail(message) {
  console.error(message);
  process.exit(2);
}

const KNOWN = new Set([
  '--base',
  '--base-candidates',
  '--head',
  '--full',
  '--run',
  '--json',
  '--github-output',
  '--summary',
]);
for (const arg of own) {
  if (arg.startsWith('--') && !KNOWN.has(arg)) fail(`Unknown option ${arg}. Options: ${[...KNOWN].join(' ')}.`);
}

// ---------------------------------------------------------------------------
// Git

function git(args, { allowFail = false, input } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      input,
      encoding: input === undefined ? 'utf8' : undefined,
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

const zList = (text) => text.split('\0').filter(Boolean);

/** Reads many files at one commit in a single git process. Missing files come back as null. */
function readAt(rev, paths) {
  const out = new Map();
  if (paths.length === 0) return out;
  const buffer = git(['cat-file', '--batch'], { input: paths.map((p) => `${rev}:${p}`).join('\n') + '\n' });
  let pos = 0;
  for (const path of paths) {
    const end = buffer.indexOf(10, pos);
    const header = buffer.subarray(pos, end).toString('utf8');
    pos = end + 1;
    const [, type, size] = header.split(' ');
    if (header.endsWith(' missing') || size === undefined) {
      out.set(path, null);
      continue;
    }
    out.set(path, type === 'blob' ? buffer.subarray(pos, pos + Number(size)).toString('utf8') : null);
    pos += Number(size) + 1;
  }
  return out;
}

/** The working tree's version of each file, for a local run with no --head. */
function readWorkingTree(paths) {
  return new Map(
    paths.map((p) => {
      const full = join(ROOT, p);
      return [p, existsSync(full) ? readFileSync(full, 'utf8') : null];
    }),
  );
}

function filesAt(rev) {
  if (rev !== null) return zList(git(['ls-tree', '-r', '--name-only', '-z', rev]));
  return zList(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).filter((p) =>
    existsSync(join(ROOT, p)),
  );
}

function changedFiles(base, head) {
  if (head !== null) return zList(git(['diff', '--name-only', '--no-renames', '-z', base, head]));
  const tracked = zList(git(['diff', '--name-only', '--no-renames', '-z', base]));
  const untracked = zList(git(['ls-files', '-z', '--others', '--exclude-standard']));
  return [...new Set([...tracked, ...untracked])].sort();
}

function resolveBase(head) {
  const base = value('--base');
  if (base !== undefined) {
    const sha = git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { allowFail: true });
    if (!sha) fail(`--base ${base} is not a commit this checkout has.`);
    return { sha: sha.trim(), why: base };
  }
  const candidates = value('--base-candidates');
  if (candidates !== undefined) {
    const shas = existsSync(candidates) ? readFileSync(candidates, 'utf8').split(/\s+/).filter(Boolean) : [];
    for (const sha of shas) {
      if (git(['merge-base', '--is-ancestor', sha, head ?? 'HEAD'], { allowFail: true }) !== null) {
        return { sha, why: 'the newest commit that already passed CI' };
      }
    }
    return null;
  }
  return fail('Give --base <commit>, --base-candidates <file> or --full.');
}

// ---------------------------------------------------------------------------
// The plan

const CODE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const isGraphSource = (p) =>
  CODE_FILE.test(p) &&
  (p.startsWith('apps/web/src/') || p.startsWith('e2e/') || p.startsWith('scripts/') || /^tools\/[^/]+\/src\//.test(p));

const PLAYWRIGHT_PACKAGES = new Set(['@playwright/test', 'playwright', 'playwright-core']);

function newPlan() {
  return {
    full: [],
    site: [],
    browser: new Map(),
    standalone: new Map(),
    standaloneAll: [],
    wholeSpecs: new Map(),
    files: [],
  };
}

const note = (map, key, path) => {
  if (!map.has(key)) map.set(key, []);
  if (!map.get(key).includes(path)) map.get(key).push(path);
};

function computePlan(base, head) {
  const plan = newPlan();
  const changed = changedFiles(base, head);
  const readHead = (paths) => (head === null ? readWorkingTree(paths) : readAt(head, paths));

  const beforeText = readAt(base, changed);
  const afterText = readHead(changed);

  // Import edges from both commits: a deleted helper is traced through the
  // pages that used to import it, a new one through the pages that do now.
  const baseFiles = filesAt(base);
  const headFiles = filesAt(head);
  const baseSources = readAt(base, baseFiles.filter(isGraphSource));
  const headSources = readHead(headFiles.filter(isGraphSource));
  const graphs = [
    buildGraph(
      [...baseSources].filter(([, t]) => t !== null),
      new Set(baseFiles),
    ),
    buildGraph(
      [...headSources].filter(([, t]) => t !== null),
      new Set(headFiles),
    ),
  ];
  const merge = (key) => {
    const merged = new Map();
    for (const g of graphs) {
      for (const [from, to] of g[key]) merged.set(from, new Set([...(merged.get(from) ?? []), ...to]));
    }
    return merged;
  };
  const forward = merge('forward');
  const reverse = merge('reverse');
  const shell = reach(SHELL_ENTRY, forward);

  const toolDirs = new Set(headFiles.map((p) => /^tools\/([^/]+)\//.exec(p)?.[1]).filter(Boolean));
  const pageIds = new Set(headFiles.map((p) => /^apps\/web\/src\/tools\/([^/]+)\.ts$/.exec(p)?.[1]).filter(Boolean));
  const allIds = new Set([...toolDirs, ...pageIds]);
  const headSet = new Set(headFiles);

  let ts = null;
  try {
    ts = require('typescript');
  } catch {
    // Without TypeScript only JSON edits can be recognised as formatting-only.
  }

  for (const path of changed) {
    const counts = [];
    const record = (text) => counts.push(text);
    const everything = (why) => {
      plan.full.push({ path, why });
      record(`everything: ${why}`);
    };
    const browserTool = (id) => {
      note(plan.browser, id, path);
      record(`tool \`${id}\``);
    };

    const trace = () => {
      const up = reach(path, reverse);
      if ([...up].some((p) => shell.has(p))) return everything('part of what every page loads');
      if (up.has(PRERENDER)) return everything('used by the build step that writes every page');
      const pages = [...up].map((p) => /^apps\/web\/src\/tools\/([^/]+)\.ts$/.exec(p)?.[1]).filter(Boolean);
      const tools = [...up].map((p) => /^tools\/([^/]+)\/src\//.exec(p)?.[1]).filter(Boolean);
      const specs = [...up].filter((p) => /^e2e\/[^/]+\.spec\.ts$/.test(p) && headSet.has(p));
      for (const id of new Set([...pages, ...tools])) browserTool(id);
      for (const id of new Set(tools)) note(plan.standalone, id, path);
      for (const spec of specs) {
        note(plan.wholeSpecs, spec.slice('e2e/'.length), path);
        record(`whole test file \`${spec.slice('e2e/'.length)}\``);
      }
      if (up.has(STANDALONE_CHECK)) {
        plan.standaloneAll.push({ path, why: 'the standalone check itself' });
        record('the standalone check of every tool folder');
      }
      if (counts.length > 0) return;
      if (path.startsWith('scripts/'))
        return record('nothing to recheck: a script the static job runs in full, or one that only plans checks');
      everything('nothing that loads it could be found, so it could matter anywhere');
    };

    if (sameIgnoringComments(path, beforeText.get(path), afterText.get(path), ts)) {
      plan.files.push({ path, counts: 'nothing to recheck: only comments or formatting changed' });
      continue;
    }

    const rule = pathRule(path);
    switch (rule.kind) {
      case 'nothing':
        record(`nothing to recheck: ${rule.why}`);
        break;
      case 'everything':
        everything(rule.why);
        break;
      case 'site':
        plan.site.push({ path, why: rule.why });
        record(`the site-wide browser tests: ${rule.why}`);
        break;
      case 'tool':
        note(plan.standalone, rule.id, path);
        if (rule.browser) browserTool(rule.id);
        else record(`the standalone check of \`${rule.id}\` only: ${rule.why}`);
        if (rule.trace) trace();
        break;
      case 'fixture':
        if (allIds.has(rule.id)) browserTool(rule.id);
        else record('nothing to recheck: a fixture for a tool that no longer exists');
        break;
      case 'spec':
        if (headSet.has(path)) {
          note(plan.wholeSpecs, path.slice('e2e/'.length), path);
          record('this whole test file, for every tool: the test itself changed');
        } else {
          record('nothing to recheck: a browser test file that was removed');
        }
        break;
      case 'catalog': {
        const impact = catalogImpact(path, beforeText.get(path), afterText.get(path));
        if (impact.everything) {
          everything(impact.everything);
          break;
        }
        for (const id of impact.ids) {
          if (allIds.has(id)) browserTool(id);
        }
        if (impact.site || [...impact.ids].some((id) => !allIds.has(id))) {
          plan.site.push({ path, why: 'the catalog listing changed' });
          record('the site-wide browser tests: the catalog listing changed');
        }
        if (counts.length === 0) record('nothing to recheck: no catalog entry changed');
        break;
      }
      case 'lockfile': {
        const impact = lockfileImpact(beforeText.get(path), afterText.get(path));
        if (impact.everything) {
          everything(impact.everything);
          break;
        }
        for (const [importer, { runtime, dev }] of impact.importers) {
          const id = /^tools\/([^/]+)$/.exec(importer)?.[1];
          if (id) {
            note(plan.standalone, id, path);
            if (runtime.length > 0) browserTool(id);
            else record(`the standalone check of \`${id}\` only: its development tools changed`);
          } else if (importer === '.') {
            const names = [...runtime, ...dev];
            if (names.some((n) => PLAYWRIGHT_PACKAGES.has(n) || n.startsWith('('))) {
              everything('the browser test runner itself changed');
            } else {
              record(
                `nothing to recheck for the root packages (${names.join(', ')}): the static job runs them in full`,
              );
            }
          } else {
            everything(`the dependencies of ${importer} changed`);
          }
        }
        if (counts.length === 0) record('nothing to recheck: no package resolution changed');
        break;
      }
      case 'trace':
        trace();
        break;
      default:
        everything(`unhandled rule ${rule.kind}`);
    }
    plan.files.push({ path, counts: [...new Set(counts)].join('; ') });
  }

  return { plan, allIds, toolDirs, changedCount: changed.length };
}

function outputsFor({ plan, allIds, toolDirs }) {
  if (plan.full.length > 0) return { browser: 'all', grep_invert: '', standalone: 'all' };
  const selected = new Set(plan.browser.keys());
  const wholeFiles = new Set(plan.wholeSpecs.keys());
  const needBrowser = selected.size > 0 || wholeFiles.size > 0 || plan.site.length > 0;
  const grep = needBrowser ? grepInvertPattern({ allIds, selected, wholeFiles }) : '';
  const standaloneIds = [...plan.standalone.keys()].filter((id) => toolDirs.has(id)).sort();
  return {
    browser: !needBrowser ? 'none' : grep === '' ? 'all' : 'some',
    grep_invert: grep,
    standalone: plan.standaloneAll.length > 0 ? 'all' : standaloneIds.length > 0 ? standaloneIds.join(',') : 'none',
  };
}

// ---------------------------------------------------------------------------
// Report

const code = (s) => `\`${s}\``;
const list = (items) => items.map(code).join(', ');

function report(result, outputs, baseInfo, fullReason) {
  const lines = ['### What this run rechecks', ''];
  if (fullReason) {
    lines.push(`**Everything**, because this is ${fullReason}.`);
    return lines.join('\n');
  }
  const { plan, allIds, changedCount } = result;
  lines.push(
    `Compared with ${code(baseInfo.sha.slice(0, 8))} (${baseInfo.why}): ${changedCount} changed file${changedCount === 1 ? '' : 's'}.`,
    '',
  );
  if (plan.full.length > 0) {
    lines.push('**Everything**, because of these files:', '');
    for (const { path, why } of plan.full.slice(0, 20)) lines.push(`- ${code(path)}: ${why}`);
    if (plan.full.length > 20) lines.push(`- and ${plan.full.length - 20} more`);
  } else {
    const ids = [...plan.browser.keys()].filter((id) => allIds.has(id)).sort();
    if (outputs.browser === 'none')
      lines.push('- **Browser tests:** none; no change reaches a page or a browser test.');
    else if (outputs.browser === 'all') lines.push('- **Browser tests:** all of them.');
    else {
      lines.push(
        ids.length > 0
          ? `- **Browser tests:** the site-wide tests, plus every test of ${ids.length === 1 ? 'this tool' : `these ${ids.length} tools`} (of ${allIds.size}), in all four browsers: ${list(ids)}.`
          : `- **Browser tests:** the site-wide tests only; no tool's own tests.`,
      );
    }
    if (plan.wholeSpecs.size > 0) {
      lines.push(
        `- **Test files run whole**, for every tool, because the test itself changed: ${list([...plan.wholeSpecs.keys()].sort())}.`,
      );
    }
    if (outputs.standalone === 'all') lines.push('- **Standalone folder check:** every tool folder.');
    else if (outputs.standalone === 'none') lines.push('- **Standalone folder check:** none.');
    else lines.push(`- **Standalone folder check:** ${list(outputs.standalone.split(','))}.`);
  }
  lines.push('- Typecheck, lint, format, unit tests and every release gate run in full, as on every run.', '');
  lines.push('<details><summary>Why each changed file counts the way it does</summary>', '');
  lines.push('| Changed file | Counts as |', '| --- | --- |');
  for (const { path, counts } of plan.files.slice(0, 400))
    lines.push(`| ${code(path)} | ${counts.replace(/\|/g, '\\|')} |`);
  if (plan.files.length > 400) lines.push(`| ... | and ${plan.files.length - 400} more |`);
  lines.push('', '</details>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main

const headArg = value('--head');
const head = headArg === undefined ? null : git(['rev-parse', '--verify', `${headArg}^{commit}`]).trim();

let result = null;
let baseInfo = null;
let fullReason = null;
if (has('--full')) {
  fullReason = 'a full run (nightly, or started by hand)';
} else {
  baseInfo = resolveBase(head);
  if (baseInfo === null) fullReason = 'the first run with no earlier passing commit to compare with';
  else result = computePlan(baseInfo.sha, head);
}

const outputs = result === null ? { browser: 'all', grep_invert: '', standalone: 'all' } : outputsFor(result);
const text = report(result, outputs, baseInfo, fullReason);

if (has('--json')) {
  console.log(
    JSON.stringify(
      {
        base: baseInfo?.sha ?? null,
        ...outputs,
        tools: result ? [...result.plan.browser.keys()].sort() : [],
        wholeSpecs: result ? [...result.plan.wholeSpecs.keys()].sort() : [],
        everything: result ? result.plan.full : fullReason,
        files: result ? result.plan.files : [],
      },
      null,
      2,
    ),
  );
} else {
  console.log(text);
}

const githubOutput = value('--github-output');
if (githubOutput) {
  appendFileSync(
    githubOutput,
    `browser=${outputs.browser}\ngrep_invert=${outputs.grep_invert}\nstandalone=${outputs.standalone}\n`,
  );
}
const summary = value('--summary');
if (summary) appendFileSync(summary, `${text}\n`);

if (has('--run')) {
  if (outputs.browser === 'none') {
    console.log('\nNo browser test needs to run for these changes.');
    process.exit(0);
  }
  // Playwright's own CLI, started without a shell, so the pattern reaches it
  // exactly as written on every platform.
  const cli = require.resolve('@playwright/test/cli');
  const args = [cli, 'test', ...(outputs.grep_invert ? ['--grep-invert', outputs.grep_invert] : []), ...toPlaywright];
  const run = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  process.exit(run.status ?? 1);
}
