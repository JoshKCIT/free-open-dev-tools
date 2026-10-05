import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../lib/catalog.mjs';
import {
  DIRECTIVE_ORDER,
  inlineScriptHashes,
  mermaidFrameHashes,
  metaTag,
  NEEDS,
  parsePolicy,
  policyFor,
} from '../lib/csp.mjs';

/**
 * The page policy library decides what every page of the site may load. These tests compare whole policy strings, so a
 * change to a directive, its order or a source shows up as a visible difference rather than passing a loose check.
 */
const THEME = 'sha256-DvKdmHsoGS0QKTGkcM79dyfmQ4bv4uVjjTcb4ycB7M4=';
const FRAME_A = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const FRAME_B = 'sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';

/** The text of a policy, written out directive by directive so a reader can see what each page gets. */
function expected({ script = '', style = "'self'", worker = "'none'" } = {}) {
  return [
    "default-src 'none'",
    `script-src 'self' '${THEME}'${script}`,
    `style-src ${style}`,
    'img-src data: blob:',
    "font-src 'none'",
    "connect-src 'none'",
    `worker-src ${worker}`,
    "frame-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "manifest-src 'none'",
  ].join('; ');
}

const BASELINE = expected();
const policy = (needs, frameHashes = []) => policyFor({ needs, scriptHashes: [THEME], frameHashes });

/** Every subset of the closed list, so a rule is checked for every combination a tool could declare. */
const SUBSETS = Array.from({ length: 1 << NEEDS.length }, (_, mask) => NEEDS.filter((_, i) => mask & (1 << i)));

describe('policyFor', () => {
  it('gives the baseline exactly when a page declares nothing', () => {
    expect(policyFor({ needs: [], scriptHashes: [THEME] })).toBe(BASELINE);
  });

  it('sets worker-src to blob and changes nothing else when workers is declared', () => {
    const result = policyFor({ needs: ['workers'], scriptHashes: [THEME] });
    expect(result).toBe(BASELINE.replace("worker-src 'none'", 'worker-src blob:'));
  });

  it('gives the expected whole policy for every need on its own', () => {
    expect(policy(['eval'])).toBe(expected({ script: " 'unsafe-eval'" }));
    expect(policy(['wasm'])).toBe(expected({ script: " 'wasm-unsafe-eval'" }));
    expect(policy(['sandboxed-html'])).toBe(expected({ style: "'self' 'unsafe-inline'" }));
    expect(policy(['workers'])).toBe(expected({ worker: 'blob:' }));
    expect(policy(['mermaid-frame'], [FRAME_A, FRAME_B])).toBe(
      expected({ script: ` '${FRAME_A}' '${FRAME_B}'`, style: "'self' 'unsafe-inline'" }),
    );
  });

  it('gives the expected whole policy for every combination the catalog uses', () => {
    expect(policy(['wasm', 'workers'])).toBe(expected({ script: " 'wasm-unsafe-eval'", worker: 'blob:' }));
    expect(policy(['eval', 'workers'])).toBe(expected({ script: " 'unsafe-eval'", worker: 'blob:' }));
    expect(policy(['sandboxed-html', 'wasm', 'workers'])).toBe(
      expected({ script: " 'wasm-unsafe-eval'", style: "'self' 'unsafe-inline'", worker: 'blob:' }),
    );
  });

  it('puts the frame hashes in only when the Mermaid frame is declared', () => {
    expect(policy(['workers'], [FRAME_A, FRAME_B])).not.toContain(FRAME_A);
    expect(policy(['mermaid-frame'], [FRAME_A, FRAME_B])).toContain(`'${FRAME_A}' '${FRAME_B}'`);
  });

  it('never lets a worker load from an address, whatever the needs', () => {
    for (const needs of SUBSETS) {
      const workers = parsePolicy(policy(needs, [FRAME_A, FRAME_B])).get('worker-src');
      expect(workers, needs.join('+')).toEqual(needs.includes('workers') ? ['blob:'] : ["'none'"]);
    }
  });

  it('writes no directive twice and never one a meta policy ignores, for every combination', () => {
    for (const needs of SUBSETS) {
      const text = policy(needs, [FRAME_A, FRAME_B]);
      const names = text.split('; ').map((part) => part.split(' ')[0]);
      expect(names, needs.join('+')).toEqual([...DIRECTIVE_ORDER]);
      expect(new Set(names).size).toBe(names.length);
      for (const ignored of ['frame-ancestors', 'report-uri', 'sandbox']) expect(text).not.toContain(ignored);
    }
  });

  it('keeps every outside source and unsafe-inline out of script-src, for every combination', () => {
    for (const needs of SUBSETS) {
      const scripts = parsePolicy(policy(needs, [FRAME_A, FRAME_B])).get('script-src');
      for (const bad of ["'unsafe-inline'", '*', 'http:', 'https:', 'data:', 'blob:']) {
        expect(scripts, `${needs.join('+')} ${bad}`).not.toContain(bad);
      }
      expect(scripts.includes("'unsafe-eval'")).toBe(needs.includes('eval'));
      expect(scripts.includes("'wasm-unsafe-eval'")).toBe(needs.includes('wasm'));
    }
  });

  it('writes the same text on every call for the same input', () => {
    for (const needs of SUBSETS) {
      expect(policy(needs, [FRAME_A, FRAME_B])).toBe(policy([...needs].reverse(), [FRAME_A, FRAME_B]));
    }
  });

  it('refuses a need outside the closed list', () => {
    expect(() => policyFor({ needs: ['network'], scriptHashes: [THEME] })).toThrow(/not a need/);
    expect(() => policyFor({ needs: ['workers', 'unsafe-inline'], scriptHashes: [THEME] })).toThrow(/closed list/);
  });

  it('refuses a malformed hash among the page hashes or the frame hashes', () => {
    expect(() => policyFor({ needs: [], scriptHashes: ['sha256-bad hash'] })).toThrow(/sha256/);
    expect(() => policyFor({ needs: [], scriptHashes: ["'self' 'unsafe-inline'"] })).toThrow(/sha256/);
    expect(() => policyFor({ needs: ['mermaid-frame'], scriptHashes: [THEME], frameHashes: ['md5-abcd'] })).toThrow(
      /sha256/,
    );
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

  it('lists scripts in document order and each hash once', () => {
    const html = '<script>one</script><script>two</script><script>one</script>';
    const hash = (text) => `sha256-${createHash('sha256').update(text).digest('base64')}`;
    expect(inlineScriptHashes(html)).toEqual([hash('one'), hash('two')]);
  });
});

describe('metaTag', () => {
  it('holds no double quote inside the content attribute', () => {
    const text = policy(['eval', 'wasm', 'workers', 'sandboxed-html']);
    const tag = metaTag(text);
    expect(tag).toBe(`<meta http-equiv="Content-Security-Policy" content="${text}" />`);
    const content = tag.slice(tag.indexOf('content="') + 'content="'.length, tag.lastIndexOf('"'));
    expect(content).not.toContain('"');
  });

  it('refuses a policy that would break out of the attribute', () => {
    expect(() => metaTag('default-src "none"')).toThrow(/double quote/);
  });
});

describe('parsePolicy', () => {
  it('gives back every directive with its tokens', () => {
    const parsed = parsePolicy(policy(['eval', 'workers']));
    expect([...parsed.keys()]).toEqual([...DIRECTIVE_ORDER]);
    expect(parsed.get('script-src')).toEqual(["'self'", `'${THEME}'`, "'unsafe-eval'"]);
    expect(parsed.get('worker-src')).toEqual(['blob:']);
    expect(parsed.get('img-src')).toEqual(['data:', 'blob:']);
    expect(parsed.get('default-src')).toEqual(["'none'"]);
  });
});

describe('the closed vocabulary', () => {
  it('stays the five terms, sorted, with a fixed directive order', () => {
    expect([...NEEDS]).toEqual(['eval', 'mermaid-frame', 'sandboxed-html', 'wasm', 'workers']);
    expect(DIRECTIVE_ORDER).toHaveLength(13);
    expect(Object.isFrozen(NEEDS)).toBe(true);
    expect(Object.isFrozen(DIRECTIVE_ORDER)).toBe(true);
  });
});

/**
 * The frame hashes are never written into this file as text: a Mermaid upgrade changes them, and the live render test
 * fails visibly if they are wrong. Instead the frame document is built a second way here (the folder's own two files
 * compiled with the repository's typescript and loaded) and its two script bodies are hashed with node:crypto directly.
 */
describe('mermaidFrameHashes', () => {
  it('gives the two hashes of the scripts in a frame document built from the same bundle', () => {
    const require = createRequire(join(ROOT, 'package.json'));
    const ts = require('typescript');
    const sourceDir = join(ROOT, 'tools', 'mermaid-renderer', 'src');
    const scratch = mkdtempSync(join(tmpdir(), 'fodt-frame-check-'));
    let frameDocument;
    try {
      for (const name of ['limits', 'frame-doc']) {
        const compiled = ts.transpileModule(readFileSync(join(sourceDir, `${name}.ts`), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        writeFileSync(join(scratch, `${name}.cjs`), compiled.replace('require("./limits")', 'require("./limits.cjs")'));
      }
      const { buildFrameDocument } = createRequire(join(scratch, 'loader.cjs'))('./frame-doc.cjs');
      const bundle = readFileSync(
        join(ROOT, 'tools', 'mermaid-renderer', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
        'utf8',
      );
      frameDocument = buildFrameDocument(bundle);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    const bodies = [...frameDocument.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(bodies).toHaveLength(2);
    const direct = bodies.map(
      (body) => `sha256-${createHash('sha256').update(body.replace(/\r\n?/g, '\n')).digest('base64')}`,
    );

    const hashes = mermaidFrameHashes(ROOT);
    expect(hashes).toHaveLength(2);
    expect(new Set(hashes).size).toBe(2);
    expect(hashes).toEqual(direct);
    for (const hash of hashes) expect(hash).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
  });

  it('gives the same answer twice', () => {
    expect(mermaidFrameHashes(ROOT)).toEqual(mermaidFrameHashes(ROOT));
  });
});
