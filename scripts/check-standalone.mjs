#!/usr/bin/env node
/**
 * Release gate: prove each tool folder really does work on its own.
 *
 * The claim on every tool page is that you can copy the folder out and run it.
 * This checks that literally: it copies each `tools/<id>` to a scratch
 * directory outside the workspace, installs only what that folder declares,
 * builds it with its own tsconfig, and runs its own tests.
 *
 *   node scripts/check-standalone.mjs           # structural checks only
 *   node scripts/check-standalone.mjs --full    # also install, build and test
 *
 * The full run is slow, so CI does it on a schedule and on release, while the
 * fast structural pass runs on every commit.
 */
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/catalog.mjs';

const full = process.argv.includes('--full');
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

const toolsDir = join(ROOT, 'tools');
const ids = readdirSync(toolsDir)
  .filter((d) => statSync(join(toolsDir, d)).isDirectory())
  .filter((d) => !only || d === only)
  .sort();

const problems = [];
const note = (msg) => problems.push(msg);

for (const id of ids) {
  const dir = join(toolsDir, id);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

  // A workspace protocol dependency cannot be installed outside this repo.
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (
        String(range).startsWith('workspace:') ||
        String(range).startsWith('link:') ||
        String(range).startsWith('file:')
      ) {
        note(`tools/${id}: ${field}.${name} is "${range}", which only resolves inside this repository.`);
      }
    }
  }

  if (pkg.license !== 'MIT') note(`tools/${id}: license is "${pkg.license}", expected MIT.`);
  if (!pkg.scripts?.test) note(`tools/${id}: no test script.`);
  if (!pkg.scripts?.build) note(`tools/${id}: no build script.`);

  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  if (!readme.includes('npm install')) note(`tools/${id}: README does not show how to install it.`);
  if (!readme.includes('npm test')) note(`tools/${id}: README does not show how to run its tests.`);
  if (!readme.includes('degit')) note(`tools/${id}: README does not show how to extract the folder on its own.`);
}

if (problems.length > 0) {
  console.error(`Standalone structure check failed:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`Standalone structure check passed for ${ids.length} tool${ids.length === 1 ? '' : 's'}.`);

if (!full) {
  console.log('Run with --full to install, build and test each folder in isolation.');
  process.exit(0);
}

// --- the real thing: build and test each folder outside the workspace -----
const failures = [];
for (const id of ids) {
  const scratch = mkdtempSync(join(tmpdir(), `fodt-${id}-`));
  const target = join(scratch, id);
  process.stdout.write(`  ${id}: copying… `);
  try {
    cpSync(join(toolsDir, id), target, {
      recursive: true,
      filter: (src) => !src.includes('node_modules') && !src.includes(`${id}\\dist`) && !src.includes(`${id}/dist`),
    });

    process.stdout.write('installing… ');
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: target,
      stdio: 'pipe',
      shell: process.platform === 'win32',
      timeout: 300_000,
    });

    process.stdout.write('building… ');
    execFileSync('npm', ['run', 'build'], {
      cwd: target,
      stdio: 'pipe',
      shell: process.platform === 'win32',
      timeout: 300_000,
    });

    process.stdout.write('testing… ');
    execFileSync('npm', ['test'], {
      cwd: target,
      stdio: 'pipe',
      shell: process.platform === 'win32',
      timeout: 300_000,
    });

    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    const output = [err.stdout?.toString(), err.stderr?.toString(), err.message].filter(Boolean).join('\n');
    failures.push(`${id}:\n${output.split('\n').slice(-25).join('\n')}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} tool folder${failures.length === 1 ? '' : 's'} did not work standalone:\n`);
  for (const f of failures) console.error(f + '\n');
  process.exit(1);
}

console.log(`\nAll ${ids.length} tool folders install, build and test on their own.`);
