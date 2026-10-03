/**
 * Writes recorded-outputs.ts: what Mermaid draws for the 22 sample diagrams (samples.ts) with this folder's own frame
 * document (src/frame-doc.ts: security level strict, labels as SVG text), each in a fresh frame in Chromium, and four
 * hostile outputs drawn with the frame's policy removed, which the scrub in src/scrub.ts must refuse.
 *
 * Run from the repository root, by hand (CI never runs it; it needs Chromium from Playwright):
 *
 *   node tools/mermaid-renderer/test/fixtures/record-outputs.mjs
 *   pnpm exec prettier --write tools/mermaid-renderer/test/fixtures/recorded-outputs.ts
 *
 * It reads the bundle the folder installed (node_modules/mermaid/dist/mermaid.min.js) and refuses to run if that is
 * not Mermaid 11.17.2. The hostile texts name 127.0.0.1:9 (the discard port, where nothing listens), so the frames
 * that run them without a policy fail to connect and nothing is received anywhere.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const here = fileURLToPath(new URL('.', import.meta.url));
const folder = join(here, '..', '..');
const bundlePath = join(folder, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const installed = JSON.parse(readFileSync(join(folder, 'node_modules', 'mermaid', 'package.json'), 'utf8'));
if (installed.version !== '11.17.2') throw new Error(`Expected Mermaid 11.17.2, found ${installed.version}.`);

/** Loads TypeScript files of this folder by writing their JavaScript to a scratch folder and importing that. */
async function loadTs(files) {
  const dir = mkdtempSync(join(tmpdir(), 'fodt-mermaid-record-'));
  try {
    for (const [name, path] of Object.entries(files)) {
      const source = readFileSync(path, 'utf8');
      const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
        .outputText.split("from './limits'")
        .join("from './limits.mjs'");
      writeFileSync(join(dir, `${name}.mjs`), js);
    }
    const loaded = {};
    for (const name of Object.keys(files)) loaded[name] = await import(pathToFileURL(join(dir, `${name}.mjs`)).href);
    return loaded;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const { 'frame-doc': frameDoc, samples } = await loadTs({
  limits: join(folder, 'src', 'limits.ts'),
  'frame-doc': join(folder, 'src', 'frame-doc.ts'),
  samples: join(here, 'samples.ts'),
});

const bundle = readFileSync(bundlePath, 'utf8');
const policyMeta = `<meta http-equiv="Content-Security-Policy" content="${frameDoc.FRAME_CSP}">`;
const withPolicy = frameDoc.buildFrameDocument(bundle);
if (!withPolicy.includes(policyMeta)) throw new Error('The frame document does not carry its policy.');
const withoutPolicy = withPolicy.replace(policyMeta, '');
// The one hostile output that exists only with HTML labels: with labels as SVG text Mermaid never writes it.
const withoutPolicyHtmlLabels = withoutPolicy.split('"htmlLabels":false').join('"htmlLabels":true');
if (withoutPolicyHtmlLabels === withoutPolicy) throw new Error('The configuration was not found in the boot script.');

const browser = await chromium.launch({ headless: true });
const chromiumVersion = browser.version();

/** Draws one diagram text in a fresh frame made from `doc` and returns the SVG. */
async function draw(doc, text) {
  const page = await (await browser.newContext()).newPage();
  try {
    await page.setContent('<!doctype html><body></body>');
    return await page.evaluate(
      ({ doc, text, size }) =>
        new Promise((resolve, reject) => {
          const frame = document.createElement('iframe');
          frame.setAttribute('sandbox', 'allow-scripts');
          frame.style.width = `${size.width}px`;
          frame.style.height = `${size.height}px`;
          frame.srcdoc = doc;
          addEventListener('message', (event) => {
            if (event.source !== frame.contentWindow) return;
            const data = event.data;
            if (data.kind === 'ready') frame.contentWindow.postMessage({ kind: 'render', id: 1, text, theme: 'default' }, '*');
            if (data.kind === 'done') resolve(data.svg);
            if (data.kind === 'error') reject(new Error('The engine could not draw this diagram.'));
          });
          document.body.appendChild(frame);
        }),
      { doc, text, size: { width: frameDoc.FRAME_WIDTH_PX, height: frameDoc.FRAME_HEIGHT_PX } },
    );
  } finally {
    await page.context().close();
  }
}

const outputs = {};
for (const [name, text] of Object.entries(samples.SAMPLES)) outputs[name] = await draw(withPolicy, text);

const hostile = {
  'theme-css-with-url': [withoutPolicy, 'init_themeCSS'],
  'font-family-with-url': [withoutPolicy, 'init_fontFamily'],
  'link-element-with-outside-address': [withoutPolicy, 'click_href'],
  'image-element-with-outside-address': [withoutPolicyHtmlLabels, 'svg_foreign'],
};
const attackOutputs = {};
for (const [name, [doc, key]] of Object.entries(hostile)) {
  attackOutputs[name] = await draw(doc, samples.ATTACKS[key].split('{PORT}').join('9'));
}
await browser.close();

const date = new Date().toISOString().slice(0, 10);
const header = `/**
 * What Mermaid ${installed.version} drew, as recorded by record-outputs.mjs on ${date} in Chromium ${chromiumVersion}.
 * RECORDED_OUTPUTS: the 22 sample diagrams of samples.ts drawn with this folder's own frame document (security level
 * strict, labels as SVG text, theme default), one fresh frame each. RECORDED_ATTACK_OUTPUTS: four hostile diagrams
 * drawn with the frame's policy removed (the last one with HTML labels on as well, because Mermaid never writes it
 * otherwise); the scrub must refuse every one of them. Do not edit by hand: run the script again.
 */
`;
const body =
  `export const RECORDED_OUTPUTS: Readonly<Record<string, string>> = ${JSON.stringify(outputs, null, 2)};\n\n` +
  `export const RECORDED_ATTACK_OUTPUTS: Readonly<Record<string, string>> = ${JSON.stringify(attackOutputs, null, 2)};\n`;
writeFileSync(join(here, 'recorded-outputs.ts'), header + '\n' + body);
console.log(`Wrote recorded-outputs.ts: ${Object.keys(outputs).length} outputs and ${Object.keys(attackOutputs).length} hostile outputs.`);
