import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertDockerRun } from '../src/index';

const D = String.fromCharCode(36);
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

/** Every key of a document, depth first. */
function keysOf(value: unknown): string[] {
  const keys: string[] = [];
  const walk = (inner: unknown): void => {
    if (Array.isArray(inner)) inner.forEach(walk);
    else if (typeof inner === 'object' && inner !== null) {
      for (const key of Object.keys(inner)) {
        keys.push(key);
        walk((inner as Record<string, unknown>)[key]);
      }
    }
  };
  walk(value);
  return keys;
}

it('a network, log option, storage option, ulimit or GPU option name that holds a dollar sign is listed, never written as a key', () => {
  const commands = [
    `docker run --network ${D}NET nginx`,
    `docker run --network ${D}{NET:-mynet} nginx`,
    `docker run --network ${D}{NET:-mynet} --network-alias a nginx`,
    `docker run --network name=${D}NET,alias=a nginx`,
    `docker run --network ${Q}my${D}net${Q} nginx`,
    `docker run --log-opt ${Q}k${D}x=1${Q} nginx`,
    `docker run --log-opt k${D}X=1 nginx`,
    `docker run --storage-opt ${Q}k${D}x=1${Q} nginx`,
    `docker run --ulimit ${Q}a${D}b=1${Q} nginx`,
    `docker run --ulimit a${D}B=1 nginx`,
    `docker run --gpus ${Q}options=k${D}x=1${Q} nginx`,
    `docker run --network ${Q}name=n,driver-opt=k${D}x=1${Q} nginx`,
  ];
  for (const command of commands) {
    const result = convertDockerRun(command);
    // Keys never hold a dollar sign (so none is doubled either), and the file is still valid.
    for (const key of keysOf(result.document)) expect(key.includes(D), `${command}: ${key}`).toBe(false);
    expect(result.validation.valid, command).toBe(true);
    // The option is in the "needs another service or network" list with a reason in plain words.
    expect(result.needsAnotherService.length, command).toBeGreaterThan(0);
    for (const entry of result.needsAnotherService) {
      expect(entry.reason.length, command).toBeGreaterThan(20);
    }
  }
  const network = convertDockerRun(`docker run --network ${D}{NET:-mynet} --network-alias a nginx`);
  expect(network.document['networks']).toBeUndefined();
  expect(network.needsAnotherService.map((entry) => entry.option)).toEqual(['--network', '--network-alias']);
  expect(network.needsAnotherService[0]?.reason).toContain('dollar sign');
  expect(network.rows.map((row) => row.key)).toEqual([
    'not written, the name holds a dollar sign',
    'not written, needs a user-defined network',
  ]);
  const log = convertDockerRun(`docker run --log-opt ${Q}k${D}x=1${Q} --log-opt max-size=1m nginx`);
  expect(log.yaml).toContain('max-size: "1m"');
  expect(log.needsAnotherService.map((entry) => [entry.option, entry.key])).toEqual([['--log-opt', 'logging.options']]);
  // One network that can be written next to one that cannot: the settings that belong to a network are not guessed at.
  const mixed = convertDockerRun(`docker run --network appnet --network ${D}OTHER --network-alias a nginx`);
  expect(mixed.document['networks']).toEqual({ appnet: { external: true } });
  expect(mixed.needsAnotherService.map((entry) => entry.option)).toEqual(['--network', '--network-alias']);
  // A dollar sign in a value is still doubled or kept for Compose, as before.
  expect(convertDockerRun(`docker run -e ${Q}A=${D}${Q} -e B=${D}B nginx`).yaml).toContain('"A=$$"');
});

it('a variable as the source of a volume is written as it is and the page says to declare the volume by hand', () => {
  const result = convertDockerRun(`docker run -v ${D}VOL:/data nginx`);
  expect(result.document['volumes']).toBeUndefined();
  expect((result.document['services'] as Record<string, { volumes: string[] }>)['nginx']?.volumes).toEqual([
    `${D}VOL:/data`,
  ]);
  const hint = result.hints.find((text) => text.includes('top-level volumes'));
  expect(hint).toContain(`${D}VOL`);
  expect(hint).toContain('by hand');
  // The same for a mount of type volume, and for a variable with a default.
  expect(
    convertDockerRun(`docker run --mount type=volume,source=${D}VOL,target=/d nginx`).hints.some((text) =>
      text.includes('top-level volumes'),
    ),
  ).toBe(true);
  expect(
    convertDockerRun(`docker run -v ${D}{DATA:-store}:/data nginx`).hints.some((text) =>
      text.includes('top-level volumes'),
    ),
  ).toBe(true);
  // No hint for a plain path or a declared named volume.
  expect(
    convertDockerRun('docker run -v ./data:/data -v store:/s nginx').hints.some((text) => text.includes('by hand')),
  ).toBe(false);
  expect(
    convertDockerRun(`docker run -v ${Q}a${D}b:/data${Q} nginx`).hints.some((text) => text.includes('by hand')),
  ).toBe(false);
});
