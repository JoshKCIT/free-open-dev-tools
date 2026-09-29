import { it, expect, describe } from 'vitest';
import { escapeLiteral, unescapeLiteral, StringEscapeError } from '../src/index';

describe('SQL standard style', () => {
  it("O'Brien escapes to 'O''Brien'", () => {
    expect(escapeLiteral("O'Brien", { language: 'sql', wrap: true, sqlStyle: 'standard' }).value).toBe("'O''Brien'");
  });

  it('round trips through wrap', () => {
    const r = escapeLiteral("it's", { language: 'sql', wrap: true, sqlStyle: 'standard' });
    expect(unescapeLiteral(r.value, { language: 'sql', wrap: true, sqlStyle: 'standard' }).value).toBe("it's");
  });

  it('NUL input warns in standard style', () => {
    const r = escapeLiteral('a\0b', { language: 'sql', wrap: false, sqlStyle: 'standard' });
    expect(r.warnings.length).toBe(1);
  });
});

describe('SQL mysql style', () => {
  it('escapes NUL, quote, double-quote, backspace, LF, CR, TAB, 0x1A, backslash', () => {
    const r = escapeLiteral('\0\'"\b\n\r\t\x1a\\', { language: 'sql', wrap: false, sqlStyle: 'mysql' });
    expect(r.value).toBe('\\0\\\'\\"\\b\\n\\r\\t\\Z\\\\');
  });

  it('unescape of \\% keeps \\%', () => {
    expect(unescapeLiteral('\\%', { language: 'sql', wrap: false, sqlStyle: 'mysql' }).value).toBe('\\%');
  });

  it('unescape of \\x gives x', () => {
    expect(unescapeLiteral('\\x', { language: 'sql', wrap: false, sqlStyle: 'mysql' }).value).toBe('x');
  });
});

describe('CSV field', () => {
  it('a,b with comma delimiter becomes "a,b"', () => {
    expect(escapeLiteral('a,b', { language: 'csv', csvDelimiter: ',' }).value).toBe('"a,b"');
  });

  it('a;b with comma delimiter stays a;b', () => {
    expect(escapeLiteral('a;b', { language: 'csv', csvDelimiter: ',' }).value).toBe('a;b');
  });

  it('a;b with semicolon delimiter becomes "a;b"', () => {
    expect(escapeLiteral('a;b', { language: 'csv', csvDelimiter: ';' }).value).toBe('"a;b"');
  });

  it('inner quotes double', () => {
    expect(escapeLiteral('say "hi"', { language: 'csv', csvDelimiter: ',' }).value).toBe('"say ""hi"""');
  });

  it('unescape refuses a lone quote inside', () => {
    expect(() => unescapeLiteral('"a"b"', { language: 'csv', csvDelimiter: ',' })).toThrow(StringEscapeError);
  });

  it('unescape refuses text after the closing quote', () => {
    expect(() => unescapeLiteral('"ab"cd', { language: 'csv', csvDelimiter: ',' })).toThrow(StringEscapeError);
  });

  it('unescape refuses an unquoted field containing the delimiter', () => {
    expect(() => unescapeLiteral('a,b', { language: 'csv', csvDelimiter: ',' })).toThrow(StringEscapeError);
  });
});
