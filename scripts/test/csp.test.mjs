import { describe, it, expect } from 'vitest';
import { DIRECTIVE_ORDER, inlineScriptHashes, metaTag, NEEDS, parsePolicy, policyFor } from '../lib/csp.mjs';

/**
 * The page policy library decides what every page of the site may load. These tests compare whole policy strings, so a
 * change to a directive, its order or a source shows up as a visible difference rather than passing a loose check.
 */
const THEME = 'sha256-DvKdmHsoGS0QKTGkcM79dyfmQ4bv4uVjjTcb4ycB7M4=';

const BASELINE = [
  "default-src 'none'",
  `script-src 'self' '${THEME}'`,
  "style-src 'self'",
  'img-src data: blob:',
  "font-src 'none'",
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "manifest-src 'none'",
].join('; ');

describe('policyFor', () => {
  it('gives the baseline exactly when a page declares nothing', () => {
    expect(policyFor({ needs: [], scriptHashes: [THEME] })).toBe(BASELINE);
  });

  it('sets worker-src to blob and changes nothing else when workers is declared', () => {
    const policy = policyFor({ needs: ['workers'], scriptHashes: [THEME] });
    expect(policy).toBe(BASELINE.replace("worker-src 'none'", 'worker-src blob:'));
  });
});

describe('inlineScriptHashes', () => {
  it('gives one hash for a script written with CRLF and with LF', () => {
    const lf = '<script>\n  var a = 1;\n  var b = 2;\n</script>';
    const crlf = '<script>\r\n  var a = 1;\r\n  var b = 2;\r\n</script>';
    expect(inlineScriptHashes(crlf)).toEqual(inlineScriptHashes(lf));
    expect(inlineScriptHashes(lf)).toHaveLength(1);
  });

  it('leaves out a script that has a src attribute', () => {
    const html = '<script type="module" src="/assets/index.js"></script><script>var x = 1;</script>';
    expect(inlineScriptHashes(html)).toHaveLength(1);
  });
});

describe('metaTag', () => {
  it('holds no double quote inside the content attribute', () => {
    const policy = policyFor({ needs: ['eval', 'wasm', 'workers', 'sandboxed-html'], scriptHashes: [THEME] });
    const tag = metaTag(policy);
    expect(tag).toBe(`<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    const content = tag.slice(tag.indexOf('content="') + 'content="'.length, tag.lastIndexOf('"'));
    expect(content).not.toContain('"');
  });
});

describe('the vocabulary and the order', () => {
  it('keeps the closed list sorted and the directive order fixed', () => {
    expect([...NEEDS]).toEqual(['eval', 'mermaid-frame', 'sandboxed-html', 'wasm', 'workers']);
    expect(DIRECTIVE_ORDER).toHaveLength(13);
    expect(parsePolicy(BASELINE).size).toBe(13);
  });
});
