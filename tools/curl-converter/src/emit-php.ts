/**
 * Renders a `RequestSpec` as PHP using the `curl_*` functions, per the
 * `curl_setopt` manual page (https://www.php.net/manual/en/function.curl-setopt.php,
 * fetched before this file was written): `curl_init`, one
 * `curl_setopt_array` call with `CURLOPT_URL`, `CURLOPT_CUSTOMREQUEST`,
 * `CURLOPT_HTTPHEADER`, `CURLOPT_POSTFIELDS`, `CURLOPT_USERPWD`,
 * `CURLOPT_FOLLOWLOCATION`, `CURLOPT_RETURNTRANSFER` and
 * `CURLOPT_SSL_VERIFYPEER`, then `curl_exec` and `curl_close`.
 *
 * PHP's curl extension has no implicit Content-Type the way curl's CLI
 * does for `-d`/`--json`, so a form or JSON body's Content-Type is written
 * explicitly, matching every other non-curl target. Basic authentication
 * uses `CURLOPT_USERPWD`, its documented form; a bearer token has no such
 * option, so it is written as an explicit header like every other target.
 */
import type { RequestSpec } from './model';
import { hasHeader, redactedHeaders, secretText, type EmitOptions, type EmitResult } from './emit-curl';

/** PHP strings page: single-quoted (only \\ and \' recognised) unless a control character is present, then double-quoted with \x escapes and $ / " escaped. */
function phpStr(value: string): string {
  let hasControl = false;
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || cp === 0x7f) {
      hasControl = true;
      break;
    }
  }
  if (!hasControl) {
    const escaped = value.split('\\').join('\\\\').split("'").join("\\'");
    return `'${escaped}'`;
  }
  let out = '"';
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '$') out += '\\$';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${cp.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

export function emitPhp(request: RequestSpec, options: EmitOptions = {}): EmitResult {
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

  const lines: string[] = ['<?php', '', '$ch = curl_init();', ''];
  const curlOptions: string[] = [];
  curlOptions.push(`  CURLOPT_URL => ${phpStr(request.url)},`);
  curlOptions.push(`  CURLOPT_CUSTOMREQUEST => ${phpStr(request.method)},`);
  curlOptions.push('  CURLOPT_RETURNTRANSFER => true,');
  if (request.followRedirects) curlOptions.push('  CURLOPT_FOLLOWLOCATION => true,');
  if (request.insecure) curlOptions.push('  CURLOPT_SSL_VERIFYPEER => false,');

  if (request.body.kind === 'multipart') {
    lines.push('$postFields = [');
    for (const field of request.body.fields) {
      if (field.isFile) {
        warnings.push(
          `Form field "${field.name}" is a file field; this page never reads files, so a real CURLFile is left for you to fill in.`,
        );
        lines.push(
          `  ${phpStr(field.name)} => new CURLFile(${phpStr(field.value)}), // a file field ("@${field.value}" in the pasted command)`,
        );
        continue;
      }
      lines.push(`  ${phpStr(field.name)} => ${phpStr(field.value)},`);
    }
    lines.push('];');
    lines.push('');
    curlOptions.push('  CURLOPT_POSTFIELDS => $postFields,');
  } else if (request.body.kind === 'form') {
    const text = request.body.pairs.map(([name, value]) => `${name}=${value}`).join('&');
    curlOptions.push(`  CURLOPT_POSTFIELDS => ${phpStr(text)},`);
  } else if (request.body.kind === 'raw' || request.body.kind === 'json') {
    curlOptions.push(`  CURLOPT_POSTFIELDS => ${phpStr(request.body.text)},`);
  }

  if (headers.length > 0) {
    curlOptions.push('  CURLOPT_HTTPHEADER => [');
    for (const [name, value] of headers) curlOptions.push(`    ${phpStr(`${name}: ${value}`)},`);
    curlOptions.push('  ],');
  }
  if (request.auth.kind === 'basic') {
    const password = secretText(request.auth.password, 'YOUR_PASSWORD', options);
    curlOptions.push(`  CURLOPT_USERPWD => ${phpStr(`${request.auth.user}:${password}`)},`);
  }

  lines.push('curl_setopt_array($ch, [');
  for (const opt of curlOptions) lines.push(opt);
  lines.push(']);');
  lines.push('');
  lines.push('$response = curl_exec($ch);');
  lines.push('curl_close($ch);');
  lines.push('');
  lines.push('echo $response;');

  return { output: lines.join('\n') + '\n', warnings };
}
