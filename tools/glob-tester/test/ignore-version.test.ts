import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { meta as toolMeta } from '../src/index';

/**
 * Top-level `it(...)` only, never nested in `describe(...)`: the verify scripts match a required title by exact
 * equality with the name the JSON reporter writes.
 *
 * The .gitignore engine is the `ignore` package, and a different release decides some patterns differently, so the
 * release is pinned exactly in three places that must name one version: the tool's meta (the source of the generated
 * package file and README), the folder's package file, and the package installed beside the folder. This test holds
 * for any later move of the pin; it does not name a version itself.
 */

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')) as Record<string, unknown>;
}

it('meta and the folder package pin the ignore package to the exact version installed', () => {
  const metaPin = toolMeta.dependencies['ignore'];
  const folderPackage = readJson('../package.json') as { dependencies: Record<string, string> };
  const folderPin = folderPackage.dependencies['ignore'];
  const installed = readJson('../node_modules/ignore/package.json') as { version: string; name: string };

  expect(installed.name).toBe('ignore');
  // An exact version: three numbers, no range character, no tag.
  expect(metaPin).toMatch(/^\d+\.\d+\.\d+$/);
  expect(folderPin).toBe(metaPin);
  expect(installed.version).toBe(metaPin);
});
