import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse } from 'yaml';
import { convertDockerRun } from '../src/index';

// Text that holds a tab, a backslash or an angle bracket is built from these, so no editor can change it.
const TAB = String.fromCharCode(9);
const LT = String.fromCharCode(60);
const Q = String.fromCharCode(39);

const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, name).mockImplementation(() => {}));
  }
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/**
 * Every key of a YAML 1.1 reading of `text`, in document order, as the reader types them. In YAML 1.1 mode 2024-10-04 is a
 * timestamp, 1_000 and 0b11 are integers, yes and no are booleans and a plain LT LT is a merge key, which is how Compose's
 * own loader can read a key that YAML 1.2 would call a string.
 */
function keysRead(text: string): unknown[] {
  const keys: unknown[] = [];
  const walk = (value: unknown): void => {
    if (value instanceof Map) {
      for (const [key, inner] of value) {
        keys.push(key);
        walk(inner);
      }
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    }
  };
  walk(parse(text, { version: '1.1', mapAsMap: true }));
  return keys;
}

/** Every key of the document the converter built, in the order the writer wrote them. */
function keysIntended(value: unknown): string[] {
  const keys: string[] = [];
  const walk = (inner: unknown): void => {
    if (Array.isArray(inner)) {
      inner.forEach(walk);
    } else if (typeof inner === 'object' && inner !== null) {
      for (const key of Object.keys(inner)) {
        keys.push(key);
        walk((inner as Record<string, unknown>)[key]);
      }
    }
  };
  walk(value);
  return keys;
}

const LOOKALIKES = ['2024-10-04', '1_000', '0b11', '0x_1f', '0o17', '1e3', '12:30:45', '1.5', '0777'];

it('every YAML key that Compose could read as a date, a number, a merge key or a boolean is written in double quotes', () => {
  const commands: string[] = [];
  for (const word of LOOKALIKES) {
    commands.push(
      `docker run --name ${word} nginx`,
      `docker run -v ${word}:/data nginx`,
      `docker run ${word}`,
      `docker run --network ${word} nginx`,
      `docker run --network ${word} --network-alias a nginx`,
      `docker run --log-opt ${word}=x nginx`,
      `docker run --storage-opt ${word}=x nginx`,
      `docker run --ulimit ${word}=1 nginx`,
    );
  }
  const merge = LT + LT;
  commands.push(
    `docker run --log-opt ${Q}${merge}=x${Q} nginx`,
    `docker run --ulimit ${Q}${merge}=1${Q} nginx`,
    `docker run --network ${Q}${merge}${Q} nginx`,
    `docker run --network ${Q}${merge}${Q} --network-alias a nginx`,
    `docker run -v ${Q}${merge}:/data${Q} nginx`,
    `docker run --storage-opt ${Q}${merge}=x${Q} nginx`,
    `docker run --log-opt ${Q}a${TAB}b=1${Q} nginx`,
    `docker run --ulimit ${Q}a${TAB}b=1${Q} nginx`,
    `docker run --log-opt ${Q}~=x${Q} nginx`,
    `docker run --log-opt ${Q}=x${Q} nginx`,
  );
  for (const word of [
    'y',
    'n',
    'yes',
    'no',
    'on',
    'off',
    'true',
    'false',
    'null',
    'Yes',
    'NO',
    'On',
    'oFF',
    'TRUE',
    'Null',
  ]) {
    commands.push(
      `docker run --name ${word} nginx`,
      `docker run ${word}`,
      `docker run --log-opt ${word}=x nginx`,
      `docker run --ulimit ${word}=1 nginx`,
      `docker run --network ${word} --network-alias a nginx`,
      `docker run -v ${word}:/data nginx`,
    );
  }
  expect(commands.length).toBeGreaterThan(100);
  for (const command of commands) {
    const result = convertDockerRun(command);
    const read = keysRead(result.yaml);
    for (const key of read) expect(typeof key, `${command} gave a key that is not text`).toBe('string');
    expect(read, command).toEqual(keysIntended(result.document));
  }
});

it('a key that is plainly safe stays unquoted so the usual output does not change', () => {
  const result = convertDockerRun(
    'docker run --name web --log-opt max-size=10m --ulimit nofile=1024:2048 --network appnet --network-alias api nginx',
  );
  expect(result.yaml).toContain('\n  web:\n');
  expect(result.yaml).toContain('\n        max-size: "10m"\n');
  expect(result.yaml).toContain('\n      nofile:\n');
  expect(result.yaml).toContain('\n      appnet:\n');
  expect(result.yaml).not.toMatch(/^\s*"(web|max-size|nofile|appnet)":/m);
  // A key that is not plainly safe is quoted, whatever it holds.
  const quoted = convertDockerRun('docker run --name 2024-10-04 -v my.vol:/x --log-opt a.b=1 nginx');
  expect(quoted.yaml).toContain('\n  "2024-10-04":\n');
  expect(quoted.yaml).toContain('\n  "my.vol":');
  expect(quoted.yaml).toContain('\n        "a.b": "1"\n');
});
