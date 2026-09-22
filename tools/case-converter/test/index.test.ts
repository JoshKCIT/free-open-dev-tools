import { describe, it, expect } from 'vitest';
import { splitWords, convert, convertLines, convertAll, CASES } from '../src/index';

describe('word splitting', () => {
  it('splits on separators', () => {
    expect(splitWords('user first name')).toEqual(['user', 'first', 'name']);
    expect(splitWords('user_first_name')).toEqual(['user', 'first', 'name']);
    expect(splitWords('user-first-name')).toEqual(['user', 'first', 'name']);
    expect(splitWords('user.first/name')).toEqual(['user', 'first', 'name']);
  });

  it('splits at a lower to upper boundary', () => {
    expect(splitWords('userFirstName')).toEqual(['user', 'First', 'Name']);
    expect(splitWords('UserFirstName')).toEqual(['User', 'First', 'Name']);
  });

  it('handles acronyms the way developers expect', () => {
    // The boundary is at the last capital of a run followed by a lowercase.
    expect(splitWords('XMLHttpRequest')).toEqual(['XML', 'Http', 'Request']);
    expect(splitWords('parseHTMLString')).toEqual(['parse', 'HTML', 'String']);
    expect(splitWords('IOError')).toEqual(['IO', 'Error']);
    expect(splitWords('HTTPSConnection')).toEqual(['HTTPS', 'Connection']);
    expect(splitWords('ABC')).toEqual(['ABC']);
  });

  it('keeps digits attached by default', () => {
    expect(splitWords('utf8Decoder')).toEqual(['utf8', 'Decoder']);
    expect(splitWords('base64')).toEqual(['base64']);
    expect(splitWords('v2Model')).toEqual(['v2', 'Model']);
  });

  it('splits digits into their own word when asked', () => {
    expect(splitWords('utf8Decoder', { splitOnNumbers: true })).toEqual(['utf', '8', 'Decoder']);
    expect(splitWords('base64', { splitOnNumbers: true })).toEqual(['base', '64']);
  });

  it('collapses runs of separators and trims them', () => {
    expect(splitWords('__user___name__')).toEqual(['user', 'name']);
    expect(splitWords('   spaced   out   ')).toEqual(['spaced', 'out']);
  });

  it('handles empty and separator-only input', () => {
    expect(splitWords('')).toEqual([]);
    expect(splitWords('___')).toEqual([]);
    expect(splitWords('   ')).toEqual([]);
  });

  it('keeps non-Latin scripts together as words', () => {
    expect(splitWords('日本語 テスト')).toEqual(['日本語', 'テスト']);
    expect(splitWords('привет мир')).toEqual(['привет', 'мир']);
  });

  it('splits accented Latin at case boundaries like plain Latin', () => {
    expect(splitWords('éclairAuChocolat')).toEqual(['éclair', 'Au', 'Chocolat']);
  });
});

describe('conversions', () => {
  const input = 'XMLHttpRequest handler';

  const expected: Record<string, string> = {
    camel: 'xmlHttpRequestHandler',
    pascal: 'XMLHttpRequestHandler'.replace('XML', 'Xml'),
    snake: 'xml_http_request_handler',
    constant: 'XML_HTTP_REQUEST_HANDLER',
    kebab: 'xml-http-request-handler',
    cobol: 'XML-HTTP-REQUEST-HANDLER',
    train: 'Xml-Http-Request-Handler',
    dot: 'xml.http.request.handler',
    path: 'xml/http/request/handler',
    space: 'xml http request handler',
    title: 'Xml Http Request Handler',
    sentence: 'Xml http request handler',
  };

  for (const [target, out] of Object.entries(expected)) {
    it(`converts to ${target}`, () => {
      expect(convert(input, target as never)).toBe(out);
    });
  }

  it('lowercases an acronym in camelCase, because a leading run should not stay shouting', () => {
    expect(convert('XMLHttpRequest', 'camel')).toBe('xmlHttpRequest');
  });

  it('round-trips between the identifier cases', () => {
    const original = 'user_first_name';
    expect(convert(convert(original, 'camel'), 'snake')).toBe(original);
    expect(convert(convert(original, 'pascal'), 'snake')).toBe(original);
    expect(convert(convert(original, 'kebab'), 'snake')).toBe(original);
  });

  it('is idempotent for every identifier case', () => {
    for (const c of ['camel', 'pascal', 'snake', 'constant', 'kebab', 'dot', 'path'] as const) {
      const once = convert('some Mixed_input-here', c);
      expect(convert(once, c)).toBe(once);
    }
  });
});

describe('title case', () => {
  it('capitalises every word in simple title case', () => {
    expect(convert('the name of the wind', 'title')).toBe('The Name Of The Wind');
  });

  it('keeps short words lowercase in the editorial variant', () => {
    expect(convert('the name of the wind', 'titleAp')).toBe('The Name of the Wind');
  });

  it('still capitalises a short word at the start or the end', () => {
    expect(convert('of mice and men', 'titleAp')).toBe('Of Mice and Men');
    expect(convert('what are you waiting for', 'titleAp')).toBe('What Are You Waiting For');
  });

  it('single word titles work in both variants', () => {
    expect(convert('the', 'titleAp')).toBe('The');
  });
});

describe('locale sensitivity', () => {
  it('uses the Turkish dotted capital I when that locale is given', () => {
    // In Turkish, uppercase of "i" is "İ", not "I". Getting this wrong has
    // broken real identifier handling, so it is an explicit option.
    expect(convert('istanbul', 'upper', { locale: 'tr' })).toBe('İSTANBUL');
    expect(convert('istanbul', 'upper')).toBe('ISTANBUL');
  });

  it('lowercases the Turkish dotless I correctly', () => {
    expect(convert('I', 'lower', { locale: 'tr' })).toBe('ı');
    expect(convert('I', 'lower')).toBe('i');
  });

  it('uppercases the German sharp s to a double S', () => {
    expect(convert('straße', 'upper')).toBe('STRASSE');
  });
});

describe('whole-text cases', () => {
  it('leaves separators alone for lower and upper', () => {
    expect(convert('Hello, World!', 'upper')).toBe('HELLO, WORLD!');
    expect(convert('Hello, World!', 'lower')).toBe('hello, world!');
  });

  it('alternates from the first character', () => {
    expect(convert('hello', 'alternating')).toBe('hElLo');
  });

  it('inverts each letter', () => {
    expect(convert('Hello World', 'inverse')).toBe('hELLO wORLD');
  });

  it('inverse is its own inverse for letters', () => {
    const s = 'MiXeD CaSe';
    expect(convert(convert(s, 'inverse'), 'inverse')).toBe(s);
  });
});

describe('multiline input', () => {
  it('converts each line independently', () => {
    expect(convertLines('firstName\nlastName', 'snake')).toBe('first_name\nlast_name');
  });

  it('preserves blank lines', () => {
    expect(convertLines('a\n\nb', 'constant')).toBe('A\n\nB');
  });

  it('preserves a trailing newline', () => {
    expect(convertLines('a\n', 'constant')).toBe('A\n');
  });
});

describe('every case produces output for every sample', () => {
  it('never throws and never returns undefined', () => {
    const samples = ['', 'a', 'ABC', 'already_snake', '👋 emoji here', '日本語', '123', '--__--'];
    for (const s of samples) {
      const all = convertAll(s);
      expect(all).toHaveLength(CASES.length);
      for (const r of all) expect(typeof r.output).toBe('string');
    }
  });
});
