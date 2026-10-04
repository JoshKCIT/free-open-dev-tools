#!/usr/bin/env node
/**
 * The offline acceptance run: a second opinion on the converter that is run by hand, never in CI (CI has no Docker).
 *
 *   node tools/docker-run-to-compose/test/fixtures/run-acceptance.mjs <scratch-folder>
 *
 * It bundles the converter with the repository's own esbuild into <scratch-folder>/pkg.cjs, converts every command in
 * samples.json and recorded-commands.json, writes each result to <scratch-folder>/acceptance/ and asks the installed
 * Docker CLI two questions about it, with no daemon (DOCKER_HOST points at a closed port, so nothing is ever started,
 * pulled or looked up):
 *
 *   1. `docker compose -f <file> config --quiet`: does Compose accept the YAML?
 *   2. `docker run <the sample's words>`: does docker's own command line accept the options and their values? The
 *      command stops at the connection to the daemon, which only happens after every option has been read.
 *
 * Empty files are made for the files the samples name (--env-file, --label-file) and a container id file lands in the
 * same folder; none of them is called .env. Every child process is started with an argument array, never a shell string.
 * The results, with the docker and Compose versions, are written to acceptance.json next to this script; the unit tests
 * check that every sample is in it, accepted, and that its YAML is still what the converter writes.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..');
const scratch = process.argv[2];
if (!scratch) {
  console.error('Usage: node run-acceptance.mjs <scratch-folder>');
  process.exit(2);
}
mkdirSync(scratch, { recursive: true });
const work = join(scratch, 'acceptance');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
writeFileSync(join(work, 'a.envfile'), '');
writeFileSync(join(work, 'labels'), '');

// Bundle the converter. esbuild is a dependency of the site's build tool; find the copy in the pnpm store.
const store = join(root, 'node_modules', '.pnpm');
const esbuildFolder = readdirSync(store).find((name) => name.startsWith('esbuild@'));
if (!esbuildFolder) throw new Error('esbuild was not found in node_modules/.pnpm; run pnpm install first.');
const esbuild = createRequire(import.meta.url)(join(store, esbuildFolder, 'node_modules', 'esbuild'));
const bundle = join(scratch, 'pkg.cjs');
esbuild.buildSync({
  entryPoints: [join(root, 'tools', 'docker-run-to-compose', 'src', 'index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: bundle,
  logLevel: 'warning',
  nodePaths: [join(root, 'tools', 'docker-run-to-compose', 'node_modules')],
});
const { convertDockerRun, tokenizeDockerCommand } = createRequire(import.meta.url)(bundle);

function run(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: work,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, DOCKER_HOST: 'tcp://127.0.0.1:1', DOCKER_CONFIG: join(scratch, 'docker-config') },
    ...options,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}

const versionOf = (args) => run(args).stdout.trim().split('\n')[0];
const docker = versionOf(['--version']);
const composeVersion = versionOf(['compose', 'version']);
if (!docker || !composeVersion) throw new Error('The docker command line or Compose is not installed; nothing was recorded.');

function firstLine(text) {
  const line = text.split('\n').find((l) => l.trim() !== '') ?? '';
  return line.trim().slice(0, 200);
}

function probe(command, id) {
  const yaml = convertDockerRun(command).yaml;
  const file = `${id}.yaml`;
  writeFileSync(join(work, file), yaml);
  const compose = run(['compose', '-f', file, 'config', '--quiet']);
  const composeResult = compose.status === 0 ? 'accepted' : `refused: ${firstLine(compose.stderr)}`;
  const words = tokenizeDockerCommand(command).slice(1);
  const flags = run(words);
  const stderr = flags.stderr;
  const reachedDaemon = /cannot connect|error during connect|failed to connect|connection refused|dial tcp|Is the docker daemon running/i.test(stderr);
  const helped = words.includes('--help') && flags.status === 0;
  const dockerRun = reachedDaemon || helped ? 'accepted' : `refused: ${firstLine(stderr) || 'no message'}`;
  return {
    command,
    yamlSha256: createHash('sha256').update(yaml).digest('hex'),
    compose: composeResult,
    dockerRun,
  };
}

const samples = JSON.parse(readFileSync(join(here, 'samples.json'), 'utf8'));
const recorded = JSON.parse(readFileSync(join(here, 'recorded-commands.json'), 'utf8'));
const result = {
  recordedOn: new Date().toISOString().slice(0, 10),
  docker,
  composeVersion,
  dockerCliCommit: '09d30a34bf8c7b1fe9c323b23935a1ddb7af8ec0',
  composeSpecCommit: '914ec15d1fa498969c0df5c1d672306db3256089',
  howRun: 'docker compose -f <file> config --quiet, and docker run <words> with DOCKER_HOST=tcp://127.0.0.1:1 (no daemon); see run-acceptance.mjs',
  samples: samples.map((sample, index) => probe(sample.command, `sample-${String(index + 1).padStart(3, '0')}`)),
  recorded: recorded.map((command, index) => probe(command, `recorded-${String(index + 1).padStart(2, '0')}`)),
};
writeFileSync(join(here, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n');
const refused = [...result.samples, ...result.recorded].filter((entry) => entry.compose !== 'accepted');
const flagsRefused = [...result.samples, ...result.recorded].filter((entry) => entry.dockerRun !== 'accepted');
console.log(`${docker}; ${composeVersion}`);
console.log(`Compose accepted ${result.samples.length + result.recorded.length - refused.length} of ${result.samples.length + result.recorded.length}.`);
for (const entry of refused) console.log(`COMPOSE REFUSED: ${entry.command} -> ${entry.compose}`);
console.log(`docker run read the options of ${result.samples.length + result.recorded.length - flagsRefused.length} of ${result.samples.length + result.recorded.length}.`);
for (const entry of flagsRefused) console.log(`DOCKER RUN REFUSED: ${entry.command} -> ${entry.dockerRun}`);
process.exit(refused.length > 0 ? 1 : 0);
