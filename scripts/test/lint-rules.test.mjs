import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import { join } from 'node:path';
import { ROOT } from '../lib/catalog.mjs';

/**
 * HARD-04 (D-216) and the connection-global bans: the lint rules are what keep every in-site link a full document
 * load and keep app and tool code away from run-time code generation and the connection APIs the page policy does
 * not govern. Each rule is proved by linting a small piece of text under a real path of the tree, so a change to the
 * configuration that silences a rule fails here instead of passing quietly.
 */

const eslint = new ESLint({ cwd: ROOT });

/** Lint `code` as if it lived at `path` (relative to the repository root) and return the rule ids it reports. */
async function rulesReportedFor(path, code) {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, path) });
  return result.messages.map((m) => m.ruleId).filter(Boolean);
}

const PAGE = 'apps/web/src/pages/LintProbe.tsx';
const SITE_LINK = 'apps/web/src/components/SiteLink.tsx';
const TOOL_SOURCE = 'tools/base64/src/lint-probe.ts';

describe('router links are banned outside the shared link pair', () => {
  it('a page that imports Link from react-router-dom is reported', async () => {
    const code = `import { Link } from 'react-router-dom';\nexport default function P() { return <Link to="/tools">x</Link>; }\n`;
    expect(await rulesReportedFor(PAGE, code)).toContain('no-restricted-imports');
  });

  it('NavLink, useNavigate, Navigate and redirect are each reported, from either package name', async () => {
    for (const [name, from] of [
      ['NavLink', 'react-router-dom'],
      ['useNavigate', 'react-router-dom'],
      ['Navigate', 'react-router-dom'],
      ['redirect', 'react-router-dom'],
      ['Link', 'react-router'],
      ['useNavigate', 'react-router'],
    ]) {
      const code = `import { ${name} } from '${from}';\nexport const used = ${name};\n`;
      const rules = await rulesReportedFor(PAGE, code);
      expect(rules, `${name} from ${from}`).toContain('no-restricted-imports');
    }
  });

  it('the same import inside the shared link file reports nothing', async () => {
    const code = `import { Link } from 'react-router-dom';\nexport function SiteLink() { return <Link to="/" reloadDocument />; }\n`;
    expect(await rulesReportedFor(SITE_LINK, code)).not.toContain('no-restricted-imports');
  });

  it('the hooks and the router that do not navigate stay allowed', async () => {
    const code =
      `import { BrowserRouter, Routes, Route, useParams, useSearchParams } from 'react-router-dom';\n` +
      `export const used = [BrowserRouter, Routes, Route, useParams, useSearchParams];\n`;
    expect(await rulesReportedFor(PAGE, code)).not.toContain('no-restricted-imports');
  });
});

describe('run-time code generation and connection globals are banned in app and tool code', () => {
  it('app code that calls eval or builds a function from text is reported', async () => {
    const rules = await rulesReportedFor(
      'apps/web/src/lib/lint-probe.ts',
      `export const a = (s: string) => eval(s);\nexport const b = (s: string) => new Function(s);\n`,
    );
    expect(rules).toContain('no-eval');
    expect(rules).toContain('no-new-func');
  });

  it('app code that names a peer connection, a data channel or a transport is reported', async () => {
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'WebTransport']) {
      const rules = await rulesReportedFor(
        'apps/web/src/lib/lint-probe.ts',
        `export const made = (u: string) => new (${name} as unknown as new (u: string) => object)(u);\n`,
      );
      expect(rules, name).toContain('no-restricted-globals');
    }
  });

  it('tool package source that does the same is reported too', async () => {
    const rules = await rulesReportedFor(
      TOOL_SOURCE,
      `export const a = (s: string) => eval(s);\nexport const b = (s: string) => new Function(s);\n` +
        `export const c = () => new RTCPeerConnection();\nexport const d = () => new WebTransport('x');\n`,
    );
    expect(rules).toContain('no-eval');
    expect(rules).toContain('no-new-func');
    expect(rules.filter((r) => r === 'no-restricted-globals')).toHaveLength(2);
  });

  it('a connection name reached as a member or by destructuring is reported in app, worker and tool code', async () => {
    const reached = [
      ['apps/web/src/lib/lint-probe.ts', 'export const a = () => new window.RTCPeerConnection();\n'],
      ['apps/web/src/lib/lint-probe.ts', 'export const a = () => new globalThis.RTCPeerConnection();\n'],
      ['apps/web/src/lib/lint-probe.ts', `export const a = () => new globalThis['webkitRTCPeerConnection']();\n`],
      ['apps/web/src/lib/lint-probe.ts', 'const { RTCDataChannel } = window;\nexport const a = RTCDataChannel;\n'],
      ['apps/web/src/lib/workers/lint-probe.worker.ts', `export const a = () => new self.WebTransport('x');\n`],
      [TOOL_SOURCE, 'export const a = () => new globalThis.RTCPeerConnection();\n'],
      [TOOL_SOURCE, `export const a = () => new self.WebTransport('x');\n`],
    ];
    for (const [path, code] of reached) {
      expect(await rulesReportedFor(path, code), `${path}: ${code}`).toContain('no-restricted-syntax');
    }
  });

  it('a member that only shares part of a connection name stays allowed', async () => {
    const rules = await rulesReportedFor(
      'apps/web/src/lib/lint-probe.ts',
      `export const a = (o: { RTCPeerConnectionCount: number }) => o.RTCPeerConnectionCount;\n`,
    );
    expect(rules).not.toContain('no-restricted-syntax');
  });

  it('the earlier tool package bans still fire', async () => {
    const rules = await rulesReportedFor(TOOL_SOURCE, `export const x = () => fetch('/a');\n`);
    expect(rules).toContain('no-restricted-globals');
  });

  it('plain app code reports none of these rules', async () => {
    const rules = await rulesReportedFor(
      'apps/web/src/lib/lint-probe.ts',
      `export const add = (a: number, b: number) => a + b;\n`,
    );
    expect(rules).toEqual([]);
  });
});
