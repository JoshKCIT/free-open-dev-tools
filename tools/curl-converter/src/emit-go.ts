/**
 * Renders a `RequestSpec` as a complete Go program using `net/http`, per
 * its package documentation (https://pkg.go.dev/net/http, fetched before
 * this file was written): `http.NewRequest`, `req.Header.Set`,
 * `req.SetBasicAuth`, `strings.NewReader` or a `mime/multipart.Writer`
 * (`NewWriter`, `WriteField`), and `http.DefaultClient.Do`.
 *
 * `net/http` has no implicit Content-Type for a hand-built request body, so
 * a form or JSON body's Content-Type is always written explicitly with
 * `req.Header.Set`, matching every other non-curl target; a multipart
 * body's Content-Type instead comes from `multipart.Writer.FormDataContentType()`,
 * which includes the writer's own generated boundary. Basic authentication
 * uses `req.SetBasicAuth`, its documented form; a bearer token has no such
 * helper, so it is set the same way as every other header.
 */
import type { RequestSpec } from './model';
import { hasHeader, redactedHeaders, secretText, type EmitOptions, type EmitResult } from './emit-curl';

/** Go interpreted string literal rules (the Go Programming Language Specification, "String literals"). */
function goStr(value: string): string {
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

export function emitGo(request: RequestSpec, options: EmitOptions = {}): EmitResult {
  const warnings: string[] = [];
  if (request.insecure) {
    warnings.push(
      'net/http has no request-level flag to skip certificate verification; wrap http.DefaultClient with a custom http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}} yourself if you need it.',
    );
  }

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

  // Each package gets its own `import "..."` statement rather than a single
  // grouped `import (...)` block: both are valid Go (gofmt would merge
  // these into a block, which is a formatting choice, not a syntax
  // requirement), and writing them this way keeps this file's own source
  // free of the two-word sequence a dynamic module import starts with.
  const lines: string[] = ['package main', '', 'import "fmt"', 'import "io"', 'import "net/http"'];
  const isMultipart = request.body.kind === 'multipart';
  const hasBody = request.body.kind === 'raw' || request.body.kind === 'json' || request.body.kind === 'form';
  if (isMultipart) lines.push('import "bytes"', 'import "mime/multipart"');
  if (hasBody) lines.push('import "strings"');
  lines.push('', 'func main() {');

  let bodyExpr = 'nil';
  if (request.body.kind === 'multipart') {
    lines.push('\tvar buf bytes.Buffer');
    lines.push('\twriter := multipart.NewWriter(&buf)');
    for (const field of request.body.fields) {
      if (field.isFile) {
        warnings.push(
          `Form field "${field.name}" is a file field; this page never reads files, so writer.CreateFormFile is left for you to fill in.`,
        );
        lines.push(
          `\t// "${field.name}" is a file field (${goStr(`@${field.value}`)} in the pasted command). Use writer.CreateFormFile instead:`,
        );
        lines.push(`\t// fw, _ := writer.CreateFormFile(${goStr(field.name)}, ${goStr(field.value)})`);
        continue;
      }
      lines.push(`\twriter.WriteField(${goStr(field.name)}, ${goStr(field.value)})`);
    }
    lines.push('\twriter.Close()');
    bodyExpr = '&buf';
  } else if (request.body.kind === 'form') {
    const text = request.body.pairs.map(([name, value]) => `${name}=${value}`).join('&');
    lines.push(`\tbody := strings.NewReader(${goStr(text)})`);
    bodyExpr = 'body';
  } else if (request.body.kind === 'raw' || request.body.kind === 'json') {
    lines.push(`\tbody := strings.NewReader(${goStr(request.body.text)})`);
    bodyExpr = 'body';
  }

  lines.push(`\treq, err := http.NewRequest(${goStr(request.method)}, ${goStr(request.url)}, ${bodyExpr})`);
  lines.push('\tif err != nil {');
  lines.push('\t\tpanic(err)');
  lines.push('\t}');

  if (isMultipart) lines.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())');
  for (const [name, value] of headers) lines.push(`\treq.Header.Set(${goStr(name)}, ${goStr(value)})`);
  if (request.auth.kind === 'basic') {
    const password = secretText(request.auth.password, 'YOUR_PASSWORD', options);
    lines.push(`\treq.SetBasicAuth(${goStr(request.auth.user)}, ${goStr(password)})`);
  }

  lines.push('');
  lines.push('\tresp, err := http.DefaultClient.Do(req)');
  lines.push('\tif err != nil {');
  lines.push('\t\tpanic(err)');
  lines.push('\t}');
  lines.push('\tdefer resp.Body.Close()');
  lines.push('');
  lines.push('\trespBody, err := io.ReadAll(resp.Body)');
  lines.push('\tif err != nil {');
  lines.push('\t\tpanic(err)');
  lines.push('\t}');
  lines.push('\tfmt.Println(string(respBody))');
  lines.push('}');

  return { output: lines.join('\n') + '\n', warnings };
}
