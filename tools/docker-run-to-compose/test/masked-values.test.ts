import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertDockerRun } from '../src/index';

const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, name).mockImplementation(() => {}));
  }
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

it('the options table shows environment and label values as KEY=... while the YAML keeps them, and a hint points to an env file', () => {
  const marker = 'FODT-MARK-4417';
  const result = convertDockerRun(
    `docker run -e API_NAME=${marker} --env PLAIN=x -e BARE -e EMPTY= --label team=core --env-file ./app.env -l bare-label nginx`,
  );
  // The YAML necessarily keeps the values.
  expect(result.yaml).toContain(`"API_NAME=${marker}"`);
  // The table does not.
  expect(JSON.stringify(result.rows)).not.toContain(marker);
  expect(result.rows.map((row) => [row.option, row.value])).toEqual([
    ['--env', 'API_NAME=...'],
    ['--env', 'PLAIN=...'],
    ['--env', 'BARE'],
    ['--env', 'EMPTY=...'],
    ['--label', 'team=...'],
    ['--env-file', './app.env'],
    ['--label', 'bare-label'],
  ]);
  // Every other option keeps showing its value, cut at 40 characters as before.
  expect(convertDockerRun('docker run --name web -p 8080:80 nginx').rows.map((row) => row.value)).toEqual([
    'web',
    '8080:80',
  ]);
  // A long key is cut and the value is still hidden.
  const long = convertDockerRun(`docker run -e ${'K'.repeat(60)}=${marker} nginx`);
  expect(long.rows[0]?.value).toBe('K'.repeat(40) + String.fromCodePoint(0x2026) + '=...');
  expect(JSON.stringify(long.rows)).not.toContain(marker);
  // The hint appears when an environment value was written into the file, and not otherwise.
  const hint = result.hints.find((text) => text.includes('env file'));
  expect(hint).toContain('secret');
  expect(hint).toContain('env_file');
  expect(convertDockerRun('docker run -e BARE nginx').hints.some((text) => text.includes('env file'))).toBe(false);
  expect(convertDockerRun('docker run --name web nginx').hints.some((text) => text.includes('env file'))).toBe(false);
});
