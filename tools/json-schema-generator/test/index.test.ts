import { it, expect } from 'vitest';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { generateSchema, SchemaGeneratorError } from '../src/index';

/**
 * The oracle every generated schema is checked against: an independent Ajv
 * instance (draft-07 or 2020-12), never reused across calls, that confirms
 * the generated schema is itself valid against its own draft's metaschema
 * and that it actually accepts the samples it was inferred from.
 * `strict: true` (default) with `strictTypes`/`strictTuples` relaxed
 * matches Ajv's own recommended "check my own output is sane" posture,
 * per this package's own testNotes.
 */
function oracleFor(draft: 'draft-07' | '2020-12') {
  const ajv =
    draft === '2020-12'
      ? new Ajv2020({ strict: true, strictTypes: false, strictTuples: false, logger: false })
      : new Ajv({ strict: true, strictTypes: false, strictTuples: false, logger: false });
  addFormats(ajv);
  return ajv;
}

function assertMetaschemaValid(ajv: InstanceType<typeof Ajv>, schema: unknown): void {
  const ok = ajv.validateSchema(schema as object);
  expect(ok).toBe(true);
}

it('samples with the same shape produce a schema that Ajv accepts for every sample in draft-07 and 2020-12', () => {
  const samplesText = '[{"id":1,"name":"Ada"},{"id":2,"name":"Grace"}]';
  const samples = JSON.parse(samplesText) as unknown[];

  for (const draft of ['draft-07', '2020-12'] as const) {
    const result = generateSchema(samplesText, { samplesAre: 'array', draft });
    const ajv = oracleFor(draft);
    assertMetaschemaValid(ajv, result.schema);
    const validate = ajv.compile(result.schema as object);
    for (const sample of samples) expect(validate(sample)).toBe(true);
  }
});

it('a key missing from some samples is optional and a key present in all is required', () => {
  const result = generateSchema('[{"id":1,"name":"Ada"},{"id":2}]', { samplesAre: 'array' });
  const schema = result.schema as { required?: string[]; properties: Record<string, unknown> };
  expect(schema.required).toEqual(['id']);
  expect(schema.properties.id).toMatchObject({ type: 'integer' });
  expect(schema.properties.name).toMatchObject({ type: 'string' });

  const ajv = oracleFor('2020-12');
  assertMetaschemaValid(ajv, result.schema);
  const validate = ajv.compile(result.schema as object);
  expect(validate({ id: 1, name: 'Ada' })).toBe(true);
  expect(validate({ id: 2 })).toBe(true);
});

it('mixed types across samples become a type list and null is kept', () => {
  const result = generateSchema('[{"v":1},{"v":null}]', { samplesAre: 'array' });
  const schema = result.schema as { properties: Record<string, { type: unknown }> };
  expect(schema.properties.v?.type).toEqual(['null', 'integer']);

  const ajv = oracleFor('2020-12');
  assertMetaschemaValid(ajv, result.schema);
  const validate = ajv.compile(result.schema as object);
  expect(validate({ v: 1 })).toBe(true);
  expect(validate({ v: null })).toBe(true);
  // A value changed to a type not seen in the samples is rejected.
  expect(validate({ v: 'x' })).toBe(false);
});

it('integers and non-integer numbers are told apart', () => {
  const intOnly = generateSchema('[{"v":1},{"v":2}]', { samplesAre: 'array' });
  expect((intOnly.schema as { properties: Record<string, { type: unknown }> }).properties.v?.type).toBe('integer');

  const mixed = generateSchema('[{"v":1},{"v":1.5}]', { samplesAre: 'array' });
  expect((mixed.schema as { properties: Record<string, { type: unknown }> }).properties.v?.type).toBe('number');

  const ajv = oracleFor('2020-12');
  const validate = ajv.compile(mixed.schema as object);
  expect(validate({ v: 1 })).toBe(true);
  expect(validate({ v: 1.5 })).toBe(true);
  expect(validate({ v: 'x' })).toBe(false);
});

it('array items from different samples are merged into one item schema', () => {
  const result = generateSchema('[[1],["a"]]', { samplesAre: 'array' });
  const schema = result.schema as { type: string; items: { type: unknown } };
  expect(schema.type).toBe('array');
  expect(schema.items.type).toEqual(['integer', 'string']);

  const ajv = oracleFor('2020-12');
  assertMetaschemaValid(ajv, result.schema);
  const validate = ajv.compile(result.schema as object);
  expect(validate([1])).toBe(true);
  expect(validate(['a'])).toBe(true);
  expect(validate([1, 'a'])).toBe(true);
  expect(validate([true])).toBe(false);
});

it('detected string formats validate under ajv-formats', () => {
  const dateTimeResult = generateSchema('["2020-01-02T03:04:05Z","2021-06-07T08:09:10+01:00"]', {
    samplesAre: 'array',
  });
  expect((dateTimeResult.schema as { format?: string }).format).toBe('date-time');

  const dateResult = generateSchema('["2020-01-02","2021-06-07"]', { samplesAre: 'array' });
  expect((dateResult.schema as { format?: string }).format).toBe('date');

  const uuidResult = generateSchema('["123e4567-e89b-12d3-a456-426614174000"]', { samplesAre: 'array' });
  expect((uuidResult.schema as { format?: string }).format).toBe('uuid');

  const ipv4Result = generateSchema('["192.168.0.1","10.0.0.1"]', { samplesAre: 'array' });
  expect((ipv4Result.schema as { format?: string }).format).toBe('ipv4');

  const ajv = oracleFor('2020-12');
  for (const result of [dateTimeResult, dateResult, uuidResult, ipv4Result]) {
    assertMetaschemaValid(ajv, result.schema);
    const validate = ajv.compile(result.schema as object);
    expect(validate('not a valid value for any of these formats')).toBe(false);
  }

  // A single sample that does NOT match any of the four detected formats
  // gets no format keyword at all.
  const plain = generateSchema('["hello world"]', { samplesAre: 'array' });
  expect((plain.schema as { format?: string }).format).toBeUndefined();

  // detectFormats: false turns detection off even for samples that would
  // otherwise match.
  const off = generateSchema('["192.168.0.1"]', { samplesAre: 'array', detectFormats: false });
  expect((off.schema as { format?: string }).format).toBeUndefined();
});

it('the generated schema is valid against its own draft metaschema', () => {
  const samplesText =
    '[{"id":1,"name":"Ada","tags":["a","b"],"score":1.5,"active":true,"note":null},{"id":2,"tags":[],"score":2,"active":false}]';
  for (const draft of ['draft-07', '2020-12'] as const) {
    const result = generateSchema(samplesText, { samplesAre: 'array', draft });
    const ajv = oracleFor(draft);
    assertMetaschemaValid(ajv, result.schema);
  }
});

it('a key named __proto__ appears in properties and Object.prototype is never modified', () => {
  const before = Object.keys(Object.prototype).length;
  const result = generateSchema('[{"__proto__":1,"constructor":"x"}]', { samplesAre: 'array' });
  const schema = result.schema as { properties: Record<string, unknown> };
  expect(Object.hasOwn(schema.properties, '__proto__')).toBe(true);
  expect(Object.hasOwn(schema.properties, 'constructor')).toBe(true);
  expect(Object.getPrototypeOf(schema.properties)).toBe(Object.prototype);
  expect(Object.keys(Object.prototype).length).toBe(before);

  const ajv = oracleFor('2020-12');
  assertMetaschemaValid(ajv, result.schema);
  const validate = ajv.compile(result.schema as object);
  expect(validate({ __proto__: 1, constructor: 'x' })).toBe(true);
});

it('samples given as JSON Lines are read one document per non-blank line', () => {
  const result = generateSchema('{"a":1}\n\n{"a":2}\n', { samplesAre: 'lines' });
  expect(result.sampleCount).toBe(2);
  expect((result.schema as { properties: Record<string, { type: unknown }> }).properties.a?.type).toBe('integer');
});

it('a malformed sample document is refused naming its line in JSON Lines mode', () => {
  expect(() => generateSchema('{"a":1}\nnot json\n{"a":2}', { samplesAre: 'lines' })).toThrow(SchemaGeneratorError);
  try {
    generateSchema('{"a":1}\nnot json\n{"a":2}', { samplesAre: 'lines' });
  } catch (err) {
    expect(err).toBeInstanceOf(SchemaGeneratorError);
    expect((err as SchemaGeneratorError).line).toBe(2);
  }
});

it('array mode refuses non-array JSON naming the problem', () => {
  expect(() => generateSchema('{"a":1}', { samplesAre: 'array' })).toThrow(SchemaGeneratorError);
});

it('nesting deeper than 512 levels is refused with a plain message', () => {
  let deep: unknown = 1;
  for (let i = 0; i < 520; i++) deep = [deep];
  expect(() => generateSchema(JSON.stringify(deep), { samplesAre: 'single' })).toThrow(
    'nested more than 512 levels deep',
  );
});
