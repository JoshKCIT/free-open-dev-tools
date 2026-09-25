/**
 * Renders a `RequestSpec` as an HTTPie command line, per its documentation
 * (https://httpie.io/docs/cli, fetched before this file was written):
 * request items (`Name:value` for headers, `name=value` for form/multipart
 * fields), `--raw` for a raw or JSON body, `--form`/`--multipart` for
 * fields, `-a user:password` for Basic authentication, and `--follow`.
 *
 * HTTPie reads `:`, `=`, `@` and `\` as separator characters inside an
 * item's name; a literal occurrence of one of those in a name is escaped
 * with a backslash per HTTPie's own escaping rules, before the whole item
 * is quoted for the shell exactly as the curl emitter quotes its own
 * arguments (POSIX single quotes) -- a bare flag like `--follow` or `-a`
 * is written unquoted, the same as curl's own `-L`/`-k`. HTTPie has no
 * `--json`-style implicit Content-Type/Accept the way curl does for a
 * plain request without `--form`; those are written explicitly with
 * header items instead, and a bearer token has no dedicated flag, so it is
 * written the same way.
 */
import type { RequestSpec } from './model';
import { hasHeader, redactedHeaders, secretText, type EmitOptions, type EmitResult } from './emit-curl';

function quotePosixSingle(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

/** Escapes HTTPie's own separator characters (: = @ \) inside an item name. */
function httpieEscapeName(name: string): string {
  return name.replace(/[\\:=@]/g, (c) => `\\${c}`);
}

interface Segment {
  text: string;
  /** Flags (`--follow`, `-a`) are written literally; every value is shell-quoted. */
  quote: boolean;
}

export function emitHttpie(request: RequestSpec, options: EmitOptions = {}): EmitResult {
  const warnings: string[] = [];
  if (request.insecure)
    warnings.push(
      '--verify=no was added because "insecure" was requested; HTTPie will not check the server certificate.',
    );

  const headers: [string, string][] = redactedHeaders(request, options);
  if (request.body.kind === 'raw') {
    if (!hasHeader(headers, 'Content-Type')) headers.push(['Content-Type', 'text/plain']);
  }
  if (request.body.kind === 'json') {
    if (!hasHeader(headers, 'Content-Type')) headers.push(['Content-Type', 'application/json']);
    if (!hasHeader(headers, 'Accept')) headers.push(['Accept', 'application/json']);
  }
  if (request.auth.kind === 'bearer' && !hasHeader(headers, 'Authorization')) {
    headers.push(['Authorization', `Bearer ${secretText(request.auth.token, 'YOUR_TOKEN', options)}`]);
  }

  const segments: Segment[] = [];
  if (request.followRedirects) segments.push({ text: '--follow', quote: false });
  if (request.insecure) segments.push({ text: '--verify=no', quote: false });
  if (request.auth.kind === 'basic') {
    const password = secretText(request.auth.password, 'YOUR_PASSWORD', options);
    segments.push({ text: '-a', quote: false });
    segments.push({ text: `${request.auth.user}:${password}`, quote: true });
  }

  const isMultipart = request.body.kind === 'multipart';
  if (isMultipart) segments.push({ text: '--multipart', quote: false });
  else if (request.body.kind === 'form') segments.push({ text: '--form', quote: false });

  segments.push({ text: request.method, quote: true }, { text: request.url, quote: true });

  for (const [name, value] of headers) segments.push({ text: `${httpieEscapeName(name)}:${value}`, quote: true });

  if (isMultipart && request.body.kind === 'multipart') {
    for (const field of request.body.fields) {
      if (field.isFile) {
        warnings.push(
          `Form field "${field.name}" is a file field; this page never reads files, so the path after @ is a placeholder.`,
        );
        segments.push({ text: `${httpieEscapeName(field.name)}@${field.value}`, quote: true });
      } else {
        segments.push({ text: `${httpieEscapeName(field.name)}=${field.value}`, quote: true });
      }
    }
  } else if (request.body.kind === 'form') {
    for (const [name, value] of request.body.pairs)
      segments.push({ text: `${httpieEscapeName(name)}=${value}`, quote: true });
  } else if (request.body.kind === 'raw' || request.body.kind === 'json') {
    segments.push({ text: '--raw', quote: false }, { text: request.body.text, quote: true });
  }

  const lines = ['http \\'];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const isLast = i === segments.length - 1;
    const text = segment.quote ? quotePosixSingle(segment.text) : segment.text;
    lines.push(`  ${text}${isLast ? '' : ' \\'}`);
  }

  return { output: lines.join('\n') + '\n', warnings };
}
