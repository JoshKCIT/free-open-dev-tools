import type { HeaderEntry } from './index';

/**
 * nginx's ngx_http_headers_module `add_header name value [always];`.
 *
 * Fetched from nginx.org/en/docs/http/ngx_http_headers_module.html: "There
 * could be several add_header directives. These directives are inherited
 * from the previous configuration level if and only if there are no
 * add_header directives defined on the current level." -- quoted below as a
 * comment, since it is easy to lose a header by adding one in a nested
 * location block.
 *
 * Fetched from nginx's own config-file tokenizer,
 * github.com/nginx/nginx `src/core/ngx_conf_file.c`: inside a quoted
 * string, `\"`, `\'` and `\\` are recognised escapes for a literal quote
 * character or backslash. No escape is defined for a literal `$`, which
 * nginx's own parameter substitution reads as the start of a variable
 * ("Parameter value can contain variables.", the same page above) -- so a
 * value carrying one is refused rather than silently mis-rendered.
 */

export class NginxDollarSignError extends Error {
  constructor(headerName: string) {
    super(
      `${headerName}'s value contains a dollar sign, which nginx reads as the start of a variable reference and offers no escape for as a literal character, so an nginx configuration line was not built for it.`,
    );
    this.name = 'NginxDollarSignError';
  }
}

function escapeNginxValue(headerName: string, value: string): string {
  if (value.includes('$')) throw new NginxDollarSignError(headerName);
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function renderNginx(headers: HeaderEntry[]): string {
  const lines = headers.map((h) => `add_header ${h.name} "${escapeNginxValue(h.name, h.value)}" always;`);
  return [
    '# add_header only inherits into a nested location block when that block',
    '# declares no add_header directives of its own (ngx_http_headers_module).',
    ...lines,
  ].join('\n');
}
