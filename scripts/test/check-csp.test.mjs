import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { ROOT } from '../lib/catalog.mjs';
import { inlineScriptHashes, metaTag, policyFor } from '../lib/csp.mjs';
import {
  EVAL_PAGES,
  MERMAID_FRAME_PAGES,
  NO_COMPILE_PAGES,
  RESERVED_IDS,
  TOKENS,
  checkHtml,
  closures,
  judgePage,
  policyOfHtml,
  scanTokens,
  unreachedChunks,
} from '../check-csp.mjs';

/**
 * The build gate decides whether a page's declared needs agree with what its built code does, and whether every
 * written page carries its own policy first. A gate that cannot fail proves nothing, so every rule here is driven twice:
 * once on a fake build that breaks it (the gate must exit 1 and say which rule) and once on a fake build that obeys it.
 * The real script runs as a subprocess in a throwaway root, found from its own location the same way the prerender
 * test works, so the real repository's build is never touched.
 */

const THEME = 'document.documentElement.dataset.theme = "dark";';
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const write = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

/** A page the way the prerender step writes it: policy first, charset second, then the one hashed theme script. */
function pageHtml(needs, { script = THEME, frameHashes = [] } = {}) {
  const policy = policyFor({ needs, scriptHashes: inlineScriptHashes(`<script>${script}</script>`), frameHashes });
  return `<!doctype html>\n<html lang="en">\n  <head>\n    ${metaTag(policy)}\n    <meta charset="utf-8" />\n    <title>Fake</title>\n    <script>${script}</script>\n  </head>\n  <body></body>\n</html>\n`;
}

const NO_ACKS = { wasm: {}, eval: {}, fetch: {} };

/**
 * Writes a fake repository root holding the real gate and its library, an acknowledgement file, a meta.json per tool,
 * and a build folder with a manifest, chunk files and HTML for three site routes and every row.
 *
 * A row is `{ id, needs, code, extra }`: `needs` is what the page declares (its meta.json and its policy both follow
 * it), `code` is the text of the page's own chunk, and `extra` lists more chunks the page loads, each
 * `{ code, dynamic }`. `mutate(path, html)` may rewrite one written file.
 */
function makeFakeBuild({ rows, acks = NO_ACKS, shellCode = 'const shell=1;', mutate, manifest = true }) {
  const root = mkdtempSync(join(tmpdir(), 'fodt-check-csp-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'scripts', 'check-csp.mjs'), join(root, 'scripts', 'check-csp.mjs'));
  cpSync(join(ROOT, 'scripts', 'lib'), join(root, 'scripts', 'lib'), { recursive: true });
  write(join(root, 'scripts', 'csp-acks.json'), typeof acks === 'string' ? acks : JSON.stringify(acks));

  const dist = join(root, 'apps', 'web', 'dist');
  const entries = {
    'index.html': {
      file: 'assets/index.js',
      isEntry: true,
      imports: ['_react.js'],
      dynamicImports: rows.map((r) => `src/tools/${r.id}.ts`),
    },
    '_react.js': { file: 'assets/react.js' },
  };
  write(join(dist, 'assets', 'index.js'), shellCode);
  write(join(dist, 'assets', 'react.js'), 'const react=2;');

  const written = {};
  const site = ['index.html', 'tools/index.html', 'tools.html', '404.html'];
  for (const path of site) written[path] = pageHtml([]);

  for (const row of rows) {
    write(join(root, 'tools', row.id, 'src', 'meta.json'), JSON.stringify({ id: row.id, needs: row.needs }));
    const key = `src/tools/${row.id}.ts`;
    const entry = { file: `assets/${row.id}.js`, isDynamicEntry: true, imports: ['index.html', '_react.js'] };
    write(join(dist, entry.file), row.code ?? '');
    (row.extra ?? []).forEach((extra, index) => {
      const extraKey = `_${row.id}-${index}.js`;
      entries[extraKey] = { file: `assets/${row.id}-${index}.js` };
      write(join(dist, entries[extraKey].file), extra.code);
      (extra.dynamic ? (entry.dynamicImports ??= []) : entry.imports).push(extraKey);
    });
    entries[key] = entry;
    written[`tools/${row.id}.html`] = pageHtml(row.needs);
    written[`tools/${row.id}/index.html`] = pageHtml(row.needs);
  }

  if (manifest) write(join(dist, '.vite', 'manifest.json'), JSON.stringify(entries));
  for (const [path, html] of Object.entries(written)) write(join(dist, path), mutate ? mutate(path, html) : html);
  write(join(root, 'docs', 'catalog.json'), JSON.stringify(rows.map((r) => ({ id: r.id }))));
  const routes = ['', 'tools', ...rows.map((r) => `tools/${r.id}`)];
  write(
    join(dist, 'sitemap.xml'),
    `<urlset>${routes.map((r) => `<url><loc>https://example.test/site/${r}</loc></url>`).join('')}</urlset>`,
  );
  return root;
}

function runGate(root, args = []) {
  try {
    const out = execFileSync('node', [join(root, 'scripts', 'check-csp.mjs'), ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, out, err: '' };
  } catch (error) {
    return { code: error.status, out: String(error.stdout), err: String(error.stderr) };
  }
}

const expectPass = (root, args) => {
  const result = runGate(root, args);
  expect(result.err).toBe('');
  expect(result.code).toBe(0);
  return result.out;
};
const expectFail = (root, message, args) => {
  const result = runGate(root, args);
  expect(result.code, result.out).toBe(1);
  expect(result.err).toContain(message);
  return result.err;
};

const WORKER_CODE = 'const w=new Worker(u);';
const WASM_CODE = 'await WebAssembly.compile(bytes);';
const EVAL_CODE = 'const f=new Function("a","return a");';
const FETCH_CODE = 'async function load(u){return await fetch(u)}';
const PREVIEW_CODE = 'return {kind:"sandboxed-html",html:h};';

/** A passing build with one page per kind of need, none on the code generation list. */
const goodRows = () => [
  { id: 'plain', needs: [], code: 'const a=1;' },
  { id: 'worker-page', needs: ['workers'], code: WORKER_CODE },
  { id: 'wasm-page', needs: ['wasm', 'workers'], code: `${WASM_CODE}${WORKER_CODE}` },
  { id: 'preview-page', needs: ['sandboxed-html'], code: PREVIEW_CODE },
  { id: 'json-schema-validator', needs: ['eval', 'workers'], code: `${EVAL_CODE}${WORKER_CODE}` },
];

describe('the fixed lists and the token table', () => {
  it('spells all eight run-time code generation pages and the one page that may never compile', () => {
    expect([...EVAL_PAGES]).toEqual([
      'docker-compose-validator',
      'docker-run-to-compose',
      'font-inspector',
      'github-actions-validator',
      'json-schema-validator',
      'k8s-validator',
      'openapi-validator',
      'sass-less-compiler',
    ]);
    expect([...NO_COMPILE_PAGES]).toEqual(['wasm-inspector']);
    expect([...MERMAID_FRAME_PAGES]).toEqual(['mermaid-renderer']);
    expect([...RESERVED_IDS]).toEqual(['font-inspector', 'wasm-inspector']);
    expect(TOKENS.map(([name]) => name)).toEqual(['workers', 'wasm', 'eval', 'fetch', 'sandboxed-html']);
  });

  it('scans each token class and ignores a method call that only looks like one', () => {
    expect([...scanTokens('const w=new Worker(u);')]).toEqual(['workers']);
    expect([...scanTokens('x=Worker(u)')]).toEqual(['workers']);
    expect([...scanTokens('await WebAssembly.instantiateStreaming(r)')]).toEqual(['wasm']);
    expect([...scanTokens('new Function("a","return a")')]).toEqual(['eval']);
    expect([...scanTokens('x=eval(code)')]).toEqual(['eval']);
    expect([...scanTokens('await fetch(u)')]).toEqual(['fetch']);
    expect([...scanTokens('{kind: "sandboxed-html"}')]).toEqual(['sandboxed-html']);
    expect([...scanTokens('a.fetch(x); this.eval(y); xWorker(z); retrieveFunction("a")')]).toEqual([]);
  });

  it.each([
    ['an indirect eval through a comma', '(0,eval)(e)', 'eval'],
    ['an eval read from the global object', 'globalThis.eval(s)', 'eval'],
    ['an eval read from window', 'window.eval(s)', 'eval'],
    ['a timer given a string', 'setTimeout("f()",5)', 'eval'],
    ['an interval given a template', 'setInterval(`f()`,5)', 'eval'],
    ['a function made through a constructor property', '(function(){}).constructor("return this")()', 'eval'],
    ['a bare Function call with variable arguments', 'Function(a,b)', 'eval'],
    ['an eval at the very start of a chunk', 'eval(s)', 'eval'],
    ['the Function constructor passed as an argument', '(function(A,g){})(Function,h)', 'eval'],
    ['the Function constructor assigned', 'const F=Function;', 'eval'],
    ['the Function constructor assigned without a keyword', 'F=Function,G=1', 'eval'],
    ['the Function constructor applied through its own member', 'Function.apply(null,["a","return a"])', 'eval'],
    ['the Function constructor called through its own member', 'Function.call(null,"return this")()', 'eval'],
    ['the Function constructor bound through its own member', 'x=Function.bind(null,"return 1")', 'eval'],
    ['the Function constructor read from the global object', 'globalThis.Function("return this")()', 'eval'],
    ['the Function constructor read from self', 'self.Function("return this")()', 'eval'],
    ['the Function constructor read from window', 'window.Function(s)', 'eval'],
    ['the Function constructor called through a comma', '(0,Function)("return this")()', 'eval'],
    ['the Function constructor returned', 'function g(){return Function}', 'eval'],
    ['the Function constructor returned before a semicolon', 'if(a)return Function;', 'eval'],
    ['the Function constructor returned by an arrow', 'const g=()=>Function;', 'eval'],
    ['a shared worker', 'new SharedWorker(u)', 'workers'],
    ['WebAssembly copied into a variable', 'const W=WebAssembly;W.instantiate(b)', 'wasm'],
    ['WebAssembly destructured', 'const{instantiate:i}=WebAssembly', 'wasm'],
    ['a computed WebAssembly member', 'WebAssembly["instantiate"](b)', 'wasm'],
    ['a request object', 'const x=new XMLHttpRequest', 'fetch'],
    ['a request object read as a member', 'const x=new g.XMLHttpRequest', 'fetch'],
    ['a socket', 'new WebSocket(u)', 'fetch'],
    ['a server event stream', 'new EventSource(u)', 'fetch'],
    ['a beacon', 'navigator.sendBeacon(u,d)', 'fetch'],
    ['a fetch at the very start of a chunk', 'fetch(u)', 'fetch'],
  ])('detects %s', (_label, code, token) => {
    expect([...scanTokens(code)]).toEqual([token]);
  });

  it('keeps lookalike names and safe calls clean in every class', () => {
    for (const code of [
      'a.fetch(x)',
      'this.eval(y)',
      'xWorker(z)',
      'retrieveFunction("a")',
      'typeof WebAssembly<"u"',
      'isFunction(x)',
      'setTimeout(f,5)',
      'x.constructor(y)',
      'WebAssembly.validate(b)',
      'evaluate(x)',
      'refetch(x)',
      'such as a background worker, WebAssembly, or generating code',
      'a module (WebAssembly) in text',
      // Shapes found in built pages that hold the name but never generate code: a type-check list and a list of global
      // constructor names (pdf-lib and a JavaScript parser). A later argument, an array element and an object value are
      // not matched; only the first argument of a call and an assignment are.
      'check(e,"provider",[Function])',
      '[Object,Array,Function,Number,String,Boolean,Error,Math,Date,RegExp]',
      'make(a,Function)',
      'const o={ctor:Function}',
      'x.Function',
      'a.b=x.Function;',
      'Functional(x)',
      'const MyFunction=1;f(MyFunction,g)',
      'a===Function;',
      'a==Function)',
      'a!=Function;',
      'a<=Function;',
      'a>=Function;',
      'a instanceof Function',
      'if(a instanceof Function)run()',
      'typeof a==="function"',
      'a Function type in text',
      'a sentence that mentions the Function type, or a function.',
      // Lookalikes of the member, global, comma and return forms: a method of the prototype, a member of another object, a
      // longer name, and the word in a sentence.
      'Function.prototype.toString.call(f)',
      'Function.prototype.apply.call(f,a,b)',
      'x.Function.apply(a,b)',
      'isFunction.call(x)',
      'MyFunction.bind(x)',
      'myself.Function(x)',
      'a.window.Function(x)',
      '(0,MyFunction)(x)',
      '(0,Function.prototype)(x)',
      'return Functional;',
      'returnFunction}',
      'a function may return Function objects',
      '()=>MyFunction;',
      '()=>Function.prototype;',
    ]) {
      expect([...scanTokens(code)], code).toEqual([]);
    }
  });

  it('follows imports and dynamic imports from a page entry and never expands the shell', () => {
    const manifest = {
      'index.html': {
        file: 'i.js',
        imports: ['_r.js'],
        dynamicImports: ['src/tools/a.ts', 'src/tools/b.ts'],
      },
      '_r.js': { file: 'r.js' },
      'src/tools/a.ts': { file: 'a.js', imports: ['index.html', '_r.js', '_shared.js'], dynamicImports: ['_lazy.js'] },
      'src/tools/b.ts': { file: 'b.js', imports: ['index.html'] },
      '_shared.js': { file: 's.js', imports: ['_r.js'] },
      '_lazy.js': { file: 'l.js' },
    };
    const { shell, pages } = closures(manifest);
    expect([...shell].sort()).toEqual(['_r.js', 'index.html']);
    expect([...pages.get('a')].sort()).toEqual(['_lazy.js', '_shared.js', 'src/tools/a.ts']);
    expect([...pages.get('b')]).toEqual(['src/tools/b.ts']);
    expect(unreachedChunks(manifest, { shell, pages })).toEqual([]);
  });

  it('names a script chunk that neither the shell nor any tool page reaches, and ignores other assets', () => {
    const manifest = {
      'index.html': { file: 'i.js', imports: ['_r.js'], dynamicImports: ['src/tools/a.ts', 'src/pages/Lazy.tsx'] },
      '_r.js': { file: 'r.js' },
      'src/tools/a.ts': { file: 'a.js', imports: ['index.html'] },
      'src/pages/Lazy.tsx': { file: 'lazy.js', imports: ['_part.js'] },
      '_part.js': { file: 'part.js' },
      'engine.wasm': { file: 'engine.wasm' },
      'index.css': { file: 'index.css' },
    };
    expect(unreachedChunks(manifest, closures(manifest))).toEqual(['lazy.js', 'part.js']);
  });
});

describe('the rule table on single pages', () => {
  const judge = (id, needs, tokens = [], acks = []) => judgePage({ id, needs, tokens, acks });

  it('fails a page whose only code generation is an indirect eval, and one whose only worker is shared', () => {
    expect(judgePage({ id: 'x', needs: [], tokens: scanTokens('(0,eval)(s)'), acks: [] })[0]).toContain(
      'does not declare "eval"',
    );
    expect(judgePage({ id: 'x', needs: [], tokens: scanTokens('new SharedWorker(u)'), acks: [] })[0]).toContain(
      'does not declare "workers"',
    );
  });

  it('refuses a need outside the closed list', () => {
    expect(judge('p', ['font'])[0]).toContain('not on the closed list');
  });

  it('lets a declared eval cover a WebAssembly token without a separate wasm declaration', () => {
    expect(judge('json-schema-validator', ['eval'], ['eval', 'wasm'])).toEqual([]);
    expect(judge('p', ['workers'], ['workers', 'wasm'])[0]).toContain('does not declare "wasm"');
  });

  it('passes a page with no needs and no tokens and a page that acknowledges a token it never declares', () => {
    expect(judge('p', [])).toEqual([]);
    expect(judge('pdf-to-image', [], ['wasm'], ['wasm'])).toEqual([]);
  });

  it('fails a mermaid-frame declaration anywhere but the diagram page, and a diagram page without one', () => {
    expect(judge('plain', ['mermaid-frame'])[0]).toContain('only mermaid-renderer may declare');
    expect(judge('mermaid-renderer', [])[0]).toContain('must declare "mermaid-frame"');
    expect(judge('mermaid-renderer', ['mermaid-frame'])).toEqual([]);
  });

  it('fails eval outside the fixed list and a fixed list page without eval, and passes a listed page', () => {
    expect(judge('plain', ['eval'], ['eval'])[0]).toContain('allowed only on the fixed list');
    expect(judge('k8s-validator', [], ['eval']).join(' ')).toContain('must declare "eval"');
    expect(judge('k8s-validator', ['eval'], ['eval'])).toEqual([]);
  });

  it('never lets the reserved inspector declare wasm or eval', () => {
    expect(judge('wasm-inspector', ['wasm'], ['wasm']).join(' ')).toContain('may never declare "wasm"');
    expect(judge('wasm-inspector', ['eval'], ['eval']).join(' ')).toContain('may never declare "eval"');
    expect(judge('wasm-inspector', [])).toEqual([]);
  });
});

describe('a fake build through the real gate', () => {
  it('passes and prints one policy line per distinct policy, sorted, then one success line', () => {
    const root = makeFakeBuild({ rows: goodRows() });
    const out = expectPass(root);
    const lines = out.trim().split('\n');
    const policies = lines.filter((l) => l.startsWith('policy '));
    expect(policies.length).toBe(5);
    expect(policies.map((l) => l.replace(/^policy \d+ pages: /, ''))).toEqual(
      policies.map((l) => l.replace(/^policy \d+ pages: /, '')).sort(),
    );
    expect(lines.at(-1)).toBe('CSP-GATE-OK pages=8 files=14 policies=5 ack=0');
    expect(lines.filter((l) => l.startsWith('CSP-GATE-OK')).length).toBe(1);
  });

  it('prints the same report on two runs over the same build', () => {
    const root = makeFakeBuild({ rows: goodRows() });
    const first = expectPass(root, ['--keep-manifest']);
    const second = expectPass(root, ['--keep-manifest']);
    expect(second).toBe(first);
  });

  it('removes the manifest folder after a pass, keeps it with the flag, and keeps it after a failure', () => {
    const passing = makeFakeBuild({ rows: goodRows() });
    expectPass(passing);
    expect(existsSync(join(passing, 'apps', 'web', 'dist', '.vite'))).toBe(false);

    const kept = makeFakeBuild({ rows: goodRows() });
    expectPass(kept, ['--keep-manifest']);
    expect(existsSync(join(kept, 'apps', 'web', 'dist', '.vite', 'manifest.json'))).toBe(true);

    const failing = makeFakeBuild({ rows: [{ id: 'plain', needs: ['workers'], code: '' }] });
    expectFail(failing, 'never uses a background worker');
    expect(existsSync(join(failing, 'apps', 'web', 'dist', '.vite', 'manifest.json'))).toBe(true);
  });

  it('refuses to judge when the manifest is missing, naming it, even if every page structure is fine', () => {
    const root = makeFakeBuild({ rows: goodRows(), manifest: false });
    expectFail(root, '.vite/manifest.json is missing');
  });

  it('fails a declared worker whose token is absent as an unnecessary grant', () => {
    const root = makeFakeBuild({ rows: [{ id: 'plain', needs: ['workers'], code: 'const a=1;' }] });
    expectFail(root, 'plain: needs declares "workers" but the built code never uses a background worker');
  });

  it('fails a token that is neither declared nor acknowledged and says which', () => {
    const root = makeFakeBuild({ rows: [{ id: 'plain', needs: [], code: WORKER_CODE }] });
    expectFail(root, 'does not declare "workers"');
  });

  it('passes a token that is acknowledged with a reason and not declared', () => {
    const acks = { ...NO_ACKS, wasm: { 'wasm-page': 'An optional decoder that this page never reaches.' } };
    const root = makeFakeBuild({ rows: [{ id: 'wasm-page', needs: [], code: WASM_CODE }], acks });
    expect(expectPass(root)).toContain('CSP-GATE-OK');
  });

  it('fails a token both declared and acknowledged as a contradiction', () => {
    const acks = { ...NO_ACKS, wasm: { 'wasm-page': 'An optional decoder that this page never reaches.' } };
    const root = makeFakeBuild({ rows: [{ id: 'wasm-page', needs: ['wasm'], code: WASM_CODE }], acks });
    expectFail(root, 'both declared in needs and acknowledged');
  });

  it('fails an acknowledgement whose token is gone as stale', () => {
    const acks = { ...NO_ACKS, wasm: { plain: 'An optional decoder that this page never reaches.' } };
    const root = makeFakeBuild({ rows: [{ id: 'plain', needs: [], code: 'const a=1;' }], acks });
    expectFail(root, 'the "wasm" acknowledgement in scripts/csp-acks.json is stale');
  });

  it('passes a page whose WebAssembly token is covered by a declared eval', () => {
    const rows = [{ id: 'k8s-validator', needs: ['eval'], code: `${EVAL_CODE}${WASM_CODE}` }];
    expect(expectPass(makeFakeBuild({ rows }))).toContain('CSP-GATE-OK');
  });

  it('fails a sandboxed preview that is not declared and a declared one that never shows a preview', () => {
    expectFail(
      makeFakeBuild({ rows: [{ id: 'plain', needs: [], code: PREVIEW_CODE }] }),
      'needs does not declare "sandboxed-html"',
    );
    expectFail(
      makeFakeBuild({ rows: [{ id: 'plain', needs: ['sandboxed-html'], code: 'const a=1;' }] }),
      'never shows a sandboxed preview',
    );
  });

  it('fails eval on a page outside the fixed list and a fixed list page missing eval, and passes a listed page', () => {
    expectFail(
      makeFakeBuild({ rows: [{ id: 'plain', needs: ['eval'], code: EVAL_CODE }] }),
      'allowed only on the fixed list',
    );
    expectFail(
      makeFakeBuild({ rows: [{ id: 'sass-less-compiler', needs: [], code: EVAL_CODE }] }),
      'must declare "eval"',
    );
    expect(
      expectPass(makeFakeBuild({ rows: [{ id: 'sass-less-compiler', needs: ['eval'], code: EVAL_CODE }] })),
    ).toContain('CSP-GATE-OK');
  });

  it('reports the reserved ids as reserved and passes, and refuses wasm on the reserved inspector once it exists', () => {
    const out = expectPass(makeFakeBuild({ rows: goodRows() }));
    expect(out).toContain('reserved font-inspector: no page yet');
    expect(out).toContain('reserved wasm-inspector: no page yet');

    expect(
      expectPass(makeFakeBuild({ rows: [{ id: 'wasm-inspector', needs: [], code: 'const a=1;' }] })),
    ).not.toContain('reserved wasm-inspector');
    expectFail(
      makeFakeBuild({ rows: [{ id: 'wasm-inspector', needs: ['wasm'], code: WASM_CODE }] }),
      'may never declare "wasm"',
    );
  });

  it('fails a fetch token in a shell chunk, and an acknowledgement elsewhere does not help', () => {
    expectFail(
      makeFakeBuild({ rows: goodRows(), shellCode: FETCH_CODE }),
      'shared shell chunk assets/index.js holds a fetch token',
    );
    const acks = { ...NO_ACKS, fetch: { plain: 'A loader path that is never taken.' } };
    expectFail(
      makeFakeBuild({ rows: [{ id: 'plain', needs: [], code: FETCH_CODE }], acks, shellCode: FETCH_CODE }),
      'shared shell chunk assets/index.js holds a fetch token',
    );
  });

  it('fails each of the other shell tokens too', () => {
    for (const [token, code] of [
      ['workers', WORKER_CODE],
      ['wasm', WASM_CODE],
      ['eval', EVAL_CODE],
    ]) {
      expectFail(
        makeFakeBuild({ rows: goodRows(), shellCode: code }),
        `shell chunk assets/index.js holds a ${token} token`,
      );
    }
  });

  it('fails a fetch call in a page closure without a reason, passes with one, and fails a stale one', () => {
    const rows = [{ id: 'plain', needs: [], code: FETCH_CODE }];
    expectFail(makeFakeBuild({ rows }), 'holds a network call (the fetch class');
    expectFail(
      makeFakeBuild({ rows: [{ id: 'plain', needs: [], code: 'const x=new g.XMLHttpRequest;x.open("GET",u)' }] }),
      'scripts/csp-acks.json has no reviewed reason for this page',
    );
    const acked = { ...NO_ACKS, fetch: { plain: 'A loader path that is never taken.' } };
    expect(expectPass(makeFakeBuild({ rows, acks: acked }))).toContain('ack=1');
    expectFail(
      makeFakeBuild({ rows: [{ id: 'plain', needs: [], code: 'const a=1;' }], acks: acked }),
      'the "fetch" acknowledgement in scripts/csp-acks.json is stale',
    );
  });

  it('reads tokens from chunks a page loads on demand and from shared chunks', () => {
    const rows = [
      {
        id: 'worker-page',
        needs: ['workers'],
        code: 'const a=1;',
        extra: [{ code: WORKER_CODE, dynamic: true }],
      },
    ];
    expect(expectPass(makeFakeBuild({ rows }))).toContain('CSP-GATE-OK');
    expectFail(makeFakeBuild({ rows: [{ ...rows[0], needs: [] }] }), 'does not declare "workers"');
  });

  it('fails a script chunk that only the shell loads on demand, since no closure reads it', () => {
    const root = makeFakeBuild({ rows: goodRows() });
    const dist = join(root, 'apps', 'web', 'dist');
    const manifestPath = join(dist, '.vite', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest['index.html'].dynamicImports.push('src/pages/Lazy.tsx');
    manifest['src/pages/Lazy.tsx'] = { file: 'assets/lazy.js', isDynamicEntry: true };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    write(join(dist, 'assets', 'lazy.js'), WORKER_CODE);
    expectFail(root, 'the chunk assets/lazy.js is in neither the shared shell nor any tool page');
  });

  it('fails a page that is written but has no manifest entry, and a manifest entry with no page', () => {
    const lonely = makeFakeBuild({ rows: goodRows() });
    write(join(lonely, 'apps', 'web', 'dist', 'tools', 'orphan.html'), pageHtml([]));
    write(join(lonely, 'tools', 'orphan', 'src', 'meta.json'), '{"id":"orphan"}');
    expectFail(lonely, 'orphan: the page is written but the manifest has no src/tools/orphan.ts entry');

    const missing = makeFakeBuild({ rows: goodRows() });
    rmSync(join(missing, 'apps', 'web', 'dist', 'tools', 'plain.html'));
    rmSync(join(missing, 'apps', 'web', 'dist', 'tools', 'plain'), { recursive: true });
    expectFail(missing, 'plain: the manifest has a page entry but no HTML file was written for it');
  });
});

describe('the acknowledgement file rules', () => {
  const rows = [{ id: 'wasm-page', needs: [], code: WASM_CODE }];
  const withWasm = (reason) => ({ ...NO_ACKS, wasm: { 'wasm-page': reason } });

  it('fails an entry with an empty reason', () => {
    expectFail(makeFakeBuild({ rows, acks: withWasm('  ') }), 'wasm / wasm-page has no reason');
  });

  it('fails a reason with a line break and a reason longer than 200 characters', () => {
    expectFail(makeFakeBuild({ rows, acks: withWasm('first line\nsecond line') }), 'has a line break in its reason');
    expectFail(makeFakeBuild({ rows, acks: withWasm('x'.repeat(201)) }), 'has a reason of 201 characters');
    expect(expectPass(makeFakeBuild({ rows, acks: withWasm('x'.repeat(200)) }))).toContain('CSP-GATE-OK');
  });

  it('fails an unknown class, an entry for a page that does not exist and a file that is not JSON', () => {
    expectFail(makeFakeBuild({ rows, acks: { ...withWasm('ok.'), workers: { a: 'b' } } }), 'names the class "workers"');
    expectFail(
      makeFakeBuild({ rows, acks: { ...withWasm('ok.'), fetch: { ghost: 'A reason.' } } }),
      'fetch / ghost names no built page',
    );
    expectFail(makeFakeBuild({ rows, acks: 'not json' }), 'scripts/csp-acks.json is not valid JSON');
  });
});

describe('the page structure rules on one written file', () => {
  const good = () => pageHtml(['workers']);
  const check = (html, needs = ['workers']) => checkHtml({ file: 'p.html', html, needs }).join('\n');

  it('passes a page written the way the prerender step writes it', () => {
    expect(check(good())).toBe('');
  });

  it('fails a page with no policy and a page with two', () => {
    expect(check(good().replace(/<meta http-equiv[^>]*>/, ''))).toContain('has no policy meta');
    const doubled = good().replace('<title>', `${metaTag("default-src 'none'")}<title>`);
    expect(check(doubled)).toContain('has 2 policy metas');
  });

  it('fails a policy that comes after the charset meta, or after the title', () => {
    const swapped = good().replace(
      /(\s*)(<meta http-equiv[^>]*>)(\s*)(<meta charset="utf-8" \/>)/,
      (_all, a, policy, b, charset) => `${a}${charset}${b}${policy}`,
    );
    const afterCharset = check(swapped);
    expect(afterCharset).toContain('not the first element of the head');
    const late = good()
      .replace(/<meta http-equiv[^>]*>\s*/, '')
      .replace(
        '</head>',
        `${metaTag(policyFor({ needs: ['workers'], scriptHashes: inlineScriptHashes(good()) }))}</head>`,
      );
    expect(check(late)).toContain('not the first element of the head');
  });

  it('fails a charset meta that is not second, and one that ends past byte 1,024', () => {
    const notSecond = good().replace('<meta charset="utf-8" />', '<title>x</title><meta charset="utf-8" />');
    expect(check(notSecond)).toContain('charset meta is not the second element');
    const padded = good().replace('" />\n    <meta charset', `" data-pad="${'x'.repeat(600)}" />\n    <meta charset`);
    expect(check(padded)).toContain('after byte 1,024');
  });

  it('fails an inline script with no hash in the policy', () => {
    const extra = good().replace('</body>', '<script>window.leak = 1;</script></body>');
    const result = check(extra);
    expect(result).toContain('inline script is not covered by a hash');
  });

  it.each([
    ['a repeated directive', (p) => `${p}; img-src data:`, 'repeats the directive img-src'],
    ['frame-ancestors', (p) => `${p}; frame-ancestors 'none'`, 'frame-ancestors, which a browser ignores'],
    ['report-uri', (p) => `${p}; report-uri /r`, 'report-uri, which a browser ignores'],
    ['a sandbox directive', (p) => `${p}; sandbox`, 'sandbox, which a browser ignores'],
    [
      'a worker loaded from the same origin',
      (p) => p.replace('worker-src blob:', "worker-src 'self'"),
      "worker-src must be exactly 'none' or blob:",
    ],
    [
      'unsafe-inline in script-src',
      (p) => p.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
      "script-src allows 'unsafe-inline'",
    ],
    [
      'unsafe-eval on a page that does not declare eval',
      (p) => p.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"),
      "'unsafe-eval' on a page that does not declare eval",
    ],
    [
      'an outside origin in connect-src',
      (p) => p.replace("connect-src 'none'", 'connect-src https://other.test'),
      'connect-src allows the outside source https://other.test',
    ],
    [
      'a wildcard in script-src',
      (p) => p.replace("script-src 'self'", "script-src * 'self'"),
      'script-src allows the outside source *',
    ],
    ['data in script-src', (p) => p.replace("script-src 'self'", "script-src data: 'self'"), 'script-src allows data:'],
  ])('fails %s', (_label, change, message) => {
    const html = good();
    const policy = /content="([^"]*)"/.exec(html)[1];
    expect(check(html.replace(policy, change(policy)))).toContain(message);
  });

  describe('a policy meta that is not written with a double-quoted content attribute', () => {
    const withTag = (tag) => good().replace(/<meta http-equiv[^>]*>/, tag);
    const baseline = () => /content="([^"]*)"/.exec(good())[1];

    it.each([
      [
        'a single-quoted wide policy',
        () =>
          `<meta http-equiv="Content-Security-Policy" content='script-src * data: blob:; connect-src *; worker-src *' />`,
        "worker-src must be exactly 'none' or blob:",
      ],
      [
        'a lookalike data-content attribute in front of a wide content attribute',
        () =>
          `<meta http-equiv="Content-Security-Policy" data-content="${baseline()}" content="script-src *; connect-src *" />`,
        'script-src allows the outside source *',
      ],
      [
        'an unquoted policy',
        () => '<meta http-equiv="Content-Security-Policy" content=connect-src:* />',
        "worker-src must be exactly 'none' or blob:",
      ],
      [
        'no content attribute at all',
        () => '<meta http-equiv="Content-Security-Policy" />',
        'has no content attribute the gate can read',
      ],
      [
        'an empty content attribute',
        () => '<meta http-equiv="Content-Security-Policy" content="" />',
        'has no content attribute the gate can read',
      ],
    ])('fails %s', (_label, tag, message) => {
      expect(check(withTag(tag()))).toContain(message);
    });

    it('reads the policy the browser reads from each written form', () => {
      expect(policyOfHtml(`<head><meta http-equiv="Content-Security-Policy" content='a-src b'></head>`)).toBe(
        'a-src b',
      );
      expect(policyOfHtml('<head><meta http-equiv="Content-Security-Policy" content=a-src></head>')).toBe('a-src');
      expect(
        policyOfHtml(
          '<head><meta data-content="x" http-equiv="Content-Security-Policy" CONTENT="y" content="z"></head>',
        ),
      ).toBe('y');
      expect(policyOfHtml('<head><meta http-equiv="Content-Security-Policy"></head>')).toBe('');
      expect(policyOfHtml('<head><meta charset="utf-8"></head>')).toBe(null);
    });
  });

  it('fails a policy that differs from the one the declared needs produce, even if each part looks safe', () => {
    expect(check(good(), ['wasm', 'workers'])).toContain("not the one this page's declared needs produce");
    expect(check(good(), [])).toContain("not the one this page's declared needs produce");
  });

  it('fails a twin file that has no policy in a whole build', () => {
    const root = makeFakeBuild({
      rows: goodRows(),
      mutate: (path, html) => (path === 'tools/plain.html' ? html.replace(/<meta http-equiv[^>]*>\s*/, '') : html),
    });
    expectFail(root, 'tools/plain.html: the page has no policy meta');
  });
});

describe('the live mode against a local server serving a fake build', () => {
  const run = promisify(execFile);

  /** Serves a build folder the way the real host does: a clean address maps to its html file, unknown ones get 404.html. */
  function serve(dist, { unknownStatus = 404, failOnce = [], failAlways = [] } = {}) {
    const asked = new Map();
    return new Promise((resolveServer) => {
      const server = createServer((request, response) => {
        const path = decodeURIComponent(new globalThis.URL(request.url, 'http://x').pathname).replace(/^\//, '');
        asked.set(path, (asked.get(path) ?? 0) + 1);
        if (failAlways.includes(path) || (failOnce.includes(path) && asked.get(path) === 1)) {
          response.writeHead(503, { 'content-type': 'text/plain' });
          response.end('busy');
          return;
        }
        const candidates = path === '' ? ['index.html'] : [path, `${path}.html`, join(path, 'index.html')];
        const hit = candidates.find((c) => {
          try {
            return existsSync(join(dist, c)) && readFileSync(join(dist, c)).length > 0 && /\.(html|xml)$/.test(c);
          } catch {
            return false;
          }
        });
        if (hit) {
          response.writeHead(200, { 'content-type': 'text/html' });
          response.end(readFileSync(join(dist, hit)));
        } else {
          response.writeHead(unknownStatus, { 'content-type': 'text/html' });
          response.end(readFileSync(join(dist, '404.html')));
        }
      });
      server.listen(0, '127.0.0.1', () => resolveServer(server));
    });
  }

  const live = async (root, server) => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    try {
      const { stdout } = await run('node', [join(root, 'scripts', 'check-csp.mjs'), '--live', url]);
      return { code: 0, out: stdout, err: '' };
    } catch (error) {
      return { code: error.code, out: String(error.stdout), err: String(error.stderr) };
    }
  };

  it('passes on a good build, reading the sitemap and an unknown address', async () => {
    const root = makeFakeBuild({ rows: goodRows() });
    const server = await serve(join(root, 'apps', 'web', 'dist'));
    try {
      const result = await live(root, server);
      expect(result.err).toBe('');
      expect(result.out.trim()).toBe('CSP-LIVE-OK pages=8 addresses=14');
    } finally {
      server.close();
    }
  });

  it('fails a folder twin that lost its policy while the html twin kept it, naming the slash address', async () => {
    const root = makeFakeBuild({ rows: goodRows() });
    const dist = join(root, 'apps', 'web', 'dist');
    const file = join(dist, 'tools', 'worker-page', 'index.html');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/<meta http-equiv[^>]*>\s*/, ''));
    const server = await serve(dist);
    try {
      const result = await live(root, server);
      expect(result.code).toBe(1);
      expect(result.err).toContain('/tools/worker-page/: the page has no policy meta');
      expect(result.err).not.toContain('/tools/worker-page: the page has no policy meta');
    } finally {
      server.close();
    }
  });

  it('fails a sitemap that names fewer tool pages than the catalog holds', async () => {
    const root = makeFakeBuild({ rows: goodRows() });
    const dist = join(root, 'apps', 'web', 'dist');
    const sitemap = join(dist, 'sitemap.xml');
    writeFileSync(
      sitemap,
      readFileSync(sitemap, 'utf8').replace('<url><loc>https://example.test/site/tools/plain</loc></url>', ''),
    );
    const server = await serve(dist);
    try {
      const result = await live(root, server);
      expect(result.code).toBe(1);
      expect(result.err).toContain(
        'the sitemap names 4 tool pages but docs/catalog.json has 5 tools; not in the sitemap: plain.',
      );
    } finally {
      server.close();
    }
  });

  it('retries an address once after a server error and passes, and fails one that keeps failing', async () => {
    const root = makeFakeBuild({ rows: goodRows() });
    const dist = join(root, 'apps', 'web', 'dist');
    const once = await serve(dist, { failOnce: ['tools/plain', 'sitemap.xml'] });
    try {
      const result = await live(root, once);
      expect(result.err).toBe('');
      expect(result.out.trim()).toBe('CSP-LIVE-OK pages=8 addresses=14');
    } finally {
      once.close();
    }
    const always = await serve(dist, { failAlways: ['tools/plain'] });
    try {
      const result = await live(root, always);
      expect(result.code).toBe(1);
      expect(result.err).toContain('/tools/plain answered 503, expected 200.');
    } finally {
      always.close();
    }
  });

  it('fails a page that lost its policy, naming the address', async () => {
    const root = makeFakeBuild({ rows: goodRows() });
    const dist = join(root, 'apps', 'web', 'dist');
    for (const file of ['tools/worker-page.html', 'tools/worker-page/index.html']) {
      writeFileSync(join(dist, file), readFileSync(join(dist, file), 'utf8').replace(/<meta http-equiv[^>]*>\s*/, ''));
    }
    const server = await serve(dist);
    try {
      const result = await live(root, server);
      expect(result.code).toBe(1);
      expect(result.err).toContain('/tools/worker-page: the page has no policy meta');
    } finally {
      server.close();
    }
  });

  it('fails when an unknown address is answered with success instead of the not-found status', async () => {
    const root = makeFakeBuild({ rows: goodRows() });
    const server = await serve(join(root, 'apps', 'web', 'dist'), { unknownStatus: 200 });
    try {
      const result = await live(root, server);
      expect(result.code).toBe(1);
      expect(result.err).toContain('answered 200, expected 404');
    } finally {
      server.close();
    }
  });
});
