import { buildSchema, graphqlSync, validateSchema } from 'graphql';
import { it, expect, vi } from 'vitest';
import { jsonToGraphql } from '../src/index';

// Fetched with `curl -fsSL https://spec.graphql.org/September2025/`, 2026-09-25.
// Section 2.1.9 Names: "Name ::= NameStart NameContinue*"; a Name starting
// with two underscores is reserved for GraphQL's own introspection system.
// This package's own GRAPHQL_NAME regex and rename rule implement exactly
// this grammar (quoted again where the rule is defined, tools/json-to-graphql/src/index.ts).
//
// RFC 8259 (JSON), section 2: "An object structure is represented as a pair
// of curly brackets surrounding zero or more name/value pairs."

// mulberry32, a small seeded PRNG (public domain, by Tommy Ettinger),
// used only to generate reproducible pseudo-random test documents -- never
// for anything the shipped tool itself does.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomScalar(rng: () => number): unknown {
  const r = rng();
  if (r < 0.2) return Math.floor(rng() * 4_000_000_000 - 2_000_000_000);
  if (r < 0.4) return rng() * 1000;
  if (r < 0.6) return rng() < 0.5;
  if (r < 0.8) return `str${Math.floor(rng() * 1000)}`;
  return null;
}

const RANDOM_KEYS = ['id', 'name', 'userId', '2bad', 'first-name', '__typename', 'tags', 'count', 'active', 'nested'];

function randomObject(rng: () => number, depth: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const fieldCount = 1 + Math.floor(rng() * 4);
  for (let i = 0; i < fieldCount; i++) {
    const base = RANDOM_KEYS[Math.floor(rng() * RANDOM_KEYS.length)]!;
    const key = rng() < 0.3 ? `${base}${Math.floor(rng() * 3)}` : base;
    obj[key] = randomValue(rng, depth);
  }
  return obj;
}

function randomArray(rng: () => number): unknown[] {
  const length = Math.floor(rng() * 4);
  const arr: unknown[] = [];
  for (let i = 0; i < length; i++) arr.push(randomScalar(rng));
  return arr;
}

function randomValue(rng: () => number, depth: number): unknown {
  if (depth <= 0) return randomScalar(rng);
  const r = rng();
  if (r < 0.45) return randomScalar(rng);
  if (r < 0.75) return randomObject(rng, depth - 1);
  return randomArray(rng);
}

it('inferred SDL passes graphql-js buildSchema and validateSchema for 300 seeded random documents', () => {
  const rng = mulberry32(20260925);
  for (let i = 0; i < 300; i++) {
    const doc = randomObject(rng, 3);
    const { output } = jsonToGraphql(JSON.stringify(doc));
    const schema = buildSchema(output);
    const errors = validateSchema(schema);
    if (errors.length > 0) {
      throw new Error(
        `document ${i} produced an invalid schema: ${errors.map((e) => e.message).join('; ')}\n${output}`,
      );
    }
  }
});

it('sample documents resolve through graphql-js against the inferred schema with no errors', () => {
  const sample = { id: 1, name: 'Ada', tags: ['a', 'b'], profile: { age: 30, active: true } };
  const { output } = jsonToGraphql(JSON.stringify(sample));
  const schema = buildSchema(output);
  expect(validateSchema(schema)).toEqual([]);

  const query = '{ root { id name tags profile { age active } } }';
  const result = graphqlSync({ schema, source: query, rootValue: { root: sample } });
  expect(result.errors).toBeUndefined();
  expect(result.data).toEqual({
    root: { id: '1', name: 'Ada', tags: ['a', 'b'], profile: { age: 30, active: true } },
  });
});

it('integers outside the GraphQL 32-bit Int range become Float with a warning', () => {
  const { output, warnings } = jsonToGraphql('{"n":3000000000}');
  expect(output).toContain('n: Float!');
  expect(warnings.some((w) => w.includes('32-bit'))).toBe(true);
});

it('keys that are not GraphQL names are renamed with a warning and names starting with two underscores are avoided', () => {
  const { output, warnings } = jsonToGraphql('{"first-name":"Ada","__typename":"x","2fa":true}');
  expect(warnings.length).toBeGreaterThanOrEqual(3);
  expect(output).toContain('first_name: String!');
  expect(output).toContain('_typename: String!');
  expect(output).toContain('_2fa: Boolean!');
  expect(output).not.toMatch(/\s__[A-Za-z_]/); // no field name starts with a double underscore
  const schema = buildSchema(output);
  expect(validateSchema(schema)).toEqual([]);
});

it('fields present and non-null in every sample become non-null', () => {
  const { output } = jsonToGraphql('[{"a":1},{"b":"x"}]', { samplesAre: 'array' });
  expect(output).toContain('a: Int');
  expect(output).not.toContain('a: Int!');
  expect(output).toContain('b: String');
  expect(output).not.toContain('b: String!');
});

it('arrays of objects become lists of a named type and mixed arrays fall back with a warning', () => {
  const { output: objectListOutput } = jsonToGraphql('{"friends":[{"name":"Leia"}]}');
  expect(objectListOutput).toMatch(/friends: \[Friend!?\]!/);
  expect(objectListOutput).toContain('type Friend {');

  const { output: mixedOutput, warnings } = jsonToGraphql('{"mixed":[1,"a",true]}');
  expect(mixedOutput).toMatch(/mixed: \[String!?\]!/); // falls back to String; still non-null since no element was literally null
  expect(warnings.some((w) => w.includes('mixed'))).toBe(true);
  const mixedWithNull = jsonToGraphql('{"mixed":[1,"a",null]}');
  expect(mixedWithNull.output).toContain('mixed: [String]!'); // a null element among the mix makes the item nullable
});

it('a JSON key named __proto__ becomes a renamed field and Object.prototype is never modified', () => {
  const { output, warnings } = jsonToGraphql('{"__proto__":"evil","name":"Ada"}');
  expect(output).not.toContain('__proto__');
  expect(warnings.some((w) => w.includes('__proto__'))).toBe(true);
  expect(Object.prototype as unknown as Record<string, unknown>).not.toHaveProperty('evil');
  const schema = buildSchema(output);
  expect(validateSchema(schema)).toEqual([]);
});

it('nothing is written to the console while inferring', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  try {
    jsonToGraphql('{"id":1,"__proto__":"x","n":3000000000,"mixed":[1,"a"]}');
    try {
      jsonToGraphql('not json');
    } catch {
      // expected: parse refusal is under test elsewhere
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
