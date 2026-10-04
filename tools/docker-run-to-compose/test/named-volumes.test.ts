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

it('a named volume is declared with its own name so Compose reuses the volume docker run used', () => {
  const short = convertDockerRun('docker run -v pgdata:/var/lib/postgresql/data postgres:16');
  expect(short.document['volumes']).toEqual({ pgdata: { name: 'pgdata' } });
  expect(short.yaml).toContain('volumes:\n  pgdata:\n    name: "pgdata"\n');
  expect(short.validation.valid).toBe(true);
  const mount = convertDockerRun('docker run --mount type=volume,source=my.vol,target=/d nginx');
  expect(mount.document['volumes']).toEqual({ 'my.vol': { name: 'my.vol' } });
  expect(mount.yaml).toContain('\n  "my.vol":\n    name: "my.vol"\n');
  // A path is not a volume, so nothing is declared for it.
  expect(convertDockerRun('docker run -v ./data:/d -v /abs:/a nginx').document['volumes']).toBeUndefined();
  // The hint says what the name does.
  const hint = short.hints.find((text) => text.includes('same name'));
  expect(hint).toContain('docker run');
  expect(hint).toContain('project');
  expect(convertDockerRun('docker run -v ./data:/d nginx').hints.some((text) => text.includes('same name'))).toBe(
    false,
  );
});
