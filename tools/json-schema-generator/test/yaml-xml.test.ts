import { it, expect } from 'vitest';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse as parseYamlIndependently } from 'yaml';
import { generateSchema, generateSchemaFromValues, SchemaGeneratorError, type SamplesAre } from '../src/index';

/**
 * YAML and XML samples must infer the schema the equivalent JSON samples infer. Each YAML or XML sample is paired
 * with the JSON text a reader would write by hand from the format's own rules:
 *  - YAML 1.2.2 section 10.3.2 (core schema): `36` is an integer, `1.0` is a float, `true` is a boolean, a quoted
 *    scalar is a string, and a date such as 2001-01-01 is a plain string because the core schema has no timestamp;
 *  - YAML 1.2.2 section 9.1: a stream holds several documents, each started by `---`;
 *  - XML 1.0: an attribute belongs to its element, repeated sibling elements are a list; this page's stated rules put
 *    attributes under `@_` names and text beside attributes under `#text`;
 *  - RFC 8259 section 6: the number grammar the XML reader uses to decide that text is a number.
 */

const DRAFTS = ['2020-12', 'draft-07'] as const;

it('YAML samples infer the same schema as the equivalent JSON samples for single, array and lines modes', () => {
  const cases: { samplesAre: SamplesAre; yaml: string; json: string }[] = [
    {
      samplesAre: 'single',
      yaml: 'id: 1\nname: Ada\ntags:\n  - a\nwhen: 2001-01-01\nactive: true\nmanager: null\n',
      json: '{"id":1,"name":"Ada","tags":["a"],"when":"2001-01-01","active":true,"manager":null}',
    },
    {
      samplesAre: 'array',
      yaml: '- id: 1\n  name: Ada\n- id: 2\n- id: 3\n  name: Grace\n',
      json: '[{"id":1,"name":"Ada"},{"id":2},{"id":3,"name":"Grace"}]',
    },
    {
      samplesAre: 'lines',
      yaml: '---\nid: 1\nname: Ada\n---\nid: 2\n---\nid: 3\nname: Grace\n',
      json: '{"id":1,"name":"Ada"}\n{"id":2}\n{"id":3,"name":"Grace"}',
    },
  ];

  for (const draft of DRAFTS) {
    for (const c of cases) {
      const fromYaml = generateSchema(c.yaml, { samplesAre: c.samplesAre, draft, inputFormat: 'yaml' });
      const fromJson = generateSchema(c.json, { samplesAre: c.samplesAre, draft });
      expect(fromYaml.schema, `${draft} ${c.samplesAre}`).toEqual(fromJson.schema);
      expect(fromYaml.output).toBe(fromJson.output);
      expect(fromYaml.sampleCount).toBe(fromJson.sampleCount);
    }
  }

  // Literal anchors written from the rules above, not from a run: `id` is in every sample so it is required, `name`
  // is not, and a plain 2001-01-01 is a string that matches the date format.
  const array = generateSchema(cases[1]!.yaml, { samplesAre: 'array', inputFormat: 'yaml' });
  expect((array.schema as { required?: string[] }).required).toEqual(['id']);
  const single = generateSchema(cases[0]!.yaml, { inputFormat: 'yaml' });
  const props = (single.schema as { properties: Record<string, unknown> }).properties;
  expect(props.when).toEqual({ type: 'string', format: 'date' });
  expect(props.manager).toEqual({ type: 'null' });
  expect(array.sampleCount).toBe(3);
});

it('generateSchemaFromValues of parsed JSON samples equals generateSchema of their text', () => {
  const cases: { text: string; samplesAre: SamplesAre }[] = [
    { text: '{"id":1,"name":"Ada","tags":["x"]}', samplesAre: 'single' },
    { text: '[{"id":1,"name":"Ada"},{"id":2,"extra":null}]', samplesAre: 'array' },
    { text: '{"a":1}\n{"a":"x","b":[1,2.5]}', samplesAre: 'lines' },
    { text: '5', samplesAre: 'single' },
  ];
  for (const draft of DRAFTS) {
    for (const detectFormats of [true, false]) {
      for (const c of cases) {
        const values =
          c.samplesAre === 'single'
            ? [JSON.parse(c.text) as unknown]
            : c.samplesAre === 'array'
              ? (JSON.parse(c.text) as unknown[])
              : c.text.split('\n').map((line) => JSON.parse(line) as unknown);
        const viaValues = generateSchemaFromValues(values, { draft, detectFormats });
        const viaText = generateSchema(c.text, { samplesAre: c.samplesAre, draft, detectFormats });
        expect(viaValues, `${draft} ${detectFormats} ${c.text}`).toEqual(viaText);
      }
    }
  }
  expect(() => generateSchemaFromValues([], {})).toThrow(SchemaGeneratorError);
});

it('XML input infers from one document and the other sample modes warn', () => {
  const xml = '<person id="1"><name>Ada</name><tag>a</tag><tag>b</tag></person>';

  // With numbers and booleans read, the attribute value 1 is an integer; XML names the attribute @_id (written last
  // because the reader lists child elements before attributes) and the repeated tag elements are a list.
  const typed = generateSchema(xml, { inputFormat: 'xml', parseValues: true });
  expect(typed.schema).toEqual({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      person: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          tag: { type: 'array', items: { type: 'string' } },
          '@_id': { type: 'integer' },
        },
        required: ['name', 'tag', '@_id'],
      },
    },
    required: ['person'],
  });
  expect(typed.sampleCount).toBe(1);
  expect(typed.warnings ?? []).toEqual([]);

  // Left off, every XML leaf is a string.
  const strings = generateSchema(xml, { inputFormat: 'xml' });
  const person = (strings.schema as { properties: { person: { properties: Record<string, unknown> } } }).properties
    .person;
  expect(person.properties['@_id']).toEqual({ type: 'string' });

  // XML holds one document: the other two choices are not applied, and a warning says so.
  for (const samplesAre of ['array', 'lines'] as const) {
    const result = generateSchema(xml, { inputFormat: 'xml', parseValues: true, samplesAre });
    expect(result.schema).toEqual(typed.schema);
    expect(result.sampleCount).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatch(/one document/);
  }

  // A DOCTYPE is refused before the XML is read, naming its line.
  try {
    generateSchema('<?xml version="1.0"?>\n<!DOCTYPE r [<!ENTITY x "boom">]>\n<r>&x;</r>', { inputFormat: 'xml' });
    throw new Error('expected a refusal');
  } catch (err) {
    expect(err).toBeInstanceOf(SchemaGeneratorError);
    expect((err as SchemaGeneratorError).message).toMatch(/DOCTYPE/);
    expect((err as SchemaGeneratorError).line).toBe(2);
  }
});

it('YAML 1.0 infers as an integer exactly as JSON 1.0 does', () => {
  const typeOf = (schema: unknown) => (schema as { properties: { v: { type: unknown } } }).properties.v.type;
  expect(typeOf(generateSchema('v: 1.0\n', { inputFormat: 'yaml' }).schema)).toBe('integer');
  expect(typeOf(generateSchema('{"v":1.0}').schema)).toBe('integer');
  // A value with a fractional part is a number in both.
  expect(typeOf(generateSchema('v: 1.5\n', { inputFormat: 'yaml' }).schema)).toBe('number');
  expect(typeOf(generateSchema('{"v":1.5}').schema)).toBe('number');
  // An integer and a float at one place widen to number, as for JSON.
  const mixed = generateSchema('- v: 1\n- v: 2.5\n', { inputFormat: 'yaml', samplesAre: 'array' });
  expect(typeOf(mixed.schema)).toBe('number');
});

it('the schema inferred from a YAML sample accepts that sample under ajv', () => {
  const yamlText = [
    '- id: 1',
    '  name: Ada',
    '  joined: 2024-02-29',
    '  tags: [a, b]',
    '  address: {city: Paris, zip: "75001"}',
    '  manager: null',
    '- id: 2',
    '  name: Grace',
    '  ratio: 0.5',
    '',
  ].join('\n');
  // The sample's own values come from an independent read of the same text.
  const samples = parseYamlIndependently(yamlText) as unknown[];
  expect(samples).toHaveLength(2);

  for (const draft of DRAFTS) {
    const ajv =
      draft === '2020-12'
        ? new Ajv2020({ strict: true, strictTypes: false, strictTuples: false, logger: false })
        : new Ajv({ strict: true, strictTypes: false, strictTuples: false, logger: false });
    addFormats(ajv);
    const result = generateSchema(yamlText, { samplesAre: 'array', draft, inputFormat: 'yaml' });
    expect(ajv.validateSchema(result.schema as object)).toBe(true);
    const validate = ajv.compile(result.schema as object);
    for (const sample of samples) expect(validate(sample), `${draft}: ${JSON.stringify(validate.errors)}`).toBe(true);
  }
});

it('a YAML stream in single mode, a non-list in array mode, a duplicate key and an unresolved alias are refused with a position or reason', () => {
  const refusal = (text: string, samplesAre: SamplesAre = 'single'): SchemaGeneratorError => {
    try {
      generateSchema(text, { inputFormat: 'yaml', samplesAre });
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaGeneratorError);
      return err as SchemaGeneratorError;
    }
    throw new Error('expected a refusal for: ' + text);
  };
  const stream = refusal('a: 1\n---\nb: 2\n');
  expect(stream.message).toMatch(/more than one document/);
  expect(stream.line).toBe(2);
  expect(refusal('a: 1\n', 'array').message).toMatch(/list/);
  const duplicate = refusal('a: 1\nb: 2\na: 3\n');
  expect(duplicate.line).toBe(3);
  expect(duplicate.message).toMatch(/unique/i);
  expect(refusal('a: *nope\n').message).toMatch(/nope/);
  expect(refusal('['.repeat(600) + ']'.repeat(600)).message).toMatch(/512 levels/);
  // Nothing but documents with no content gives nothing to infer from.
  expect(refusal('---\n---\n', 'lines').message).toMatch(/At least one sample/);
});

it('a YAML alias is reported as a warning and a key named __proto__ stays an ordinary property', () => {
  const result = generateSchema('base: &b {x: 1}\ncopy: *b\n__proto__: {y: 2}\n', { inputFormat: 'yaml' });
  expect(result.warnings).toEqual([
    'A YAML anchor and its aliases were expanded into separate copies of the same value.',
  ]);
  const props = (result.schema as { properties: Record<string, unknown> }).properties;
  expect(Object.keys(props)).toEqual(['base', 'copy', '__proto__']);
  expect(({} as Record<string, unknown>).y).toBeUndefined();
});

it('JSON stays the default input format and an explicit json choice changes nothing', () => {
  const text = '[{"id":1,"name":"Ada"},{"id":2}]';
  expect(generateSchema(text, { samplesAre: 'array', inputFormat: 'json' })).toEqual(
    generateSchema(text, { samplesAre: 'array' }),
  );
  expect(() => generateSchema('{"a":', {})).toThrow(SchemaGeneratorError);
});
