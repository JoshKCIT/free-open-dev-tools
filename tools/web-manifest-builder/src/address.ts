import { stripAscii } from './ascii';

/** The manifest address used when none that can be read is typed. */
export const DEFAULT_MANIFEST_URL = 'https://example.com/manifest.webmanifest';
/** The page address used when none that can be read is typed. */
export const DEFAULT_PAGE_URL = 'https://example.com/';

/**
 * Reads the manifest address or the page address that the other addresses are resolved against. It must be a full http
 * or https address; anything else (empty, a relative address, another scheme, text the URL parser refuses) is replaced
 * by the fallback and the reason is named, so a run always completes. The address is only text and is never requested.
 */
export function resolveAddress(text: string, fallback: string): { url: URL; problem: 'empty' | 'unreadable' | null } {
  const trimmed = stripAscii(text);
  if (trimmed === '') return { url: new URL(fallback), problem: 'empty' };
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') return { url, problem: null };
  } catch {
    // Not an address the URL parser can read: the fallback is used below.
  }
  return { url: new URL(fallback), problem: 'unreadable' };
}
