import { describe, expect, it } from 'vitest';
import { KEY_FILE_NAMES, downloadMime, endWithOneLineFeed } from '../src/lib/download-mime';

const BINARY = 'application/octet-stream';
const TEXT = 'text/plain;charset=utf-8';

describe('downloadMime', () => {
  it('gives the binary type to the three SSH key names', () => {
    for (const name of ['id_rsa', 'id_ecdsa', 'id_ed25519']) expect(downloadMime(name)).toBe(BINARY);
  });

  it('gives the binary type to other names with no extension', () => {
    for (const name of ['_headers', 'README', 'Dockerfile']) expect(downloadMime(name)).toBe(BINARY);
  });

  it('gives the binary type to a name whose only dot is the leading one', () => {
    for (const name of ['.gitignore', '.env', '.htaccess', '.htpasswd']) expect(downloadMime(name), name).toBe(BINARY);
  });

  it('keeps the text type for names that already carry an extension', () => {
    for (const name of ['id_ed25519.pub', 'private-key.pem', '.env.local', 'formatted.go', 'data.h', 'a.b.c']) {
      expect(downloadMime(name), name).toBe(TEXT);
    }
  });

  it('treats a trailing dot or a dot followed by a symbol as no extension', () => {
    expect(downloadMime('notes.')).toBe(BINARY);
    expect(downloadMime('a.-')).toBe(BINARY);
  });

  it('lists exactly the three key names', () => {
    expect([...KEY_FILE_NAMES]).toEqual(['id_rsa', 'id_ecdsa', 'id_ed25519']);
  });
});

describe('endWithOneLineFeed', () => {
  it('adds one line feed when the text has none', () => {
    expect(endWithOneLineFeed('ssh-ed25519 AAAA')).toBe('ssh-ed25519 AAAA\n');
  });

  it('keeps exactly one when the text already ends with one', () => {
    expect(endWithOneLineFeed('line\n')).toBe('line\n');
  });

  it('cuts several final line feeds back to one', () => {
    expect(endWithOneLineFeed('line\n\n\n')).toBe('line\n');
  });

  it('leaves line feeds inside the text alone', () => {
    expect(endWithOneLineFeed('a\n\nb')).toBe('a\n\nb\n');
  });
});
