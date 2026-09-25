import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

/**
 * Behavioural proof of D-56 / ROADMAP success criterion 4: the reference
 * seed, field list and count give byte-identical output in Node and in
 * every browser project. `MOCK_DATA_GOLDEN_SHA256` here is the same
 * literal `tools/mock-data/test/index.test.ts` asserts against a
 * Node-computed digest of the same input, so a mismatch here means a
 * browser engine produced different text than Node did for the exact same
 * seed.
 */
const rel = (path: string) => path.replace(/^\//, '');

const MOCK_DATA_GOLDEN_SHA256 = 'a06c7398253c4a28595ec42127071fd0440628138aea3172e6509bb7d5f22737';

const REFERENCE_FIELDS = [
  'id: id',
  'name: fullName',
  'email: email',
  'joined: date(2000-01-01, 2024-12-31)',
  'score: decimal(0, 100, 2)',
  'active: boolean',
  'ip: ipv4',
  'key: uuid',
].join('\n');

test('the reference seed gives byte-identical output in every browser', async ({ page }) => {
  await page.goto(rel('/tools/mock-data'));
  await page.locator('#f-seed').fill('demo');
  await page.locator('#f-count').fill('25');
  await page.locator('#f-fields').fill(REFERENCE_FIELDS);
  await page.locator('#f-format').selectOption('json');

  // The Output section's `code` block renders the tool's full text
  // verbatim inside a <pre> (apps/web/src/components/OutputView.tsx), so
  // textContent() here is exactly the byte-for-byte value this tool
  // produced -- not whitespace-normalised the way toContainText would be.
  //
  // The page runs as you type, so each of the four fills above triggers
  // its own re-run; the default field list already contains "key: uuid",
  // so a naive wait for the word "key" to appear would pass on the very
  // first (10-record, pre-fill) render and read a stale, still-updating
  // value. Polling for the record-25 marker -- which can only exist once
  // every fill above has actually taken effect -- and capturing the same
  // text the poll observed removes that race.
  const outputText = page.locator('section[aria-label="Output"] pre.output');
  await expect(outputText).toBeVisible({ timeout: 10_000 });
  let text: string | null = null;
  await expect
    .poll(
      async () => {
        text = await outputText.textContent();
        return text?.includes('"id": 25');
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const digest = createHash('sha256')
    .update(text ?? '', 'utf8')
    .digest('hex');
  expect(digest).toBe(MOCK_DATA_GOLDEN_SHA256);
});
