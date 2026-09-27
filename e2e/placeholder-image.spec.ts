import { test, expect, type Page } from '@playwright/test';

/**
 * The dedicated PNG-size, SVG-well-formedness and privacy proof for
 * Placeholder Image Generator, on top of the phase-wide proof
 * `e2e/file-tools.spec.ts` already runs for this tool's own file-tool
 * fixture. `withRequestRecorder` is copied in shape from
 * `e2e/pdf-to-image.spec.ts`'s own helper (the same finding this phase's
 * every earlier plan has already recorded for `e2e/hash-file.spec.ts`,
 * which has no such logic at all).
 */
const rel = (path: string) => path.replace(/^\//, '');

async function withRequestRecorder(page: Page, action: () => Promise<void>): Promise<string[]> {
  const requests: string[] = [];
  const handler = (req: import('@playwright/test').Request) => {
    const url = req.url();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) requests.push(`${req.method()} ${url}`);
  };
  page.on('request', handler);
  try {
    await action();
  } finally {
    page.off('request', handler);
  }
  return requests;
}

function readIhdrSize(png: Buffer): { width: number; height: number } {
  // W3C PNG Third Edition section 11.2.2 "IHDR": Width and Height are
  // 4-byte big-endian unsigned integers, the first eight bytes of IHDR's
  // own chunk data, which itself starts right after the fixed 8-byte
  // signature and IHDR's own 8-byte length+type header.
  const dataStart = 8 + 8;
  return { width: png.readUInt32BE(dataStart), height: png.readUInt32BE(dataStart + 4) };
}

test('placeholder-image produces a PNG of the requested size and an SVG this browser parses', async ({ page }) => {
  await page.goto(rel('/tools/placeholder-image'));
  await page.waitForLoadState('networkidle');

  const requests = await withRequestRecorder(page, async () => {
    await page.locator('#f-width').fill('300');
    await page.locator('#f-height').fill('150');
    await page.locator('input[name="format"][value="both"]').check();

    const output = page.locator('section[aria-label="Output"]');
    await expect(output).toContainText('300 × 150');

    const downloadPromise = page.waitForEvent('download');
    // Two downloadable outputs exist (the SVG `code` block and the PNG
    // `files` block); the PNG's own list item is the one whose visible text
    // names a `.png` file, distinguishing it from the SVG's own Download
    // button regardless of which block happens to render first.
    await page.locator('li', { hasText: '.png' }).getByRole('button', { name: 'Download', exact: true }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    const fs = await import('node:fs');
    const pngBytes = fs.readFileSync(path!);
    expect(pngBytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const { width, height } = readIhdrSize(pngBytes);
    expect(width).toBe(300);
    expect(height).toBe(150);

    const svgText = await page.locator('pre.output', { hasText: '<svg' }).first().innerText();
    const parseCheck = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const parserError = doc.getElementsByTagName('parsererror');
      const svgEl = doc.documentElement;
      return {
        hasParserError: parserError.length > 0,
        width: svgEl ? Number(svgEl.getAttribute('width')) : null,
        height: svgEl ? Number(svgEl.getAttribute('height')) : null,
      };
    }, svgText);
    expect(parseCheck.hasParserError).toBe(false);
    expect(parseCheck.width).toBe(300);
    expect(parseCheck.height).toBe(150);
  });

  expect(requests).toEqual([]);
});
