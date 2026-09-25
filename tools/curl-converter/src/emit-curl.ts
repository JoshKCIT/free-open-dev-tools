/**
 * Renders a `RequestSpec` back as a curl command line, per the curl manual
 * (https://curl.se/docs/manpage.html, fetched for Task 1 and reused here).
 * Every argument is wrapped in POSIX single quotes -- a single quote inside
 * a single-quoted string is written by closing the quote, an escaped quote,
 * then reopening it (`'\''`), the standard POSIX shell idiom (POSIX Shell
 * Command Language section 2.2: nothing is special inside single quotes,
 * so a literal `'` cannot appear there directly).
 *
 * Unlike the other five targets, this emitter never adds an implicit
 * header curl would set on its own (form Content-Type, JSON Content-Type
 * and Accept, or the Authorization header for -u/--oauth2-bearer): curl
 * gets those for free from `-d`, `--json` and `-u`/`--oauth2-bearer`
 * themselves, so only the headers actually present on the request are
 * written with `-H`.
 */
import type { RequestSpec } from './model';

export interface EmitResult {
  output: string;
  warnings: string[];
}

/** Shared by every `emit<Target>`; only `redactSecrets` is read here, but the same options object is passed to all six. */
export interface EmitOptions {
  /** Replaces the basic-auth password, the bearer token, and any visitor-typed Authorization/Cookie header value with a placeholder. */
  redactSecrets?: boolean;
}

/** `options.redactSecrets` ? `placeholder` : `value`, and only when `value` is non-empty (nothing to redact from an empty string). */
export function secretText(value: string, placeholder: string, options: EmitOptions): string {
  return options.redactSecrets && value ? placeholder : value;
}

/** True when `headers` already carries a case-insensitively-named entry. */
export function hasHeader(headers: [string, string][], name: string): boolean {
  return headers.some(([n]) => n.toLowerCase() === name.toLowerCase());
}

/**
 * A fresh copy of `request.headers` (every emitter goes on to `push()` its
 * own implicit headers onto the result, so this must never be the same
 * array reference as `request.headers` -- otherwise that push mutates the
 * caller's own `RequestSpec` in place), with any visitor-typed
 * Authorization or Cookie value redacted, when asked. Applied first by
 * every emitter so a header the visitor pasted in directly (not one this
 * package synthesises for an implicit form/JSON/auth header) is redacted
 * the same way as the others.
 */
export function redactedHeaders(request: RequestSpec, options: EmitOptions): [string, string][] {
  return request.headers.map(([name, value]) => {
    if (!options.redactSecrets) return [name, value];
    const lower = name.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie') return [name, secretText(value, 'YOUR_SECRET', options)];
    return [name, value];
  });
}

function quotePosixSingle(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

function dataFlag(request: RequestSpec): { flag: string; value: string } | null {
  const { body } = request;
  if (body.kind === 'none') return null;
  if (body.kind === 'raw') return { flag: '--data-raw', value: body.text };
  if (body.kind === 'json') return { flag: '--json', value: body.text };
  if (body.kind === 'form') return { flag: '-d', value: body.pairs.map(([n, v]) => `${n}=${v}`).join('&') };
  return null;
}

export function emitCurl(request: RequestSpec, options: EmitOptions = {}): EmitResult {
  const warnings: string[] = [];
  const lines: string[] = [`curl -X ${quotePosixSingle(request.method)} \\`, `  ${quotePosixSingle(request.url)}`];

  for (const [name, value] of redactedHeaders(request, options)) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  -H ${quotePosixSingle(`${name}: ${value}`)}`);
  }

  if (request.body.kind === 'multipart') {
    for (const field of request.body.fields) {
      lines[lines.length - 1] += ' \\';
      const value = field.isFile ? `@${field.value}` : field.value;
      lines.push(`  -F ${quotePosixSingle(`${field.name}=${value}`)}`);
      if (field.isFile) {
        warnings.push(
          `Form field "${field.name}" is a file field; this page never reads files, so "@${field.value}" is a placeholder, not real file content.`,
        );
      }
    }
  } else {
    const data = dataFlag(request);
    if (data) {
      lines[lines.length - 1] += ' \\';
      lines.push(`  ${data.flag} ${quotePosixSingle(data.value)}`);
    }
  }

  if (request.auth.kind === 'basic') {
    const password = secretText(request.auth.password, 'YOUR_PASSWORD', options);
    lines[lines.length - 1] += ' \\';
    lines.push(`  -u ${quotePosixSingle(`${request.auth.user}:${password}`)}`);
  } else if (request.auth.kind === 'bearer') {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --oauth2-bearer ${quotePosixSingle(secretText(request.auth.token, 'YOUR_TOKEN', options))}`);
  }

  if (request.followRedirects) {
    lines[lines.length - 1] += ' \\';
    lines.push('  -L');
  }
  if (request.insecure) {
    lines[lines.length - 1] += ' \\';
    lines.push('  -k');
  }
  if (request.compressed) {
    lines[lines.length - 1] += ' \\';
    lines.push('  --compressed');
  }

  return { output: lines.join('\n') + '\n', warnings };
}
