/**
 * Oracle tests: the generated source is evaluated with Zod supplied (test
 * code only, never in the shipped package) and checked with `safeParse`.
 */
import { it, expect } from 'vitest';
import { z } from 'zod';
import { jsonToZod, JsonToZodError } from '../src/index';

function evalOutput(output: string, exportName = 'schema'): z.ZodTypeAny {
  const withoutImport = output.replace(/^import \{ z \} from 'zod';\n\n?/, '');
  const withoutExport = withoutImport.replace(/^export const/m, 'const');
  const factory = new Function('z', `${withoutExport}\nreturn ${exportName};`);
  return factory(z) as z.ZodTypeAny;
}

it('generated schema from a sample accepts that sample under Zod 4', () => {
  const sample = '{"id":1,"name":"Ada","tags":["x"]}';
  const { output } = jsonToZod(sample, { source: 'sample', exportName: 'schema' });
  const schema = evalOutput(output);
  expect(schema.safeParse(JSON.parse(sample)).success).toBe(true);
});

it('generated schema rejects a value of the wrong type', () => {
  const sample = '{"id":1,"name":"Ada"}';
  const { output } = jsonToZod(sample, { source: 'sample', exportName: 'schema' });
  const schema = evalOutput(output);
  expect(schema.safeParse({ id: 'not-a-number', name: 'Ada' }).success).toBe(false);
});

it('JSON Schema draft-07 and 2020-12 keywords in the supported subset convert to the matching Zod calls', () => {
  const schemaDoc = {
    type: 'object',
    properties: { id: { type: 'integer' }, name: { type: 'string' } },
    required: ['id'],
  };
  const { output } = jsonToZod(JSON.stringify(schemaDoc), { source: 'schema', exportName: 'schema' });
  const schema = evalOutput(output);
  expect(schema.safeParse({ id: 1, name: 'Ada' }).success).toBe(true);
  expect(schema.safeParse({ id: 1 }).success).toBe(true);
  expect(schema.safeParse({ name: 'Ada' }).success).toBe(false);
  expect(schema.safeParse({ id: 'nope' }).success).toBe(false);
});

it('keywords outside the supported subset are listed with RFC 6901 paths, not guessed', () => {
  const schemaDoc = {
    type: 'object',
    properties: { a: { type: 'string' } },
    if: { properties: { a: { const: 'x' } } },
    then: { required: ['a'] },
  };
  const { warnings } = jsonToZod(JSON.stringify(schemaDoc), { source: 'schema', exportName: 'schema' });
  expect(warnings.some((w) => w.includes('"if"') && w.includes('at ""'))).toBe(true);
  expect(warnings.some((w) => w.includes('"then"') && w.includes('at ""'))).toBe(true);
});

it('a recursive reference is refused with its pointer named', () => {
  const schemaDoc = {
    $ref: '#/$defs/Node',
    $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } },
  };
  const text = JSON.stringify(schemaDoc);
  expect(() => jsonToZod(text, { source: 'schema', exportName: 'schema' })).toThrow(JsonToZodError);
  try {
    jsonToZod(text, { source: 'schema', exportName: 'schema' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(JsonToZodError);
    expect((err as JsonToZodError).message).toContain('/$defs/Node');
  }
});
