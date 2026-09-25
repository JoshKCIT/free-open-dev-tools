import type { HeaderEntry } from './index';

/**
 * Netlify's `_headers` file syntax.
 *
 * Fetched from docs.netlify.com/manage/routing/headers/: "In a _headers
 * file, you can specify one or several URL paths with their additional
 * headers indented below them" -- a path pattern on its own line, then
 * two-space-indented `Name: value` lines, as the page's own examples show
 * (`/*` followed by an indented `X-Frame-Options: DENY`).
 */
export function renderNetlify(headers: HeaderEntry[], path: string): string {
  const lines = headers.map((h) => `  ${h.name}: ${h.value}`);
  return [path, ...lines].join('\n');
}
