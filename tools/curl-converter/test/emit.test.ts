import { it, expect, vi } from 'vitest';
import * as ts from 'typescript';
import { emitAll, EMIT_TARGETS } from '../src/index';
import { parseCurl } from '../src/parse-curl';
import type { RequestSpec } from '../src/model';
import {
  decodeGoString,
  decodeHttpieItem,
  decodeJsString,
  decodePhpString,
  decodePosixSingleQuoted,
  decodePythonString,
} from './literals';

/** Finds a POSIX single-quoted literal (curl, HTTPie) starting at `fromIndex`, which must point at the opening `'`. */
function findPosixLiteral(text: string, fromIndex: number): string {
  let i = fromIndex + 1;
  while (i < text.length) {
    if (text[i] === "'") {
      if (text.slice(i, i + 4) === "'\\''") {
        i += 4;
        continue;
      }
      return text.slice(fromIndex, i + 1);
    }
    i++;
  }
  throw new Error(`Unterminated POSIX single-quoted literal starting at ${fromIndex} in: ${text}`);
}

/** Finds a backslash-escapes-next-char literal (JS, Python, Go, PHP) starting at `fromIndex`, which must point at the opening quote. */
function findBackslashLiteral(text: string, fromIndex: number): string {
  const quote = text[fromIndex];
  let i = fromIndex + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return text.slice(fromIndex, i + 1);
    i++;
  }
  throw new Error(`Unterminated literal starting at ${fromIndex} in: ${text}`);
}

/** The literal that starts immediately after the first occurrence of `marker`. */
function literalAfter(text: string, marker: string, find: (t: string, i: number) => string): string {
  const idx = text.indexOf(marker);
  if (idx < 0) throw new Error(`"${marker}" not found in:\n${text}`);
  return find(text, idx + marker.length);
}

/** The literal that contains `needle`, found by scanning backward from `needle` to the nearest quote character. */
function literalContaining(text: string, needle: string, find: (t: string, i: number) => string): string {
  const needleIndex = text.indexOf(needle);
  if (needleIndex < 0) throw new Error(`"${needle}" not found in:\n${text}`);
  let start = needleIndex;
  while (start >= 0 && text[start] !== "'" && text[start] !== '"') start--;
  if (start < 0) throw new Error(`No opening quote found before "${needle}" in:\n${text}`);
  return find(text, start);
}

const HEADER_NAME = 'X-Custom';
const HEADER_VALUE = `a"b'c$d`;
const BODY_TEXT = 'back\\slash `tick`\nnewline café';

function literalTestRequest(): RequestSpec {
  return {
    method: 'POST',
    url: 'https://example.invalid/a?b=1',
    headers: [[HEADER_NAME, HEADER_VALUE]],
    body: { kind: 'raw', text: BODY_TEXT },
    auth: { kind: 'bearer', token: 'tok-abc' },
    followRedirects: false,
    insecure: false,
    compressed: false,
  };
}

it('the same request is written as cURL, fetch, Python requests, Go net/http, PHP curl and HTTPie', () => {
  const { snippets } = emitAll(literalTestRequest());
  expect(Object.keys(snippets).sort()).toEqual([...EMIT_TARGETS].sort());
  expect(snippets.curl).toContain('curl');
  expect(snippets.fetch).toContain('fetch(');
  expect(snippets.python).toContain('import requests');
  expect(snippets.go).toContain('package main');
  expect(snippets.php).toContain('<?php');
  expect(snippets.httpie).toContain('http ');
  for (const target of EMIT_TARGETS) {
    expect(snippets[target]).toContain('example.invalid');
    expect(snippets[target]).toContain('tok-abc');
  }
});

it('every emitted string literal decodes back to the exact header and body text in its language', () => {
  const { snippets } = emitAll(literalTestRequest());

  const curlHeader = decodePosixSingleQuoted(literalContaining(snippets.curl, HEADER_NAME, findPosixLiteral));
  expect(curlHeader).toBe(`${HEADER_NAME}: ${HEADER_VALUE}`);
  const curlBody = decodePosixSingleQuoted(literalContaining(snippets.curl, 'newline caf', findPosixLiteral));
  expect(curlBody).toBe(BODY_TEXT);

  const fetchHeader = decodeJsString(literalAfter(snippets.fetch, `"${HEADER_NAME}": `, findBackslashLiteral));
  expect(fetchHeader).toBe(HEADER_VALUE);
  const fetchBody = decodeJsString(literalAfter(snippets.fetch, '  body: ', findBackslashLiteral));
  expect(fetchBody).toBe(BODY_TEXT);

  const pythonHeader = decodePythonString(literalAfter(snippets.python, `"${HEADER_NAME}": `, findBackslashLiteral));
  expect(pythonHeader).toBe(HEADER_VALUE);
  const pythonBody = decodePythonString(literalAfter(snippets.python, '    data=', findBackslashLiteral));
  expect(pythonBody).toBe(BODY_TEXT);

  const goHeader = decodeGoString(literalAfter(snippets.go, `req.Header.Set("${HEADER_NAME}", `, findBackslashLiteral));
  expect(goHeader).toBe(HEADER_VALUE);
  const goBody = decodeGoString(literalAfter(snippets.go, 'strings.NewReader(', findBackslashLiteral));
  expect(goBody).toBe(BODY_TEXT);

  const phpHeader = decodePhpString(literalContaining(snippets.php, HEADER_NAME, findBackslashLiteral));
  expect(phpHeader).toBe(`${HEADER_NAME}: ${HEADER_VALUE}`);
  const phpBody = decodePhpString(literalAfter(snippets.php, 'CURLOPT_POSTFIELDS => ', findBackslashLiteral));
  expect(phpBody).toBe(BODY_TEXT);

  const httpieHeaderItem = decodePosixSingleQuoted(literalContaining(snippets.httpie, HEADER_NAME, findPosixLiteral));
  const decodedItem = decodeHttpieItem(httpieHeaderItem);
  expect(decodedItem).toEqual({ name: HEADER_NAME, value: HEADER_VALUE, separator: ':' });
  const httpieBody = decodePosixSingleQuoted(literalContaining(snippets.httpie, 'newline caf', findPosixLiteral));
  expect(httpieBody).toBe(BODY_TEXT);
});

it('the emitted curl command parses back to the same request', () => {
  const request: RequestSpec = {
    method: 'POST',
    url: 'https://example.invalid/api',
    headers: [
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
      ['X-Trace', '1'],
    ],
    body: { kind: 'json', text: '{"a":1}' },
    auth: { kind: 'bearer', token: 'tok-xyz' },
    followRedirects: true,
    insecure: true,
    compressed: false,
  };
  const { snippets } = emitAll(request);
  const { request: reparsed } = parseCurl(snippets.curl);

  expect(reparsed.method).toBe(request.method);
  expect(reparsed.url).toBe(request.url);
  expect(reparsed.headers).toEqual(request.headers);
  expect(reparsed.body).toEqual(request.body);
  expect(reparsed.auth).toEqual(request.auth);
  expect(reparsed.followRedirects).toBe(true);
  expect(reparsed.insecure).toBe(true);
});

it('the emitted fetch code is valid JavaScript to the TypeScript parser', () => {
  const { snippets } = emitAll(literalTestRequest());
  const wrapped = `async function generated() {\n${snippets.fetch}\n}\n`;
  const result = ts.transpileModule(wrapped, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  expect(result.diagnostics ?? []).toEqual([]);
});

it('curl implicit headers for form data, JSON and basic auth are written explicitly in every other language', () => {
  const formRequest: RequestSpec = {
    method: 'POST',
    url: 'https://example.invalid/',
    headers: [],
    body: { kind: 'form', pairs: [['x', '1']] },
    auth: { kind: 'basic', user: 'alice', password: 's3cret' },
    followRedirects: false,
    insecure: false,
    compressed: false,
  };
  const { snippets } = emitAll(formRequest);

  // curl gets the form Content-Type and the basic-auth header for free from -d and -u.
  expect(snippets.curl).not.toContain('Content-Type');
  expect(snippets.curl).toContain('-u ');

  // Every other target writes the form Content-Type explicitly.
  expect(snippets.fetch).toContain('application/x-www-form-urlencoded');
  expect(snippets.go).toContain('application/x-www-form-urlencoded');
  expect(snippets.php).toContain('application/x-www-form-urlencoded');

  const jsonRequest: RequestSpec = { ...formRequest, body: { kind: 'json', text: '{}' } };
  const jsonSnippets = emitAll(jsonRequest).snippets;
  expect(jsonSnippets.fetch).toContain('application/json');
  expect(jsonSnippets.python).toContain('application/json');
  expect(jsonSnippets.go).toContain('application/json');
  expect(jsonSnippets.php).toContain('application/json');
  expect(jsonSnippets.httpie).toContain('application/json');
});

it('basic auth and bearer tokens use the documented form in each library and are flagged as secrets', () => {
  const basicRequest: RequestSpec = {
    method: 'GET',
    url: 'https://example.invalid/',
    headers: [],
    body: { kind: 'none' },
    auth: { kind: 'basic', user: 'alice', password: 's3cret-value' },
    followRedirects: false,
    insecure: false,
    compressed: false,
  };
  const { snippets: basicSnippets, secrets: basicSecrets } = emitAll(basicRequest);
  expect(basicSnippets.curl).toContain("-u 'alice:s3cret-value'");
  expect(basicSnippets.python).toContain('auth=("alice", "s3cret-value")');
  expect(basicSnippets.go).toContain('req.SetBasicAuth("alice", "s3cret-value")');
  expect(basicSnippets.php).toContain("CURLOPT_USERPWD => 'alice:s3cret-value'");
  expect(basicSnippets.httpie).toContain("-a \\\n  'alice:s3cret-value' \\");
  expect(basicSecrets.some((s) => s.includes('password'))).toBe(true);

  const bearerRequest: RequestSpec = { ...basicRequest, auth: { kind: 'bearer', token: 'tok-secret' } };
  const { snippets: bearerSnippets, secrets: bearerSecrets } = emitAll(bearerRequest);
  for (const target of EMIT_TARGETS) expect(bearerSnippets[target]).toContain('tok-secret');
  expect(bearerSecrets.some((s) => s.includes('bearer'))).toBe(true);
});

it('secrets can be replaced by placeholders in every emitted snippet', () => {
  const request: RequestSpec = {
    method: 'GET',
    url: 'https://example.invalid/',
    headers: [],
    body: { kind: 'none' },
    auth: { kind: 'basic', user: 'alice', password: 's3cret-value' },
    followRedirects: false,
    insecure: false,
    compressed: false,
  };
  const { snippets } = emitAll(request, { redactSecrets: true });
  for (const target of EMIT_TARGETS) {
    expect(snippets[target]).not.toContain('s3cret-value');
    expect(snippets[target]).toContain('YOUR_PASSWORD');
  }
});

it('building and converting never calls a network API', () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((...args: unknown[]) => {
    calls.push(String(args[0]));
    throw new Error('fetch should never be called by this package');
  }) as typeof fetch;
  try {
    const { request } = parseCurl("curl -X POST 'https://example.invalid/' -H 'X-A: 1' -d 'x=1'");
    emitAll(request);
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect(calls).toEqual([]);
});

it('nothing is written to the console while parsing or emitting', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const { request } = parseCurl("curl -X POST 'https://example.invalid/' -H 'X-A: 1' --json '{\"a\":1}'");
    emitAll(request, { redactSecrets: true });
  } finally {
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }
});
