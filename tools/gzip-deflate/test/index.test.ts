import { it, expect, describe } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { decompress, compress, meta } from '../src/index';

describe('meta', () => {
  it('id/name/summary match the catalog entry shape', () => {
    expect(meta.id).toBe('gzip-deflate');
    expect(meta.name).toBe('Gzip, Zlib & Deflate Codec');
    expect(meta.limits.length).toBeGreaterThan(0);
  });
});

describe('the bundled example', () => {
  it("this tool's own compress of a short multi-line text decodes with Node gunzipSync", () => {
    const text = 'Hello from gzip.\nCompressed in the browser.\n';
    const c = compress(text, {
      inputKind: 'text',
      format: 'gzip',
      level: 6,
      outputEncoding: 'base64',
      percentEncode: false,
    });
    const nodeDecoded = gunzipSync(Buffer.from(c.text, 'base64')).toString('utf-8');
    expect(nodeDecoded).toBe(text);

    const d = decompress(c.text, { inputEncoding: 'base64' });
    expect(d.text).toBe(text);
  });
});

describe('a URL-encoded Base64 raw-deflate SAML-style value', () => {
  it('decompresses with container forced to raw', () => {
    const xml = '<samlp:AuthnRequest ID="_example"/>';
    const c = compress(xml, {
      inputKind: 'text',
      format: 'raw',
      level: 6,
      outputEncoding: 'base64',
      percentEncode: true,
    });
    const d = decompress(c.text, { inputEncoding: 'url-base64', container: 'raw' });
    expect(d.text).toBe(xml);
  });
});
