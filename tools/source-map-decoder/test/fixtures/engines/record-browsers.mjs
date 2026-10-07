// Records the stack a thrown error prints in Chromium, Firefox and WebKit, through the repository's own Playwright, for
// the minified bundle next to this file (min.js). The bundle is served on a loopback port the system picks (never 4173)
// and the page keeps the stack of the uncaught error.
//
//   node tools/source-map-decoder/test/fixtures/engines/record-browsers.mjs [output.json]
//
// The output (default: stacks.json next to this file) keeps whatever other keys it already holds, so record-node.mjs and
// this script write to the same file. Nothing here runs in a test: the tests read the recording.
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..', '..');
const out = resolve(process.argv[2] ?? join(here, 'stacks.json'));
const { chromium, firefox, webkit } = createRequire(join(root, 'package.json'))('@playwright/test');
const playwrightVersion = createRequire(join(root, 'package.json'))('@playwright/test/package.json').version;

const script = readFileSync(join(here, 'min.js'), 'utf8');
const page =
  '<!doctype html><meta charset="utf-8"><script>window.__stack = null; window.addEventListener("error", function (e) { window.__stack = e.error && e.error.stack; });</script><script src="/min.js"></script>';
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page);
  } else if (path === '/min.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(script);
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
if (port === 4173) throw new Error('the system picked the preview port');

const engines = {};
for (const [name, type] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  const browser = await type.launch();
  try {
    const tab = await browser.newPage();
    await tab.goto(`http://127.0.0.1:${port}/`);
    await tab.waitForFunction(() => window.__stack !== null, null, { timeout: 10000 });
    engines[name] = { version: browser.version(), stack: await tab.evaluate(() => window.__stack) };
  } finally {
    await browser.close();
  }
}
server.close();

const recordedAt = new Date().toISOString();
const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
writeFileSync(
  out,
  JSON.stringify({ ...previous, recordedAt, browsers: { recordedAt, playwright: playwrightVersion, port, engines } }, null, 1) + '\n',
);
for (const [name, { version, stack }] of Object.entries(engines)) console.log(`--- ${name} ${version}\n${stack}`);
