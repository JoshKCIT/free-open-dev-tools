/**
 * Renders a `RequestSpec` as a JavaScript `fetch()` call, per the WHATWG
 * Fetch Standard's `fetch()` method and `RequestInit` dictionary
 * (https://fetch.spec.whatwg.org/#fetch-method, fetched before this file
 * was written). Every string is written with `JSON.stringify`, which
 * produces a valid, correctly escaped JS double-quoted string literal for
 * any value -- the same decoder this package's own tests use to check the
 * round trip.
 *
 * Rule Z2 (structural, `scripts/check-catalog.mjs`'s stripper does not
 * understand code built from a template interpolation): the word `fetch`
 * with its parenthesis appears only as plain text inside the template
 * string below, never assembled from a `${}` expression or string
 * concatenation.
 *
 * curl sets a form body's Content-Type, a --json body's Content-Type and
 * Accept, and a -u/--oauth2-bearer Authorization header implicitly; this
 * target has no such implicit behaviour, so all three are written
 * explicitly into the `headers` object below when the request needs them
 * and does not already carry them.
 */
import { basicAuthValue, type RequestSpec } from './model';
import { hasHeader, redactedHeaders, secretText, type EmitOptions, type EmitResult } from './emit-curl';

function withImplicitHeaders(request: RequestSpec, options: EmitOptions): [string, string][] {
  const headers: [string, string][] = redactedHeaders(request, options);
  if (request.body.kind === 'form' && !hasHeader(headers, 'Content-Type')) {
    headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  }
  if (request.body.kind === 'json') {
    if (!hasHeader(headers, 'Content-Type')) headers.push(['Content-Type', 'application/json']);
    if (!hasHeader(headers, 'Accept')) headers.push(['Accept', 'application/json']);
  }
  if (request.auth.kind === 'basic' && !hasHeader(headers, 'Authorization')) {
    // basicAuthValue base64-encodes whatever it is given, so a redacted
    // password would still produce unreadable base64 -- unlike every other
    // target, this header is a value this package computes, not one the
    // library sets from a plain user/password pair, so redaction writes the
    // placeholder directly instead of encoding it.
    const value =
      options.redactSecrets && request.auth.password
        ? 'Basic YOUR_PASSWORD'
        : `Basic ${basicAuthValue(request.auth.user, request.auth.password)}`;
    headers.push(['Authorization', value]);
  }
  if (request.auth.kind === 'bearer' && !hasHeader(headers, 'Authorization')) {
    headers.push(['Authorization', `Bearer ${secretText(request.auth.token, 'YOUR_TOKEN', options)}`]);
  }
  return headers;
}

export function emitFetch(request: RequestSpec, options: EmitOptions = {}): EmitResult {
  const warnings: string[] = [];
  const headers = withImplicitHeaders(request, options);
  const lines: string[] = [];

  if (request.body.kind === 'multipart') {
    lines.push('const formData = new FormData();');
    for (const field of request.body.fields) {
      if (field.isFile) {
        warnings.push(
          `Form field "${field.name}" is a file field; this page never reads files, so it is not appended to the FormData here.`,
        );
        lines.push(
          `// "${field.name}" is a file field ("@${field.value}" in the pasted command). Append the real File or Blob here:`,
        );
        lines.push(
          `// formData.append(${JSON.stringify(field.name)}, yourFileOrBlob, ${JSON.stringify(field.value)});`,
        );
        continue;
      }
      lines.push(`formData.append(${JSON.stringify(field.name)}, ${JSON.stringify(field.value)});`);
    }
    lines.push('');
  }

  if (request.insecure) {
    warnings.push(
      'fetch has no way to skip certificate verification from JavaScript; a browser refuses an invalid certificate outright.',
    );
  }

  lines.push(`const response = await fetch(${JSON.stringify(request.url)}, {`);
  lines.push(`  method: ${JSON.stringify(request.method)},`);
  if (headers.length > 0) {
    lines.push('  headers: {');
    for (const [name, value] of headers) lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`);
    lines.push('  },');
  }
  if (request.body.kind === 'multipart') {
    lines.push('  body: formData,');
  } else if (request.body.kind === 'form') {
    const text = request.body.pairs.map(([name, value]) => `${name}=${value}`).join('&');
    lines.push(`  body: ${JSON.stringify(text)},`);
  } else if (request.body.kind === 'raw' || request.body.kind === 'json') {
    lines.push(`  body: ${JSON.stringify(request.body.text)},`);
  }
  if (!request.followRedirects) lines.push('  redirect: "manual",');
  lines.push('});');

  return { output: lines.join('\n') + '\n', warnings };
}
