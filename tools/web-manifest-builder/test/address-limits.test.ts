import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAX_FIELD_CHARACTERS, ManifestBuilderError, manifestLinkTag, processManifest, withCommas } from '../src/index';

const MANIFEST_URL = 'https://example.com/manifest.webmanifest';
const PAGE_URL = 'https://example.com/';

const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, name).mockImplementation(() => {}));
  }
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function refusal(action: () => unknown): ManifestBuilderError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ManifestBuilderError);
    return error as ManifestBuilderError;
  }
  throw new Error('expected the address to be refused');
}

/** An address of exactly `length` characters. */
function addressOf(length: number): string {
  const start = 'https://example.com/';
  return start + 'a'.repeat(length - start.length);
}

it('the manifest address and the page address are limited to 2,048 characters like every other field, before any address is read', () => {
  expect(MAX_FIELD_CHARACTERS).toBe(2048);
  // Exactly at the limit is read; one more is refused, in each place that takes an address.
  expect(processManifest({}, addressOf(2048), PAGE_URL).processed.manifestUrl).toHaveLength(2048);
  expect(processManifest({}, MANIFEST_URL, addressOf(2048)).processed.pageUrl).toHaveLength(2048);
  const manifest = refusal(() => processManifest({}, addressOf(2049), PAGE_URL));
  expect(manifest.message).toBe(
    `The manifest address field holds more than ${withCommas(2048)} characters. The limit is ${withCommas(2048)} because a longer value would make the page slow to answer.`,
  );
  const page = refusal(() => processManifest({}, MANIFEST_URL, addressOf(2049)));
  expect(page.message).toContain('The page address field holds more than 2,048 characters.');
  expect(refusal(() => manifestLinkTag(addressOf(2049), PAGE_URL)).message).toContain('manifest address field');
  expect(refusal(() => manifestLinkTag(MANIFEST_URL, addressOf(2049))).message).toContain('page address field');
  // Characters are counted as code points, the way the other fields are.
  const emoji = String.fromCodePoint(0x1f600);
  const wide = 'https://example.com/' + emoji.repeat(2048 - 'https://example.com/'.length);
  expect(() => processManifest({}, wide, PAGE_URL)).not.toThrow();
  // Nothing typed is repeated.
  expect(
    refusal(() => processManifest({}, 'https://example.com/FODT-MARK-7731' + 'a'.repeat(3000), PAGE_URL)).message,
  ).not.toContain('FODT-MARK');
});

it('a very long address is refused at once, without reading it as an address', () => {
  const huge = 'https://example.com/' + 'a'.repeat(5_000_000);
  const started = performance.now();
  const error = refusal(() => processManifest({}, huge, PAGE_URL));
  const manifestMs = performance.now() - started;
  const started2 = performance.now();
  refusal(() => processManifest({}, MANIFEST_URL, huge));
  const pageMs = performance.now() - started2;
  expect(error.message).toContain('manifest address field');
  expect(manifestMs).toBeLessThan(200);
  expect(pageMs).toBeLessThan(200);
}, 60_000);
