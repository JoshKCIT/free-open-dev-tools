import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { woff2Compress, woff2Decompress } from '../src/engine';
import { FONT_FILES, fontBytes } from './fixtures/fonts';

/*
 * The page's WOFF2 engine is woff2-encoder 2.0.0, Google's woff2 and Brotli built with Emscripten 3.1.46. wawoff2 2.0.1 is a
 * second build of the same Google code by a different project, used here as the second opinion: both are called in-process
 * and the bytes they return are compared one by one. Neither is called through a shell.
 */

interface Wawoff2 {
  compress(font: Uint8Array): Promise<Uint8Array>;
  decompress(woff2: Uint8Array): Promise<Uint8Array>;
}

const require = createRequire(import.meta.url);
const wawoff2 = require('wawoff2') as Wawoff2;

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));

const SFNT_FILES = Object.keys(FONT_FILES).filter((name) => /\.(ttf|otf|ttc)$/.test(name));
const WOFF2_FILES = Object.keys(FONT_FILES).filter((name) => name.endsWith('.woff2'));

it('the engine output equals wawoff2 byte for byte for compress and decompress on every committed font', async () => {
  // Seven single fonts and a collection are compressed by both; the outputs must be the same bytes, and both decoders must
  // give the same bytes back from the engine's output.
  expect(SFNT_FILES.length).toBeGreaterThanOrEqual(8);
  for (const name of SFNT_FILES) {
    const font = fontBytes(name);
    const mine = await woff2Compress(font);
    const theirs = new Uint8Array(await wawoff2.compress(Buffer.from(font)));
    expect(same(mine, theirs), `compress ${name}`).toBe(true);
    const backMine = await woff2Decompress(mine);
    const backTheirs = new Uint8Array(await wawoff2.decompress(Buffer.from(mine)));
    expect(same(backMine, backTheirs), `decompress ${name}`).toBe(true);
  }
  // The WOFF2 files fontTools wrote are decoded alike by the two builds.
  expect(WOFF2_FILES.length).toBeGreaterThanOrEqual(2);
  for (const name of WOFF2_FILES) {
    const woff2 = fontBytes(name);
    const mine = await woff2Decompress(woff2);
    const theirs = new Uint8Array(await wawoff2.decompress(Buffer.from(woff2)));
    expect(same(mine, theirs), `decompress ${name}`).toBe(true);
  }
});
