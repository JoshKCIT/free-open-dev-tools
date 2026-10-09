import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ZXING_CPP_COMMIT, ZXING_WASM_VERSION } from 'zxing-wasm/reader';

/**
 * The compiled-engine notice in meta.json must name the zxing-cpp source the installed zxing-wasm package was compiled
 * from. The package reports both facts itself (`ZXING_WASM_VERSION` and `ZXING_CPP_COMMIT`, exported from
 * `zxing-wasm/reader`), so the notice cannot go stale when the pin moves: this test reads the installed package, not a
 * number typed here.
 */
it('the compiled engine notice names the zxing-cpp commit of the installed zxing-wasm', () => {
  const meta = JSON.parse(readFileSync(new URL('../src/meta.json', import.meta.url), 'utf8')) as {
    dependencies: Record<string, string>;
    bundledData: Array<{ name: string; source: string; attribution: string }>;
  };
  expect(ZXING_WASM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  expect(ZXING_CPP_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  expect(meta.dependencies['zxing-wasm']).toBe(ZXING_WASM_VERSION);

  const notices = meta.bundledData.filter((entry) => entry.name.includes('zxing-wasm'));
  expect(notices).toHaveLength(1);
  const notice = notices[0]!;
  expect(notice.name.endsWith(`zxing-wasm ${ZXING_WASM_VERSION}`)).toBe(true);
  expect(notice.source.endsWith(`/tree/${ZXING_CPP_COMMIT}`)).toBe(true);
  expect(notice.attribution).toContain(`zxing-wasm ${ZXING_WASM_VERSION} compiles it`);
});
