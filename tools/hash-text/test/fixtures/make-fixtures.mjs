// Records the second opinions the MD4 and SHAKE tests rest on. Run it from the repository root:
//
//   MSYS2_ARG_CONV_EXCL="*" node tools/hash-text/test/fixtures/make-fixtures.mjs > tools/hash-text/test/fixtures/md4-openssl.ts
//
// It makes 200 inputs from a fixed seed (the same generator the test uses to make them again), asks OpenSSL for the MD4
// digest of each through its legacy provider (Node's own crypto module does not offer MD4 under OpenSSL 3, so it cannot be
// the second opinion), and prints a TypeScript file holding the digests. Unit tests never run OpenSSL; they read the file.
import { execFileSync } from 'node:child_process';

/** The seeded generator of the test (mulberry32), so the inputs are the same here and there. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 14070;
const next = seeded(SEED);
const inputs = [];
for (let i = 0; i < 200; i++) {
  // Lengths 0 to 140 in order (every padding boundary at 55, 56, 63, 64, 65, 119, 120, 127, 128), then 59 random ones.
  const length = i <= 140 ? i : 141 + Math.floor(next() * 460);
  const bytes = new Uint8Array(length);
  for (let k = 0; k < length; k++) bytes[k] = Math.floor(next() * 256);
  inputs.push(bytes);
}

const version = execFileSync('openssl', ['version'], { encoding: 'utf8' }).trim();
const digests = inputs.map((bytes) => {
  const out = execFileSync('openssl', ['dgst', '-md4', '-provider', 'legacy', '-provider', 'default'], {
    input: bytes,
    encoding: 'utf8',
  });
  const match = /= ([0-9a-f]{32})\s*$/.exec(out);
  if (!match) throw new Error('unexpected openssl output: ' + out);
  return match[1];
});

const lines = [];
lines.push('// Written by make-fixtures.mjs. Do not edit by hand.');
lines.push(`// Command: openssl dgst -md4 -provider legacy -provider default, once per input, with ${version}.`);
lines.push('// The inputs are made again by the test from the seed below.');
lines.push(`export const MD4_OPENSSL_SEED = ${SEED};`);
lines.push('export const MD4_OPENSSL_DIGESTS: string[] = [');
for (const digest of digests) lines.push(`  '${digest}',`);
lines.push('];');
process.stdout.write(lines.join('\n') + '\n');
