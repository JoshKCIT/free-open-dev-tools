/**
 * Canonical POSIX and PowerShell single-quote writer.
 *
 * POSIX Shell Command Language section 2.2.2 (Single-Quotes): "Enclosing
 * characters in single-quotes ( '' ) shall preserve the literal value of
 * each character within the single-quotes. A single-quote cannot occur
 * within single-quotes." An embedded single quote is therefore written by
 * closing the quoted string, escaping a literal single quote outside it,
 * then reopening the quote: `'` (close) + `\` + `'` (the literal quote) +
 * `'` (open).
 *
 * PowerShell's `about_Quoting_Rules` page: "To include a single quotation
 * mark in a single-quoted string, use a second consecutive single quote."
 * The same page also notes that PowerShell treats the Unicode left and
 * right single quotation marks (U+2018, U+2019) as quote characters for a
 * string, so both are doubled the same way a plain `'` is.
 *
 * Copied byte for byte into every tool in this phase that writes a shell
 * command line. This header names no tool folder so it stays true wherever
 * it lands.
 */

export class ShellLiteralError extends Error {
  /** 1-based character position of the refused NUL byte. */
  readonly position: number;

  constructor(position: number) {
    super('A shell argument or environment value cannot contain a NUL character.');
    this.name = 'ShellLiteralError';
    this.position = position;
  }
}

function assertNoNul(value: string): void {
  const index = value.indexOf('\0');
  if (index !== -1) throw new ShellLiteralError(index + 1);
}

/**
 * Wraps `value` in POSIX single quotes, closing, escaping and reopening the
 * quote for every embedded single quote (Shell Command Language section
 * 2.2.2). Refuses a NUL character, which no shell argument or environment
 * value can hold.
 */
export function posixSingleQuote(value: string): string {
  assertNoNul(value);
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Every character PowerShell's own quoting page treats as a single-quote character: `'`, and the Unicode left/right single quotation marks. */
const POWERSHELL_QUOTE_CHARS = /['‘’]/g;

/**
 * Wraps `value` in PowerShell single quotes, doubling every embedded quote
 * character (plain `'` or a Unicode left/right single quotation mark).
 * Refuses a NUL character, which no shell argument or environment value can
 * hold.
 */
export function powershellSingleQuote(value: string): string {
  assertNoNul(value);
  return `'${value.replace(POWERSHELL_QUOTE_CHARS, (m) => m + m)}'`;
}
