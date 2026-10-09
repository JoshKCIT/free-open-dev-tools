import { expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { EXPANSION_MESSAGE, PdfToolError, checkExpansion } from '../src/index';
import { pageWith } from './bombs';
import { pictureStream } from './picture-builders';

/**
 * A stream whose dictionary says `/Subtype /Image` is left out of the memory check when it is only drawn as a picture,
 * and counted when something a reader decodes uses it: ISO 32000-1:2008 section 7.8.2 (a page's `/Contents` is one
 * content stream or an array of them), section 7.3.8 (streams), section 7.5.7 (object streams) and section 7.3.10
 * (an indirect reference is `number generation R`). The readers do not look at `/Subtype` when they decode such a stream:
 * PDF.js decoded a picture-labelled `/Contents` stream and read the text in it (probe in the plan's SUMMARY).
 *
 * Every title is a top-level `it(...)` call (see index.test.ts for why). To keep runs fast the cap is 1 MiB for one
 * stream and the data is 2 MiB of zeros written as Flate by the platform's zlib (the second opinion, never the code under
 * test), as expansion.test.ts does.
 */
const MIB = 1024 * 1024;

async function refusal(promise: Promise<unknown>): Promise<PdfToolError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(PdfToolError);
    return err as PdfToolError;
  }
  throw new Error('The check accepted a file it should have refused.');
}

it('a picture-labelled stream used as page content that expands past the cap is refused with the plain message', async () => {
  const flate = deflateSync(Buffer.alloc(2 * MIB));
  const bomb = pageWith('/Contents 4 0 R', [{ number: 4, body: pictureStream('', flate) }]);
  const error = await refusal(checkExpansion(bomb, { limits: { perStream: 1 * MIB } }));
  expect(error.kind).toBe('size');
  expect(error.message).toBe('This PDF expands to more data than this page can hold in memory.');
  expect(error.message).toBe(EXPANSION_MESSAGE);

  // Under the cap the same file is accepted, and the picture is counted as used, not as an image.
  const report = await checkExpansion(bomb, { limits: { perStream: 4 * MIB } });
  expect(report.picturesCounted).toBe(1);
  expect(report.decoded).toBe(1);
  expect(report.images).toBe(0);
  expect(report.decodedBytes).toBe(2 * MIB);
});

it('pictures used only as images, soft masks or masks are still left out and counted as images', async () => {
  const flate = deflateSync(Buffer.alloc(2 * MIB));
  const drawn = pageWith('/Resources << /XObject << /Im0 4 0 R >> >>', [{ number: 4, body: pictureStream('', flate) }]);
  const report = await checkExpansion(drawn, { limits: { perStream: 1 * MIB } });
  expect(report.streams).toBe(1);
  expect(report.images).toBe(1);
  expect(report.decoded).toBe(0);
  expect(report.picturesCounted).toBe(0);
  expect(report.decodedBytes).toBe(0);
});
