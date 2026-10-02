import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parse as parseYamlIndependently } from 'yaml';
import { generateMockData, MockDataError } from '../src/index';

/**
 * XML and YAML must hold the same records as JSON for the same seed, field list and count. The expectations are
 * written from the formats' own rules, never from a run of the new writers:
 *  - XML 1.0 section 2.4: `&` and `<` in text are written as `&amp;` and `&lt;` (and `>` as `&gt;`);
 *  - XML 1.0 section 2.3: an element name is a Name, so `first name` (it has a space) cannot be an element name;
 *  - YAML 1.2.2 section 10.3.2 and YAML 1.1: `yes`, `on`, `null`, `1e3` and `true` written bare are not strings in at
 *    least one of the two, so the writer quotes them, and an independent read of its output must give strings back.
 */

const REFERENCE_FIELDS = [
  'id: id',
  'name: fullName',
  'email: email',
  'joined: date(2000-01-01, 2024-12-31)',
  'score: decimal(0, 100, 2)',
  'active: boolean',
  'ip: ipv4',
  'key: uuid',
].join('\n');

/** The digest of JSON Lines and CSV output for the reference seed, taken before XML and YAML were added. */
const JSONL_GOLDEN_SHA256 = '4b4e0284697cd4a965a147a8aac69c5442e1af951ef46279b90a3543a00d6dc9';
const CSV_GOLDEN_SHA256 = '9f2878fe23ab4ccb30c21fe957706251e75674967790097642ca7c2c25864d70';
const JSON_GOLDEN_SHA256 = 'a06c7398253c4a28595ec42127071fd0440628138aea3172e6509bb7d5f22737';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The XML a reader writes by hand for a list of records: one record element per record, one element per field. */
function handWrittenXml(records: Record<string, string | number | boolean>[]): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<records>'];
  for (const record of records) {
    lines.push('  <record>');
    for (const [name, value] of Object.entries(record)) lines.push(`    <${name}>${escape(String(value))}</${name}>`);
    lines.push('  </record>');
  }
  lines.push('</records>');
  return lines.join('\n');
}

it('the same seed and fields give the same records as JSON, XML and YAML', () => {
  // Fields whose JSON text and plain value agree exactly (no trailing-zero decimals), so the hand-written XML below
  // can be built from the JSON records alone.
  const fields = [
    'id: id',
    'name: fullName',
    'email: email',
    'joined: date(2000-01-01, 2024-12-31)',
    'active: boolean',
    'n: integer(-50, 50)',
    'ip: ipv4',
    'key: uuid',
  ].join('\n');
  const options = { seed: 'demo', fields, count: 6 } as const;

  const json = generateMockData({ ...options, format: 'json' });
  const records = JSON.parse(json.output) as Record<string, string | number | boolean>[];
  expect(records).toHaveLength(6);

  const xml = generateMockData({ ...options, format: 'xml' });
  expect(xml.output).toBe(handWrittenXml(records));
  expect(xml.records).toBe(json.records);
  expect(xml.fields).toBe(json.fields);

  const yaml = generateMockData({ ...options, format: 'yaml' });
  expect(parseYamlIndependently(yaml.output)).toEqual(records);
  expect(yaml.records).toBe(json.records);
  expect(yaml.fields).toBe(json.fields);

  // A decimal keeps its two places in XML text and in YAML, as it does in JSON.
  const decimals = { seed: 'demo', fields: 'score: decimal(-100, 100, 2)', count: 12 } as const;
  const jsonScores = generateMockData({ ...decimals, format: 'json' }).output.match(/-?\d+\.\d{2}/g)!;
  const xmlScores = [...generateMockData({ ...decimals, format: 'xml' }).output.matchAll(/<score>(.*?)<\/score>/g)].map(
    (m) => m[1],
  );
  const yamlScores = [...generateMockData({ ...decimals, format: 'yaml' }).output.matchAll(/score: (.*)/g)].map(
    (m) => m[1],
  );
  expect(jsonScores).toHaveLength(12);
  expect(xmlScores).toEqual(jsonScores);
  expect(yamlScores).toEqual(jsonScores);

  // One record is still a list of one in XML and YAML.
  const one = generateMockData({ seed: 'demo', fields: 'id: id', count: 1, format: 'xml' });
  expect(one.output).toBe(
    '<?xml version="1.0" encoding="UTF-8"?>\n<records>\n  <record>\n    <id>1</id>\n  </record>\n</records>',
  );
  expect(
    parseYamlIndependently(generateMockData({ seed: 'demo', fields: 'id: id', count: 1, format: 'yaml' }).output),
  ).toEqual([{ id: 1 }]);
});

it('XML output names elements after the fields, escapes text and refuses a field name that is not an XML name with its line', () => {
  const escaped = generateMockData({
    seed: 'x',
    fields: 'v: oneOf(a & b)\nw: oneOf(x < y > z)\nq: oneOf(say "hi")',
    count: 1,
    format: 'xml',
  });
  expect(escaped.output).toContain('<v>a &amp; b</v>');
  expect(escaped.output).toContain('<w>x &lt; y &gt; z</w>');
  expect(escaped.output).toContain('<q>say "hi"</q>');

  // A name with a space is not an XML 1.0 Name: refused for XML, naming the field and its line in the list.
  const spaced = 'id: id\nfirst name: fullName';
  try {
    generateMockData({ seed: 'x', fields: spaced, count: 2, format: 'xml' });
    throw new Error('expected a refusal');
  } catch (err) {
    expect(err).toBeInstanceOf(MockDataError);
    const refusal = err as MockDataError;
    expect(refusal.line).toBe(2);
    expect(refusal.message).toContain('first name');
    expect(refusal.message).toContain('line 2');
    expect(refusal.message).toMatch(/XML/);
  }
  // A name that starts with a digit is refused too (XML 1.0 NameStartChar).
  expect(() => generateMockData({ seed: 'x', fields: '1st: id', count: 1, format: 'xml' })).toThrow(MockDataError);

  // The other formats still accept such a name, as they always did.
  for (const format of ['json', 'jsonl', 'csv', 'yaml'] as const) {
    const result = generateMockData({ seed: 'x', fields: spaced, count: 2, format });
    expect(result.output).toContain('first name');
  }

  // A value XML 1.0 cannot hold at all (U+0001) is refused with the field's line, never written.
  try {
    generateMockData({ seed: 'x', fields: 'id: id\nv: oneOf(a\u{1}b)', count: 1, format: 'xml' });
    throw new Error('expected a refusal');
  } catch (err) {
    expect(err).toBeInstanceOf(MockDataError);
    expect((err as MockDataError).line).toBe(2);
    expect((err as MockDataError).message).toMatch(/U\+0001/);
  }

  // A field named __proto__ is a valid XML name and an ordinary key, and never reaches the prototype.
  const proto = generateMockData({ seed: 'x', fields: '__proto__: id\nconstructor: id', count: 1, format: 'xml' });
  expect(proto.output).toContain('<__proto__>1</__proto__>');
  expect(proto.output).toContain('<constructor>1</constructor>');
  const protoYaml = generateMockData({ seed: 'x', fields: '__proto__: id', count: 1, format: 'yaml' });
  expect(protoYaml.output).toContain('__proto__: 1');
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

it('YAML output quotes yes, null and 1e3 so they read back as strings', () => {
  const words = ['yes', 'null', '1e3', 'on', 'No', 'true', '~', '2001-01-01', '0x1F', '12'];
  const fields = words.map((word, i) => `f${i}: oneOf(${word})`).join('\n');
  const result = generateMockData({ seed: 'x', fields, count: 2, format: 'yaml' });

  // Quoted in the text, so no reader takes them for another type.
  expect(result.output).toContain('f0: "yes"');
  expect(result.output).toContain('f1: "null"');
  expect(result.output).toContain('f2: "1e3"');

  // An independent read, under the 1.2 core schema and under YAML 1.1, gives strings back.
  for (const version of ['1.2', '1.1'] as const) {
    const read = parseYamlIndependently(result.output, { version }) as Record<string, unknown>[];
    expect(read).toHaveLength(2);
    for (const record of read) {
      words.forEach((word, i) => expect(record[`f${i}`], `${version} ${word}`).toBe(word));
    }
  }

  // Numbers and booleans are not quoted: they are numbers and booleans in the YAML, as in the JSON.
  const typed = generateMockData({ seed: 'demo', fields: REFERENCE_FIELDS, count: 3, format: 'yaml' });
  const read = parseYamlIndependently(typed.output) as Record<string, unknown>[];
  expect(typeof read[0]!.id).toBe('number');
  expect(typeof read[0]!.score).toBe('number');
  expect(typeof read[0]!.active).toBe('boolean');
  expect(typeof read[0]!.joined).toBe('string');
  expect(typed.output).toMatch(/score: \d+\.\d{2}/);
});

it('JSON Lines and CSV output are byte-identical to before for the golden seed', () => {
  const run = (format: 'json' | 'jsonl' | 'csv') =>
    generateMockData({ seed: 'demo', fields: REFERENCE_FIELDS, count: 25, format }).output;
  expect(sha256(run('json'))).toBe(JSON_GOLDEN_SHA256);
  expect(sha256(run('jsonl'))).toBe(JSONL_GOLDEN_SHA256);
  expect(sha256(run('csv'))).toBe(CSV_GOLDEN_SHA256);
});
