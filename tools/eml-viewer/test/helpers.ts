// Shared by the test files. Messages are stored as JSON strings with CRLF escapes (never as .eml files, because the
// repository normalises line endings), so a test reads the JSON and encodes the string itself.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import type { WindowLike } from 'dompurify';

interface StoredMessage {
  rfc: string;
  section: string;
  text: string;
}

const stored = JSON.parse(readFileSync(new URL('./fixtures/rfc/messages.json', import.meta.url), 'utf8')) as {
  messages: Record<string, StoredMessage>;
};

/** The text of a stored message, line ends exactly as stored (CRLF). */
export function messageText(name: string): string {
  const entry = Object.hasOwn(stored.messages, name) ? stored.messages[name] : undefined;
  if (!entry) throw new Error(`no stored message called ${name}`);
  return entry.text;
}

/** The RFC and section a stored message is retyped from. */
export function messageSource(name: string): string {
  const entry = Object.hasOwn(stored.messages, name) ? stored.messages[name] : undefined;
  if (!entry) throw new Error(`no stored message called ${name}`);
  return `${entry.rfc} section ${entry.section}`;
}

export function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function messageBytes(name: string): Uint8Array {
  return bytesOf(messageText(name));
}

/** A browser-like window for the preview tests. Only small, shallow markup is ever given to it (never deep nesting). */
export function makeWindow(): WindowLike {
  return new JSDOM('', { url: 'https://example.invalid/' }).window as unknown as WindowLike;
}

/** A small deterministic generator, so a failing case can be replayed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
