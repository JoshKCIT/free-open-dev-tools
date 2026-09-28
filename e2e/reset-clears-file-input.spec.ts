import { test, expect } from '@playwright/test';

/**
 * Fix for `.planning/WINDOWS.md` id 21: pressing Reset cleared the app's own
 * selected-file summary, but the shared field layer's `<input type="file">`
 * is an uncontrolled element, so the browser kept showing the previously
 * chosen file's name until a new one was picked (confirmed on the live
 * hash-file page too). `apps/web/src/components/ToolRunner.tsx` now bumps a
 * `resetSeq` counter on Reset and keys the file input on it, forcing React
 * to remount that one element, which is the only way to clear a native file
 * input's own display.
 *
 * Checked on hash-file and exif-viewer (a phase 9 file tool), since both use
 * a field named `file` and are simple enough to drive directly without the
 * phase-9 fixture/scenario machinery in `e2e/file-tools.spec.ts`.
 */
const rel = (path: string) => path.replace(/^\//, '');

const TOOL_IDS = ['hash-file', 'exif-viewer'];

for (const id of TOOL_IDS) {
  test(`${id}: pressing Reset clears the native file input, not only the selected-file summary`, async ({ page }) => {
    await page.goto(rel(`/tools/${id}`));
    const fileInput = page.locator('#f-file');

    await fileInput.setInputFiles({
      name: 'reset-check.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('reset check', 'utf8'),
    });

    // The app's own selected-file summary appears once a file is chosen.
    await expect(page.locator('.field-help', { hasText: 'reset-check.txt' })).toBeVisible();

    await page.getByRole('button', { name: 'Reset', exact: true }).click();

    // The app's own summary is gone...
    await expect(page.locator('.field-help', { hasText: 'reset-check.txt' })).toHaveCount(0);

    // ...and so is the browser's own native record of the chosen file: a
    // fresh, unmounted-and-remounted <input type="file"> reports no files
    // and an empty value, exactly like a page nothing was ever picked on.
    const native = await fileInput.evaluate((el: HTMLInputElement) => ({
      filesLength: el.files ? el.files.length : -1,
      value: el.value,
    }));
    expect(native.filesLength).toBe(0);
    expect(native.value).toBe('');
  });
}
