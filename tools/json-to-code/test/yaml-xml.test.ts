import { it, expect } from 'vitest';
import { jsonToCode, valueToCode, LANGUAGES, JsonToCodeError } from '../src/index';
import { readYamlValue, YamlValueError } from '../src/yaml-value';

/**
 * YAML and XML input must give the same types as the equivalent JSON. Every YAML and XML sample below is paired with
 * the JSON text a reader would write by hand from the format's own rules:
 *  - YAML 1.2.2 section 10.3.2 (core schema): a plain scalar written like an integer is an integer, one with a point
 *    is a float, `true`/`false` are booleans, `null`, `~` and an empty value are null, and anything else, including
 *    `yes`, is a string; a quoted scalar is always a string; `0o14` is octal and `0x1F` is hexadecimal;
 *  - YAML 1.2.2 section 7.1: an alias is a second node with the same content as its anchor;
 *  - XML 1.0 section 3.1: an attribute belongs to its element; the attribute and text rules this page states are
 *    `@_` for attributes and `#text` for text beside attributes or elements; repeated sibling elements are an array;
 *  - RFC 8259 section 6: a JSON number has no leading zeros, no plus sign and no hexadecimal form, which is the rule
 *    the XML reader here uses to decide whether a piece of text is a number.
 */

const ALIAS_WARNING = 'A YAML anchor and its aliases were expanded into separate copies of the same value.';

const YAML_SAMPLES: { yaml: string; json: string; extraWarnings: string[] }[] = [
  {
    yaml: [
      'id: 1',
      'name: Ada',
      'score: 9.5',
      'active: true',
      'manager: null',
      'tags:',
      '  - a',
      '  - b',
      'address:',
      '  city: Paris',
      '  zip: "75001"',
      '',
    ].join('\n'),
    json: '{"id":1,"name":"Ada","score":9.5,"active":true,"manager":null,"tags":["a","b"],"address":{"city":"Paris","zip":"75001"}}',
    extraWarnings: [],
  },
  {
    yaml: [
      '# a comment is not data',
      'base: &b {x: 1, y: [true, null]}',
      'copy: *b',
      'text: |',
      '  line one',
      '  line two',
      '',
    ].join('\n'),
    json: '{"base":{"x":1,"y":[true,null]},"copy":{"x":1,"y":[true,null]},"text":"line one\\nline two\\n"}',
    extraWarnings: [ALIAS_WARNING],
  },
  {
    yaml: ['a: 75001', 'b: 1.0', 'c: 0o14', 'd: 0x1F', 'e: yes', 'f: ~', 'g:', ''].join('\n'),
    json: '{"a":75001,"b":1.0,"c":12,"d":31,"e":"yes","f":null,"g":null}',
    extraWarnings: [],
  },
  {
    yaml: ['- id: 1', '  name: Ada', '- id: 2', '  extra: [1, 2.5]', ''].join('\n'),
    json: '[{"id":1,"name":"Ada"},{"id":2,"extra":[1,2.5]}]',
    extraWarnings: [],
  },
];

it('YAML input gives the same types as the equivalent JSON for every language', () => {
  for (const language of LANGUAGES) {
    for (const sample of YAML_SAMPLES) {
      const fromYaml = jsonToCode(sample.yaml, { language, rootName: 'Root', inputFormat: 'yaml' });
      const fromJson = jsonToCode(sample.json, { language, rootName: 'Root' });
      expect(fromYaml.output, `${language}: ${sample.yaml}`).toBe(fromJson.output);
      expect(fromYaml.typeCount).toBe(fromJson.typeCount);
      expect(fromYaml.warnings).toEqual([...sample.extraWarnings, ...fromJson.warnings]);
    }
  }

  // Literal anchors written from the YAML 1.2.2 core schema rules, not from a run: a quoted scalar is a string, a
  // plain integer is a number, and `yes` is a string.
  const first = jsonToCode(YAML_SAMPLES[0]!.yaml, { language: 'typescript', inputFormat: 'yaml' }).output;
  expect(first).toContain('id: number;');
  expect(first).toContain('name: string;');
  expect(first).toContain('active: boolean;');
  expect(first).toContain('zip: string;');
  const third = jsonToCode(YAML_SAMPLES[2]!.yaml, { language: 'typescript', inputFormat: 'yaml' }).output;
  expect(third).toContain('a: number;');
  expect(third).toContain('e: string;');
});

it('valueToCode of a parsed JSON value equals jsonToCode of its text for every language', () => {
  const texts = [
    '{"id":1,"name":"Ada","tags":["x"],"manager":null}',
    '{"type":"user","class":"admin","weird key":"x","extra":[1,"a"]}',
    '[{"a":1},{"a":2.5,"b":null}]',
    '5',
    '"text"',
    'null',
  ];
  for (const language of LANGUAGES) {
    for (const text of texts) {
      const expected = jsonToCode(text, { language, rootName: 'Thing' });
      const actual = valueToCode(JSON.parse(text) as unknown, { language, rootName: 'Thing' });
      expect(actual, `${language}: ${text}`).toEqual(expected);
    }
  }
});

it('XML input with read values gives the same types as the equivalent JSON and without it every leaf is a string', () => {
  const xml =
    '<person id="1"><name>Ada</name><age>36</age><score>9.5</score><active>true</active><tag>a</tag><tag>b</tag></person>';
  const typedJson = '{"person":{"name":"Ada","age":36,"score":9.5,"active":true,"tag":["a","b"],"@_id":1}}';
  const stringJson = '{"person":{"name":"Ada","age":"36","score":"9.5","active":"true","tag":["a","b"],"@_id":"1"}}';

  for (const language of LANGUAGES) {
    const typed = jsonToCode(xml, { language, inputFormat: 'xml', parseValues: true });
    expect(typed.output, language).toBe(jsonToCode(typedJson, { language }).output);
    const strings = jsonToCode(xml, { language, inputFormat: 'xml', parseValues: false });
    expect(strings.output, language).toBe(jsonToCode(stringJson, { language }).output);
    // Reading values is off unless asked for: the same text with the option left out is all strings.
    expect(jsonToCode(xml, { language, inputFormat: 'xml' }).output, language).toBe(strings.output);
  }

  const ts = jsonToCode(xml, { language: 'typescript', inputFormat: 'xml', parseValues: true }).output;
  expect(ts).toContain('age: number;');
  expect(ts).toContain('active: boolean;');
  expect(ts).toContain('tag: string[];');

  // Text is a number only when it is written the way JSON writes one (RFC 8259 section 6): leading zeros, a plus
  // sign and hexadecimal text stay strings, so a postcode or a phone number is never turned into an integer.
  const careful = jsonToCode('<r><zip>01234</zip><n>5</n><f>1.5</f><b>false</b><x>0x1F</x><p>+5</p></r>', {
    language: 'typescript',
    inputFormat: 'xml',
    parseValues: true,
  }).output;
  const carefulJson = jsonToCode('{"r":{"zip":"01234","n":5,"f":1.5,"b":false,"x":"0x1F","p":"+5"}}', {
    language: 'typescript',
  }).output;
  expect(careful).toBe(carefulJson);
});

it('a YAML stream, a scalar root, a duplicate key or too many aliases is refused, and a syntax error names its line and column', () => {
  const refusal = (text: string): JsonToCodeError => {
    try {
      jsonToCode(text, { language: 'typescript', inputFormat: 'yaml' });
    } catch (err) {
      expect(err).toBeInstanceOf(JsonToCodeError);
      return err as JsonToCodeError;
    }
    throw new Error('expected a refusal for: ' + text);
  };

  // Several documents in one stream: one box holds one document.
  const stream = refusal('a: 1\n---\nb: 2\n');
  expect(stream.message).toMatch(/more than one document/);
  // The second document starts at its --- marker on line 2.
  expect(stream.line).toBe(2);

  // A document that is a single value has no fields to give types to.
  expect(refusal('hello\n').message).toMatch(/single value/);
  expect(refusal('42\n').message).toMatch(/single value/);

  // YAML 1.2.2 section 3.2.1.1: a mapping's keys are unique; the second `a` is on line 3.
  const duplicate = refusal('a: 1\nb: 2\na: 3\n');
  expect(duplicate.message).toMatch(/unique/i);
  expect(duplicate.line).toBe(3);
  expect(duplicate.column).toBe(1);

  // More aliases than the limit of 100 is refused rather than expanded.
  const aliases = 'base: &a x\n' + Array.from({ length: 150 }, (_, i) => `k${i}: *a`).join('\n') + '\n';
  expect(refusal(aliases).message).toMatch(/alias/i);

  // YAML 1.2.2 section 6.1: a tab cannot indent a line; the tab starts line 2, column 1.
  const syntax = refusal('a: 1\n\tb: 2\n');
  expect(syntax.line).toBe(2);
  expect(syntax.column).toBe(1);

  // An alias with no anchor before it is refused, and the message says so rather than blaming the alias limit.
  expect(refusal('a: *nope\n').message).toMatch(/nope/);

  // Nesting beyond 512 levels is refused before anything walks it.
  expect(refusal('['.repeat(600) + ']'.repeat(600)).message).toMatch(/512 levels/);
  expect(refusal('['.repeat(200000)).message).toMatch(/512 levels|line/);

  // The reader itself reports a position on its own error type.
  try {
    readYamlValue('a: 1\na: 2\n', { documents: 'one' });
    throw new Error('expected a refusal');
  } catch (err) {
    expect(err).toBeInstanceOf(YamlValueError);
    expect((err as YamlValueError).line).toBe(2);
  }
}, 60_000);

it('XML input with a DOCTYPE is refused naming its line, and malformed XML names its line', () => {
  const doctype = '<?xml version="1.0"?>\n<!DOCTYPE r [<!ENTITY x "boom">]>\n<r>&x;</r>';
  try {
    jsonToCode(doctype, { language: 'typescript', inputFormat: 'xml' });
    throw new Error('expected a refusal');
  } catch (err) {
    expect(err).toBeInstanceOf(JsonToCodeError);
    expect((err as JsonToCodeError).message).toMatch(/DOCTYPE/);
    expect((err as JsonToCodeError).line).toBe(2);
  }
  try {
    jsonToCode('<a>\n  <b>\n</a>', { language: 'typescript', inputFormat: 'xml' });
    throw new Error('expected a refusal');
  } catch (err) {
    expect(err).toBeInstanceOf(JsonToCodeError);
    expect(typeof (err as JsonToCodeError).line).toBe('number');
  }
});

it('a YAML key named __proto__ stays an ordinary field and never reaches the prototype', () => {
  const result = jsonToCode('__proto__:\n  x: 1\nconstructor: 2\n', { language: 'typescript', inputFormat: 'yaml' });
  expect(result.output).toContain('__proto__: Proto;');
  expect(result.output).toContain('constructor: number;');
  expect(result.output).toContain('x: number;');
  expect(({} as Record<string, unknown>).x).toBeUndefined();
});

it('JSON stays the default input format and its warnings and errors are unchanged', () => {
  const asJson = jsonToCode('{"a":1}', { language: 'typescript' });
  const explicit = jsonToCode('{"a":1}', { language: 'typescript', inputFormat: 'json' });
  expect(explicit).toEqual(asJson);
  expect(() => jsonToCode('{"a":', { language: 'typescript' })).toThrow(JsonToCodeError);
  // A scalar JSON root is still accepted, as before.
  expect(jsonToCode('5', { language: 'typescript' }).output).toBe('export type Root = number;\n');
});
