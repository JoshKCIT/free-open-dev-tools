import meta from './meta.json';
import { buildRequest, type RequestSpec } from './model';
import { emitCurl } from './emit-curl';
import { emitFetch } from './emit-fetch';
import { emitGo } from './emit-go';
import { emitHttpie } from './emit-httpie';
import { emitPhp } from './emit-php';
import { emitPython } from './emit-python';
import { parseCurl, SUPPORTED_OPTIONS } from './parse-curl';

export { meta, buildRequest, parseCurl, SUPPORTED_OPTIONS };
export { CurlConverterError, basicAuthValue } from './model';
export type { BuildRequestFields, MultipartField, RequestAuth, RequestBody, RequestSpec } from './model';
export type { ParseCurlResult } from './parse-curl';
export type { EmitOptions, EmitResult } from './emit-curl';

/** The six code targets this page writes, in the order shown on the page. */
export const EMIT_TARGETS = ['curl', 'fetch', 'python', 'go', 'php', 'httpie'] as const;
export type EmitTarget = (typeof EMIT_TARGETS)[number];

export interface EmitAllOptions {
  /** Replaces every password, token, Authorization value and Cookie value with a placeholder in every snippet. */
  redactSecrets?: boolean;
}

export interface EmitAllResult {
  snippets: Record<EmitTarget, string>;
  /** Plain-language descriptions of each secret found in the request (a password, token, Authorization or Cookie value). */
  secrets: string[];
  warnings: string[];
}

interface FoundSecret {
  description: string;
  value: string;
  placeholder: string;
}

function findSecrets(request: RequestSpec): FoundSecret[] {
  const found: FoundSecret[] = [];
  if (request.auth.kind === 'basic' && request.auth.password) {
    found.push({
      description: 'the basic authentication password',
      value: request.auth.password,
      placeholder: 'YOUR_PASSWORD',
    });
  }
  if (request.auth.kind === 'bearer' && request.auth.token) {
    found.push({ description: 'the bearer token', value: request.auth.token, placeholder: 'YOUR_TOKEN' });
  }
  for (const [name, value] of request.headers) {
    if (!value) continue;
    if (name.toLowerCase() === 'authorization') {
      found.push({ description: 'the Authorization header value', value, placeholder: 'YOUR_SECRET' });
    } else if (name.toLowerCase() === 'cookie') {
      found.push({ description: 'the Cookie header value', value, placeholder: 'YOUR_SECRET' });
    }
  }
  return found;
}

function redact(text: string, secrets: FoundSecret[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret.value) continue;
    out = out.split(secret.value).join(secret.placeholder);
  }
  return out;
}

/**
 * Writes `request` as all six target languages. Never throws for a request
 * `buildRequest`/`parseCurl` already produced. With `redactSecrets`, every
 * password, token, or Authorization/Cookie header value found on the
 * request is replaced by a plain placeholder in every returned snippet.
 */
export function emitAll(request: RequestSpec, options: EmitAllOptions = {}): EmitAllResult {
  const emitOptions = { redactSecrets: options.redactSecrets };
  const results = {
    curl: emitCurl(request, emitOptions),
    fetch: emitFetch(request, emitOptions),
    python: emitPython(request, emitOptions),
    go: emitGo(request, emitOptions),
    php: emitPhp(request, emitOptions),
    httpie: emitHttpie(request, emitOptions),
  };

  const secrets = findSecrets(request);
  const warnings = [
    ...results.curl.warnings,
    ...results.fetch.warnings,
    ...results.python.warnings,
    ...results.go.warnings,
    ...results.php.warnings,
    ...results.httpie.warnings,
  ];

  const snippets: Record<EmitTarget, string> = {
    curl: results.curl.output,
    fetch: results.fetch.output,
    python: results.python.output,
    go: results.go.output,
    php: results.php.output,
    httpie: results.httpie.output,
  };

  if (options.redactSecrets && secrets.length > 0) {
    for (const target of EMIT_TARGETS) snippets[target] = redact(snippets[target], secrets);
  }

  return { snippets, secrets: secrets.map((s) => s.description), warnings };
}
