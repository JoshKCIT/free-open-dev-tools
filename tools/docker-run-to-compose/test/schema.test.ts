import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertDockerRun } from '../src/index';
import { COMPOSE_SPEC_COMMIT, COMPOSE_SPEC_SCHEMA } from '../src/compose-spec-schema';
import { buildComposeSpecSchema } from './build-compose-schema';

const FIXTURES = join(__dirname, 'fixtures');
const COMPOSE_SPEC_DIR = join(FIXTURES, 'compose-spec');
const DOCKER_CLI_DIR = join(FIXTURES, 'docker-cli');

interface Sample {
  option: string;
  command: string;
}
interface AcceptedSample {
  command: string;
  yamlSha256: string;
  compose: string;
  dockerRun: string;
}
interface Acceptance {
  recordedOn: string;
  docker: string;
  composeVersion: string;
  dockerCliCommit: string;
  composeSpecCommit: string;
  samples: AcceptedSample[];
  recorded: AcceptedSample[];
}

const SAMPLES: Sample[] = JSON.parse(readFileSync(join(FIXTURES, 'samples.json'), 'utf8'));
const RECORDED_COMMANDS: string[] = JSON.parse(readFileSync(join(FIXTURES, 'recorded-commands.json'), 'utf8'));
const ACCEPTANCE: Acceptance = JSON.parse(readFileSync(join(FIXTURES, 'acceptance.json'), 'utf8'));

/** The git blob SHA-1 of a file's bytes: what `git hash-object` prints. */
function gitBlobSha(bytes: Buffer): string {
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'ascii'))
    .update(bytes)
    .digest('hex');
}

/** The `- name: sha` lines under the Files heading of an UPSTREAM.md. */
function readUpstreamShas(text: string): { path: string; sha: string }[] {
  const entries: { path: string; sha: string }[] = [];
  const heading = text.indexOf('## Files');
  for (const line of (heading < 0 ? text : text.slice(heading)).split('\n')) {
    if (!line.startsWith('- ')) continue;
    const colon = line.lastIndexOf(': ');
    if (colon < 0) continue;
    const sha = line.slice(colon + 2).trim();
    if (sha.length === 40 && /^[0-9a-f]+$/.test(sha)) entries.push({ path: line.slice(2, colon), sha });
  }
  return entries;
}

it('the bundled Compose schema is exactly what the copied generator builds from the vendored upstream file', () => {
  expect(COMPOSE_SPEC_SCHEMA).toEqual(buildComposeSpecSchema());
  // The module, the vendored file's notice and the recorded run name the same upstream commit.
  const upstream = readFileSync(join(COMPOSE_SPEC_DIR, 'UPSTREAM.md'), 'utf8');
  expect(upstream).toContain(`Commit: ${COMPOSE_SPEC_COMMIT}`);
  expect(COMPOSE_SPEC_COMMIT).toBe('914ec15d1fa498969c0df5c1d672306db3256089');
  const notice = readFileSync(join(__dirname, '..', 'src', 'compose-spec-schema-NOTICE.txt'), 'utf8');
  expect(notice).toContain(COMPOSE_SPEC_COMMIT);
  expect(notice).toContain('tools/docker-run-to-compose/test/fixtures/compose-spec/LICENSE');
  expect(ACCEPTANCE.composeSpecCommit).toBe(COMPOSE_SPEC_COMMIT);
  // The schema is the Compose Specification's: it names the service keys the converter writes.
  const service = (COMPOSE_SPEC_SCHEMA['$defs'] as Record<string, unknown>)['container_spec'] as {
    properties: Record<string, unknown>;
  };
  for (const key of ['container_name', 'ports', 'storage_opt', 'ulimits', 'healthcheck', 'networks']) {
    expect(Object.hasOwn(service.properties, key), key).toBe(true);
  }
});

it('every vendored upstream file matches the git blob SHA recorded in UPSTREAM.md', () => {
  for (const dir of [COMPOSE_SPEC_DIR, DOCKER_CLI_DIR]) {
    const entries = readUpstreamShas(readFileSync(join(dir, 'UPSTREAM.md'), 'utf8'));
    expect(entries.length, dir).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(gitBlobSha(readFileSync(join(dir, entry.path))), `${dir}/${entry.path}`).toBe(entry.sha);
    }
  }
  // The Docker CLI files are the ones the option table was checked against.
  const cli = readUpstreamShas(readFileSync(join(DOCKER_CLI_DIR, 'UPSTREAM.md'), 'utf8')).map((entry) => entry.path);
  expect(cli.sort()).toEqual(['LICENSE', 'opts.go', 'run.go']);
  expect(readFileSync(join(DOCKER_CLI_DIR, 'UPSTREAM.md'), 'utf8')).toContain(
    '09d30a34bf8c7b1fe9c323b23935a1ddb7af8ec0',
  );
  expect(ACCEPTANCE.dockerCliCommit).toBe('09d30a34bf8c7b1fe9c323b23935a1ddb7af8ec0');
});

it('the recorded docker compose config run accepted every sample', () => {
  expect(ACCEPTANCE.docker).toMatch(/^Docker version \d+\.\d+\.\d+/);
  expect(ACCEPTANCE.composeVersion).toMatch(/^Docker Compose version v\d+\.\d+\.\d+/);
  expect(ACCEPTANCE.recordedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  expect(ACCEPTANCE.samples.map((s) => s.command)).toEqual(SAMPLES.map((s) => s.command));
  expect(ACCEPTANCE.recorded.map((s) => s.command)).toEqual(RECORDED_COMMANDS);
  expect(RECORDED_COMMANDS).toHaveLength(10);
  for (const entry of [...ACCEPTANCE.samples, ...ACCEPTANCE.recorded]) {
    // The recorded file is still what the converter writes today: change the converter and the run must be repeated.
    const yaml = convertDockerRun(entry.command).yaml;
    expect(createHash('sha256').update(yaml).digest('hex'), entry.command).toBe(entry.yamlSha256);
    expect(entry.compose, entry.command).toBe('accepted');
  }
  // docker run itself, with no daemon, refused no option's value type; the one flag the installed CLI does not have yet is named.
  const refused = ACCEPTANCE.samples.filter((s) => s.dockerRun !== 'accepted');
  expect(refused.map((s) => s.command)).toEqual(['docker run --umask 022 nginx']);
  expect(refused[0]?.dockerRun).toContain('unknown flag');
});
