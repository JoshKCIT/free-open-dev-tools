import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase 7's shared browser proof (07-01's own `<shared_procedure>` AP and
 * AT): for every validator that has both a page and a
 * `test/fixtures/broken/expected.json`, drives every broken fixture through
 * the page's real input and asserts the runner's own error list shows the
 * expected line and key path -- the first proof of success criterion 2
 * (line and key reporting) on real browser engines, not just the package's
 * own unit tests. For every YAML-based validator with a page, also proves
 * the shared worker time limit stops a pathological, tens-of-thousands-of-
 * keys mapping and leaves the page responsive. This file is owned by this
 * plan alone; every later phase 7 plan adds its own broken fixtures and
 * expected.json but never edits this spec (AS).
 */
const rel = (path: string) => path.replace(/^\//, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The 13 ids of AL that validate structured config against a schema or grammar with reported line/key positions. */
export const PHASE_7_VALIDATOR_IDS = [
  'dockerfile-lint',
  'docker-compose-validator',
  'k8s-validator',
  'github-actions-validator',
];

/** The three validators above that read YAML through the shared canonical `yaml-source.ts` and its worker time limit. */
export const YAML_VALIDATOR_IDS = ['docker-compose-validator', 'k8s-validator', 'github-actions-validator'];

/** Exceeds the measured time-limit threshold by at least three times on every browser project while staying under 5 MB (AT). */
export const PATHOLOGICAL_KEY_COUNT = 60000;

interface CatalogEntry {
  id: string;
  category: string;
}

const CATALOG = (
  JSON.parse(readFileSync(join(root, 'apps', 'web', 'src', 'generated-catalog.json'), 'utf8')) as {
    tools: CatalogEntry[];
  }
).tools;

/**
 * A fixed sleep clears the auto-run debounce with room to spare, then waits
 * for the Output section's own busy signal to clear -- copied from
 * `e2e/svg-optimizer.spec.ts`.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });
}

async function pressRunIfPresent(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Run', exact: true });
  if ((await button.count()) > 0) await button.click();
}

/**
 * Sets a textarea's value directly through its native setter and dispatches
 * one `input` event, instead of Playwright's own `fill()`, which routinely
 * exceeds a minute for a value this large in this sandboxed browser
 * environment (measured directly; see `e2e/yaml-formatter.spec.ts`'s own
 * comment on the same finding). This completes in well under a second and
 * drives the page's own onChange handler exactly as a real paste does.
 */
async function setLargeValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

interface ExpectedFinding {
  line: number;
  column?: number;
  path: string;
  message: string;
  severity?: 'error' | 'warning';
}

interface ExpectedFixture {
  file: string;
  findings: ExpectedFinding[];
}

test('the validator list names four devops tools in the catalog', () => {
  for (const id of PHASE_7_VALIDATOR_IDS) {
    const entry = CATALOG.find((c) => c.id === id);
    expect(entry, `${id} must be in docs/catalog.json`).toBeDefined();
    expect(entry!.category, id).toBe('devops');
  }
});

for (const id of PHASE_7_VALIDATOR_IDS) {
  const pagePath = join(root, 'apps', 'web', 'src', 'tools', `${id}.ts`);
  const expectedPath = join(root, 'tools', id, 'test', 'fixtures', 'broken', 'expected.json');
  if (!existsSync(pagePath) || !existsSync(expectedPath)) continue;

  test(`${id}: every broken fixture shows its line and key on the page`, async ({ page }) => {
    const expected: ExpectedFixture[] = JSON.parse(readFileSync(expectedPath, 'utf8'));
    await page.goto(rel(`/tools/${id}`));
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

    for (const fixture of expected) {
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      const text = readFileSync(join(root, 'tools', id, 'test', 'fixtures', 'broken', fixture.file), 'utf8');
      await page.locator('#f-input').fill(text);
      await pressRunIfPresent(page);
      await settle(page);

      const issueList = page.locator('section[aria-label="Output"] .issue-list');
      for (const finding of fixture.findings) {
        if (finding.severity === 'warning') {
          await expect(
            page.locator('section[aria-label="Output"]'),
            `${id}/${fixture.file}: expected warning text "${finding.message}"`,
          ).toContainText(finding.message);
          continue;
        }
        const item = issueList.locator('li', { hasText: `Line ${finding.line}` }).first();
        await expect(item, `${id}/${fixture.file}: expected an issue naming Line ${finding.line}`).toBeVisible();
        if (finding.path) {
          await expect(
            item,
            `${id}/${fixture.file}: expected the Line ${finding.line} issue to name "${finding.path}"`,
          ).toContainText(finding.path);
        }
      }
    }
  });
}

for (const id of YAML_VALIDATOR_IDS) {
  const pagePath = join(root, 'apps', 'web', 'src', 'tools', `${id}.ts`);
  if (!existsSync(pagePath)) continue;

  test(`${id}: a flat mapping with tens of thousands of keys is stopped by the time limit and the page stays responsive`, async ({
    page,
  }) => {
    await page.goto(rel(`/tools/${id}`));
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

    const lines: string[] = [];
    for (let i = 0; i < PATHOLOGICAL_KEY_COUNT; i++) lines.push(`k${i}: 1`);
    await setLargeValue(page, '#f-input', lines.join('\n'));
    await pressRunIfPresent(page);

    await expect(page.locator('section[aria-label="Output"]')).toContainText('Stopped after 2 seconds:', {
      timeout: 6_000,
    });

    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.locator('#f-input')).toHaveValue('', { timeout: 1_000 });
  });
}
