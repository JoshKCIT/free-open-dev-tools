/**
 * Renders a `RequestSpec` as Python code using the `requests` library, per
 * its own Quickstart (https://requests.readthedocs.io/en/latest/user/quickstart/,
 * fetched before this file was written): `headers=`, `data=` or `json=` for
 * the body, `auth=` for Basic authentication, `files=` for multipart, and
 * `allow_redirects=`.
 *
 * `requests` sets a form body's Content-Type and a `json=` body's
 * Content-Type itself; this file still writes them explicitly into
 * `headers` when the request needs them and the visitor did not already
 * set them, so the header list printed on the page matches what every
 * other target shows (curl's own -d/--json do the equivalent implicitly).
 * Basic authentication uses `requests`' own `auth=(user, password)` tuple,
 * its documented form, rather than a hand-built header; a bearer token has
 * no such helper in `requests`, so it is written as an explicit
 * `Authorization: Bearer <token>` header, the same as every other target.
 */
import type { RequestSpec } from './model';
import { hasHeader, redactedHeaders, secretText, type EmitOptions, type EmitResult } from './emit-curl';

/** Python string literal rules (lexical analysis, "String and Bytes literals"): double-quoted, backslash escapes. */
function pyStr(value: string): string {
  let out = '"';
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${cp.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

export function emitPython(request: RequestSpec, options: EmitOptions = {}): EmitResult {
  const warnings: string[] = [];
  const headers: [string, string][] = redactedHeaders(request, options);
  if (request.body.kind === 'form' && !hasHeader(headers, 'Content-Type')) {
    headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  }
  if (request.body.kind === 'json') {
    if (!hasHeader(headers, 'Content-Type')) headers.push(['Content-Type', 'application/json']);
    if (!hasHeader(headers, 'Accept')) headers.push(['Accept', 'application/json']);
  }
  if (request.auth.kind === 'bearer' && !hasHeader(headers, 'Authorization')) {
    headers.push(['Authorization', `Bearer ${secretText(request.auth.token, 'YOUR_TOKEN', options)}`]);
  }

  const lines: string[] = ['import requests', ''];

  if (request.body.kind === 'multipart') {
    lines.push('files = {');
    for (const field of request.body.fields) {
      if (field.isFile) {
        warnings.push(
          `Form field "${field.name}" is a file field; this page never reads files, so open() is left for you to fill in.`,
        );
        lines.push(
          `    ${pyStr(field.name)}: open(${pyStr(field.value)}, "rb"),  # a file field ("@${field.value}" in the pasted command)`,
        );
      } else {
        lines.push(`    ${pyStr(field.name)}: (None, ${pyStr(field.value)}),`);
      }
    }
    lines.push('}');
    lines.push('');
  }

  lines.push(`response = requests.request(`);
  lines.push(`    ${pyStr(request.method)},`);
  lines.push(`    ${pyStr(request.url)},`);
  if (headers.length > 0) {
    lines.push('    headers={');
    for (const [name, value] of headers) lines.push(`        ${pyStr(name)}: ${pyStr(value)},`);
    lines.push('    },');
  }
  if (request.body.kind === 'multipart') {
    lines.push('    files=files,');
  } else if (request.body.kind === 'form') {
    lines.push('    data={');
    for (const [name, value] of request.body.pairs) lines.push(`        ${pyStr(name)}: ${pyStr(value)},`);
    lines.push('    },');
  } else if (request.body.kind === 'json') {
    lines.push(`    data=${pyStr(request.body.text)},`);
  } else if (request.body.kind === 'raw') {
    lines.push(`    data=${pyStr(request.body.text)},`);
  }
  if (request.auth.kind === 'basic') {
    const password = secretText(request.auth.password, 'YOUR_PASSWORD', options);
    lines.push(`    auth=(${pyStr(request.auth.user)}, ${pyStr(password)}),`);
  }
  lines.push(`    allow_redirects=${request.followRedirects ? 'True' : 'False'},`);
  if (request.insecure) lines.push('    verify=False,');
  lines.push(')');

  return { output: lines.join('\n') + '\n', warnings };
}
