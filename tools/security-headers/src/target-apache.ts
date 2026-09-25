import type { HeaderEntry } from './index';

/**
 * Apache 2.4's mod_headers `Header always set` directive.
 *
 * Fetched from httpd.apache.org/docs/2.4/mod/mod_headers.html: "value may
 * be a character string, a string containing mod_headers specific format
 * specifiers... If value contains spaces, it should be surrounded by
 * double quotes." Its format-specifier table names `%%` as "The percent
 * sign", so a literal percent sign must be doubled or mod_headers reads it
 * as the start of a format specifier.
 *
 * Fetched from httpd.apache.org/docs/2.4/configuring.html, "Quoting and
 * Escaping": "Inside a quoted string, only two escape sequences are
 * recognized: \\ produces a literal backslash, and \" ... produces a
 * literal quote character without ending the string."
 */
function escapeApacheValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%');
}

export function renderApache(headers: HeaderEntry[]): string {
  const lines = headers.map((h) => `  Header always set ${h.name} "${escapeApacheValue(h.value)}"`);
  return ['<IfModule mod_headers.c>', ...lines, '</IfModule>'].join('\n');
}
