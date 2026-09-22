import { describe, it, expect } from 'vitest';
import { parseJson, format, toTree, escapeNonAscii, suggestRepairs } from '../src/index';

describe('RFC 8259 conformance', () => {
  it('accepts the six value types at the top level', () => {
    for (const [source, expected] of [
      ['{}', {}],
      ['[]', []],
      ['"text"', 'text'],
      ['42', 42],
      ['true', true],
      ['null', null],
    ] as [string, unknown][]) {
      const r = parseJson(source);
      expect(r.ok, source).toBe(true);
      expect(r.value).toEqual(expected);
    }
  });

  it('rejects a leading zero', () => {
    expect(parseJson('01').ok).toBe(false);
    expect(parseJson('01').error?.message).toMatch(/leading zero/);
    expect(parseJson('-01').ok).toBe(false);
    expect(parseJson('0').ok).toBe(true);
    expect(parseJson('0.5').ok).toBe(true);
  });

  it('rejects a bare decimal point on either side', () => {
    expect(parseJson('.5').ok).toBe(false);
    expect(parseJson('5.').ok).toBe(false);
  });

  it('rejects an exponent with no digits', () => {
    expect(parseJson('1e').ok).toBe(false);
    expect(parseJson('1e+').ok).toBe(false);
    expect(parseJson('1e10').ok).toBe(true);
    expect(parseJson('1E-10').ok).toBe(true);
  });

  it('rejects the non-numbers that JavaScript allows but JSON does not', () => {
    for (const bad of ['NaN', 'Infinity', '-Infinity', '+1', '0x10', '1_000', 'undefined']) {
      expect(parseJson(bad).ok, bad).toBe(false);
    }
  });

  it('rejects single quotes with a message that says why', () => {
    const r = parseJson("{'a': 1}");
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/double quotes/);
  });

  it('rejects unquoted keys', () => {
    expect(parseJson('{a: 1}').ok).toBe(false);
  });

  it('rejects a raw control character inside a string', () => {
    expect(parseJson('"a\nb"').ok).toBe(false);
    expect(parseJson('"a\tb"').ok).toBe(false);
    expect(parseJson('"a\\nb"').ok).toBe(true);
  });

  it('rejects an invalid escape', () => {
    const r = parseJson('"\\x41"');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/not a valid JSON escape/);
  });

  it('requires four hex digits after \\u', () => {
    expect(parseJson('"\\u12"').ok).toBe(false);
    expect(parseJson('"\\u0041"').ok).toBe(true);
    expect(parseJson('"\\u0041"').value).toBe('A');
  });

  it('rejects trailing content after the value', () => {
    const r = parseJson('{} {}');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/after the end/);
  });

  it('rejects trailing commas by default and accepts them on request', () => {
    expect(parseJson('[1,2,]').ok).toBe(false);
    expect(parseJson('{"a":1,}').ok).toBe(false);
    expect(parseJson('[1,2,]', { allowTrailingCommas: true }).value).toEqual([1, 2]);
    expect(parseJson('{"a":1,}', { allowTrailingCommas: true }).value).toEqual({ a: 1 });
  });

  it('agrees with JSON.parse on everything it accepts', () => {
    const samples = [
      '{}',
      '[]',
      '{"a":1}',
      '[1,2,3]',
      '"\\u00e9"',
      '1e10',
      '-0',
      '0.1',
      '{"a":{"b":[1,{"c":null}]}}',
      '"\\ud83d\\udc4b"',
      '[true,false,null]',
      '{"":""}',
      '"\\/"',
      '1.0',
      '[[[[[]]]]]',
    ];
    for (const s of samples) {
      const mine = parseJson(s);
      expect(mine.ok, s).toBe(true);
      expect(mine.value, s).toEqual(JSON.parse(s));
    }
  });

  it('rejects everything JSON.parse rejects, across a fuzz sample', () => {
    const pieces = ['{', '}', '[', ']', '"a"', ':', ',', '1', 'true', 'null', ' ', '\\'];
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 2000; i++) {
      let s = '';
      const n = 1 + Math.floor(rand() * 6);
      for (let j = 0; j < n; j++) s += pieces[Math.floor(rand() * pieces.length)];
      let theirs = true;
      try {
        JSON.parse(s);
      } catch {
        theirs = false;
      }
      expect(parseJson(s).ok, `input: ${JSON.stringify(s)}`).toBe(theirs);
    }
  });
});

describe('duplicate keys', () => {
  const source = '{"a": 1, "b": 2, "a": 3}';

  it('keeps the last value by default, matching JSON.parse', () => {
    const r = parseJson(source);
    expect(r.value).toEqual({ a: 3, b: 2 });
    expect(JSON.parse(source)).toEqual(r.value);
  });

  it('reports the duplicate rather than hiding it', () => {
    const r = parseJson(source);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]!.key).toBe('a');
    expect(r.duplicates[0]!.path).toBe('$.a');
    expect(r.duplicates[0]!.occurrences).toBe(2);
    expect(r.duplicates[0]!.line).toBe(1);
  });

  it('can keep the first value instead', () => {
    expect(parseJson(source, { duplicateKeys: 'first' }).value).toEqual({ a: 1, b: 2 });
  });

  it('can refuse the document outright', () => {
    const r = parseJson(source, { duplicateKeys: 'error' });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/Duplicate key "a"/);
  });

  it('finds duplicates nested inside arrays and objects', () => {
    const r = parseJson('{"outer": [{"x": 1, "x": 2}]}');
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]!.path).toBe('$.outer[0].x');
  });

  it('counts three occurrences of the same key', () => {
    const r = parseJson('{"a":1,"a":2,"a":3}');
    expect(r.duplicates.map((d) => d.occurrences)).toEqual([2, 3]);
  });
});

describe('number precision', () => {
  it('reports an integer too large for a double', () => {
    const r = parseJson('{"id": 9007199254740993}');
    expect(r.ok).toBe(true);
    expect(r.precisionLoss).toHaveLength(1);
    expect(r.precisionLoss[0]!.raw).toBe('9007199254740993');
    expect(r.precisionLoss[0]!.stored).toBe('9007199254740992');
    expect(r.precisionLoss[0]!.path).toBe('$.id');
  });

  it('reports a long decimal that gets rounded', () => {
    const r = parseJson('{"v": 0.12345678901234567890123}');
    expect(r.precisionLoss).toHaveLength(1);
  });

  it('does not complain about numbers that survive exactly', () => {
    for (const n of ['1', '-1', '0', '0.5', '1e10', '9007199254740991', '1.25', '-0']) {
      expect(parseJson(n).precisionLoss, n).toHaveLength(0);
    }
  });

  it('flags a twitter-style snowflake id, which is the classic case', () => {
    const r = parseJson('{"tweet_id": 1234567890123456789}');
    expect(r.precisionLoss).toHaveLength(1);
  });
});

describe('error positions', () => {
  it('reports the line and column of the problem', () => {
    const source = '{\n  "a": 1,\n  "b": oops\n}';
    const r = parseJson(source);
    expect(r.ok).toBe(false);
    expect(r.error?.line).toBe(3);
    expect(r.error?.column).toBe(8);
  });

  it('reports the path where the problem occurred', () => {
    const r = parseJson('{"a": {"b": [1, 2, }]}');
    expect(r.ok).toBe(false);
    expect(r.error?.path).toContain('$.a.b');
  });

  it('names an unterminated string', () => {
    const r = parseJson('{"a": "unclosed');
    expect(r.error?.message).toMatch(/never closed/);
  });

  it('names an unterminated object', () => {
    expect(parseJson('{"a": 1').error?.message).toMatch(/never closed/);
    expect(parseJson('[1, 2').error?.message).toMatch(/never closed/);
  });

  it('says the input is empty rather than giving a parse error', () => {
    expect(parseJson('').error?.message).toMatch(/empty/);
    expect(parseJson('   \n  ').error?.message).toMatch(/empty/);
  });
});

describe('comments (JSONC)', () => {
  it('rejects comments by default, because plain JSON has none', () => {
    expect(parseJson('{"a": 1} // note').ok).toBe(false);
  });

  it('accepts line and block comments when asked', () => {
    const source = `{
      // a line comment
      "compilerOptions": { /* inline */ "strict": true },
      "include": ["src"] // trailing
    }`;
    const r = parseJson(source, { allowComments: true });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ compilerOptions: { strict: true }, include: ['src'] });
  });

  it('reports an unclosed block comment', () => {
    const r = parseJson('{"a": 1 /* never ends', { allowComments: true });
    expect(r.error?.message).toMatch(/never closed/);
  });

  it('does not treat a comment marker inside a string as a comment', () => {
    const r = parseJson('{"url": "https://example.com"}', { allowComments: true });
    expect(r.ok).toBe(true);
    expect((r.value as Record<string, string>).url).toBe('https://example.com');
  });
});

describe('formatting', () => {
  const source = '{"b":2,"a":{"d":4,"c":3}}';

  it('indents with spaces or tabs', () => {
    expect(format('{"a":1}', { indent: '2' }).output).toBe('{\n  "a": 1\n}');
    expect(format('{"a":1}', { indent: '4' }).output).toBe('{\n    "a": 1\n}');
    expect(format('{"a":1}', { indent: 'tab' }).output).toBe('{\n\t"a": 1\n}');
  });

  it('minifies', () => {
    expect(format('{ "a" : 1 , "b" : [ 1 , 2 ] }', { indent: 'minify' }).output).toBe('{"a":1,"b":[1,2]}');
  });

  it('sorts keys at every level', () => {
    expect(format(source, { indent: 'minify', sortKeys: 'asc' }).output).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(format(source, { indent: 'minify', sortKeys: 'desc' }).output).toBe('{"b":2,"a":{"d":4,"c":3}}');
  });

  it('does not reorder array elements when sorting keys', () => {
    expect(format('[3,1,2]', { indent: 'minify', sortKeys: 'asc' }).output).toBe('[3,1,2]');
  });

  it('reports input and output sizes in bytes', () => {
    const r = format('{"é":1}', { indent: 'minify' });
    // é is two bytes in UTF-8, so bytes exceed characters.
    expect(r.inputBytes).toBe(8);
    expect(r.outputBytes).toBe(8);
  });

  it('emits JSON Lines for a top-level array', () => {
    expect(format('[{"a":1},{"a":2}]', { jsonLines: true }).output).toBe('{"a":1}\n{"a":2}');
  });

  it('returns an empty output and the error when the input is invalid', () => {
    const r = format('{bad}');
    expect(r.ok).toBe(false);
    expect(r.output).toBe('');
    expect(r.error).toBeDefined();
  });
});

describe('ASCII-only escaping', () => {
  it('escapes characters above ASCII', () => {
    expect(escapeNonAscii('"café"')).toBe('"caf\\u00e9"');
  });

  it('escapes astral characters as a surrogate pair', () => {
    expect(escapeNonAscii('"👋"')).toBe('"\\ud83d\\udc4b"');
  });

  it('round-trips back through the parser to the same value', () => {
    const original = { name: 'café 👋🏽', note: '日本語' };
    const escaped = format(JSON.stringify(original), { asciiOnly: true, indent: 'minify' }).output;
    expect(/^[\x20-\x7e]*$/.test(escaped)).toBe(true);
    expect(JSON.parse(escaped)).toEqual(original);
  });
});

describe('statistics and tree view', () => {
  it('counts each kind of value', () => {
    const r = parseJson('{"a":[1,2,"x"],"b":{"c":true,"d":null}}');
    expect(r.stats.objects).toBe(2);
    expect(r.stats.arrays).toBe(1);
    expect(r.stats.numbers).toBe(2);
    expect(r.stats.strings).toBe(1);
    expect(r.stats.booleans).toBe(1);
    expect(r.stats.nulls).toBe(1);
    expect(r.stats.keys).toBe(4);
  });

  it('records the deepest nesting', () => {
    expect(parseJson('[[[[1]]]]').stats.maxDepth).toBe(5);
  });

  it('refuses nesting past the configured limit instead of blowing the stack', () => {
    const deep = '['.repeat(2000) + ']'.repeat(2000);
    const r = parseJson(deep, { maxDepth: 200 });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/Nesting is deeper/);
  });

  it('builds a tree with one node per value', () => {
    const nodes = toTree({ a: 1, b: [2, 3] });
    expect(nodes[0]!.type).toBe('object');
    expect(nodes.map((n) => n.path)).toEqual(['$', '$.a', '$.b', '$.b[0]', '$.b[1]']);
    expect(nodes[2]!.preview).toBe('[ 2 items ]');
  });

  it('truncates a long string in the preview', () => {
    const nodes = toTree({ a: 'x'.repeat(200) });
    expect(nodes[1]!.preview.length).toBeLessThan(100);
    expect(nodes[1]!.preview).toContain('…');
  });
});

describe('repair suggestions', () => {
  it('spots a JSONC document', () => {
    const s = suggestRepairs('{\n // hi\n "a": 1,\n}');
    expect(s[0]!.description).toMatch(/JSONC/);
  });

  it('suggests replacing single quotes', () => {
    const s = suggestRepairs("{'a': 1}");
    expect(s.some((x) => /single quotes/.test(x.description))).toBe(true);
  });

  it('suggests quoting bare keys', () => {
    const s = suggestRepairs('{a: 1, b: 2}');
    expect(s.some((x) => /unquoted object keys/.test(x.description))).toBe(true);
  });

  it('offers nothing when the input is already valid', () => {
    expect(suggestRepairs('{"a":1}')).toHaveLength(0);
  });

  it('every suggestion it returns actually parses', () => {
    for (const bad of ["{'a':1}", '{a:1}', '[1,2,]', '{\n//c\n"a":1}']) {
      for (const s of suggestRepairs(bad)) {
        expect(parseJson(s.repaired, { allowComments: true, allowTrailingCommas: true }).ok).toBe(true);
      }
    }
  });
});

describe('large and adversarial input', () => {
  it('handles a large document', () => {
    const big = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ id: i, name: `row ${i}` })));
    const r = format(big, { indent: 'minify' });
    expect(r.ok).toBe(true);
    expect(r.output).toBe(big);
  });

  it('does not execute anything in a string that looks like code', () => {
    const r = parseJson('{"x": "<script>alert(1)</script>"}');
    expect(r.ok).toBe(true);
    expect((r.value as Record<string, string>).x).toBe('<script>alert(1)</script>');
  });

  it('treats __proto__ as an ordinary key without polluting the prototype', () => {
    const r = parseJson('{"__proto__": {"polluted": true}}');
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(r.value, '__proto__')).toBe(true);
  });

  it('handles an empty key and an empty string value', () => {
    expect(parseJson('{"":""}').value).toEqual({ '': '' });
  });
});
