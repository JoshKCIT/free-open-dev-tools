// Records the frames Node prints for the uncaught error of the minified bundle next to this file (min.js), once as it
// is and once with --enable-source-maps, which is Node's own decoding and so the reference the decoder is held to.
//
//   node tools/source-map-decoder/test/fixtures/engines/record-node.mjs [output.json]
//
// The bundle and its map are copied into a temporary folder first, so the printed paths can be written as <dir> and no
// machine path is recorded. The output (default: stacks.json next to this file) keeps whatever other keys it already
// holds, so record-browsers.mjs and this script write to the same file. Nothing here runs in a test.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(here, 'stacks.json'));

const dir = mkdtempSync(join(tmpdir(), 'smd-node-'));
try {
  const bundle = join(dir, 'out');
  mkdirSync(bundle);
  copyFileSync(join(here, 'min.js'), join(bundle, 'min.js'));
  copyFileSync(join(here, 'min.js.map'), join(bundle, 'min.js.map'));
  const file = join(bundle, 'min.js');

  const forward = (text) => text.split('\\').join('/');
  const frames = (stderr) =>
    forward(stderr)
      .split(/\r?\n/)
      .filter((line) => /^\s+at /.test(line))
      .map((line) => line.split(forward(dir)).join('<dir>'));
  const run = (args) => spawnSync(process.execPath, [...args, file], { encoding: 'utf8' });

  const plain = run([]);
  const mapped = run(['--enable-source-maps']);
  const recordedAt = new Date().toISOString();
  const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
  const node = { recordedAt, version: process.version, plain: frames(plain.stderr), mapped: frames(mapped.stderr) };
  writeFileSync(out, JSON.stringify({ ...previous, recordedAt, node }, null, 1) + '\n');
  console.log(`node ${process.version}\n--- plain\n${node.plain.join('\n')}\n--- with --enable-source-maps\n${node.mapped.join('\n')}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
