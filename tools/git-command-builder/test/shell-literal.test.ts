import { it, expect } from 'vitest';
import { posixSingleQuote, powershellSingleQuote, ShellLiteralError } from '../src/shell-literal';

/** Test-only inverse of posixSingleQuote, to prove the round trip. */
function decodePosix(quoted: string): string {
  const inner = quoted.slice(1, -1);
  return inner.replace(/'\\''/g, "'");
}

/** Test-only inverse of powershellSingleQuote, to prove the round trip. */
function decodePowershell(quoted: string): string {
  const inner = quoted.slice(1, -1);
  return inner.replace(/(['\u2018\u2019])\1/g, '$1');
}

it('a value is wrapped in POSIX single quotes and an embedded single quote is closed, escaped and reopened as the Shell Command Language quoting rules require', () => {
  expect(posixSingleQuote('hello')).toBe("'hello'");
  expect(posixSingleQuote("it's")).toBe("'it'\\''s'");
});

it('a value is wrapped in PowerShell single quotes and an embedded single quote is doubled', () => {
  expect(powershellSingleQuote('hello')).toBe("'hello'");
  expect(powershellSingleQuote("don't")).toBe("'don''t'");
  expect(powershellSingleQuote('\u2018smart\u2019')).toBe("'\u2018\u2018smart\u2019\u2019'");
});

it('a NUL character is refused because no shell argument or environment value can hold it', () => {
  expect(() => posixSingleQuote('a\0b')).toThrowError(ShellLiteralError);
  expect(() => powershellSingleQuote('a\0b')).toThrowError(ShellLiteralError);
  try {
    posixSingleQuote('a\0b');
    expect.unreachable();
  } catch (err) {
    expect((err as ShellLiteralError).position).toBe(2);
    expect((err as ShellLiteralError).message).not.toContain('a\0b');
  }
});

it('every quoted value decodes back to the original text', () => {
  const values = ['', 'plain', "it's", "'''", 'a\nb', 'a\tb', '$HOME `cmd`', 'a"b', '\u2018curly\u2019'];
  for (const value of values) {
    expect(decodePosix(posixSingleQuote(value)), `posix round trip for ${JSON.stringify(value)}`).toBe(value);
    expect(decodePowershell(powershellSingleQuote(value)), `powershell round trip for ${JSON.stringify(value)}`).toBe(
      value,
    );
  }
});
