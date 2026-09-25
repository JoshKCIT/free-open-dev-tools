import { it, expect, vi } from 'vitest';
import { validateJson, SchemaValidatorError } from '../src/index';

/**
 * Fetched with `curl -fsSL https://ajv.js.org/api.html`, 2026-09-25.
 * The error-object shape this package's own `mapError` reads from, quoted
 * verbatim from Ajv's own API Reference page:
 *
 *   "error is an object with the following properties:
 *   interface ErrorObject {
 *     keyword: string // validation keyword.
 *     instancePath: string // JSON Pointer to the location in the data
 *       instance (e.g., "/prop/1/subProp").
 *     schemaPath: string // JSON Pointer to the location of the failing
 *       keyword in the schema
 *     params: object // ...
 *     message?: string // the error message ..."
 *
 * This confirms Assumption A2 from 04-RESEARCH.md directly: `instancePath`
 * is already an RFC 6901 JSON Pointer, so this package passes it straight
 * through as `path` rather than rewriting it.
 *
 * Fetched with `curl -fsSL https://ajv.js.org/options.html`, 2026-09-25.
 * The four options this package sets on every Ajv instance, quoted
 * verbatim from Ajv's own Options page:
 *
 *   "# allErrors: Check all rules collecting all errors. Default is to
 *   return after the first error."
 *   "# logger: Sets the logging method. Default is the global console
 *   object ... Option values: ... false - logging is disabled."
 *   "# strict: By default Ajv executes in strict mode ... Option values:
 *   ... false - ignore all strict mode violations."
 *   "# validateFormats: Format validation. Option values: true (default) -
 *   validate formats ... false - do not validate any format keywords."
 */

const AGE_SCHEMA = '{"type":"object","properties":{"age":{"type":"integer","minimum":0}},"required":["age"]}';

it('a schema requiring an integer age of at least 0 refuses a negative age at /age with keyword minimum', () => {
  const result = validateJson(AGE_SCHEMA, '{"age":-1}');
  expect(result.valid).toBe(false);
  expect(result.errors).toHaveLength(1);
  const [error] = result.errors;
  expect(error?.path).toBe('/age');
  expect(error?.keyword).toBe('minimum');
  expect(typeof error?.message).toBe('string');
});

it('error paths are RFC 6901 pointers with array indexes and escaped keys', () => {
  const schema =
    '{"type":"object","patternProperties":{".*":{"type":"array","items":{"type":"object","properties":{"m~n":{"type":"number"}}}}}}';
  const data = '{"a/b":[{"m~n":"x"}]}';
  const result = validateJson(schema, data);
  expect(result.valid).toBe(false);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.path).toBe('/a~1b/0/m~0n');
});

it('the draft comes from the schema declaration or the chosen draft, and other drafts are refused', () => {
  // Absent $schema, draft left as auto: defaults to 2020-12.
  const noDeclared = validateJson('{"type":"string"}', '"x"');
  expect(noDeclared.draft).toBe('2020-12');

  // Explicit draft-07 declaration is honoured.
  const draft07 = validateJson('{"$schema":"http://json-schema.org/draft-07/schema#","type":"string"}', '"x"');
  expect(draft07.draft).toBe('draft-07');

  // Explicit 2020-12 declaration is honoured, and a 2020-12-only keyword
  // (prefixItems) validates a tuple.
  const tupleSchema =
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"array","prefixItems":[{"type":"string"},{"type":"number"}]}';
  const tupleOk = validateJson(tupleSchema, '["a",1]');
  expect(tupleOk.draft).toBe('2020-12');
  expect(tupleOk.valid).toBe(true);
  const tupleBad = validateJson(tupleSchema, '[1,"a"]');
  expect(tupleBad.valid).toBe(false);

  // The same prefixItems keyword under draft-07 is ignored as unknown, so
  // any array is accepted (strict: false, per D-63's quoted options above).
  const draft07TupleSchema =
    '{"$schema":"http://json-schema.org/draft-07/schema#","type":"array","prefixItems":[{"type":"string"}]}';
  const ignoredUnderDraft07 = validateJson(draft07TupleSchema, '[1,2,3]');
  expect(ignoredUnderDraft07.valid).toBe(true);

  // A schema declaring an unsupported draft (draft-04) is refused, naming it.
  expect(() => validateJson('{"$schema":"http://json-schema.org/draft-04/schema#","type":"string"}', '"x"')).toThrow(
    SchemaValidatorError,
  );
  try {
    validateJson('{"$schema":"http://json-schema.org/draft-04/schema#","type":"string"}', '"x"');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(SchemaValidatorError);
    expect((err as SchemaValidatorError).kind).toBe('draft');
    expect((err as Error).message).toContain('draft-04');
    expect((err as Error).message).toContain('draft-07');
    expect((err as Error).message).toContain('2020-12');
  }

  // An explicit choice conflicting with the schema's own declaration is
  // refused naming both.
  try {
    validateJson('{"$schema":"http://json-schema.org/draft-07/schema#","type":"string"}', '"x"', {
      draft: '2020-12',
    });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(SchemaValidatorError);
    expect((err as SchemaValidatorError).kind).toBe('draft');
    expect((err as Error).message).toContain('2020-12');
    expect((err as Error).message).toContain('draft-07');
  }
});

it('format keywords such as date-time and email are checked when format checking is on', () => {
  const schema = '{"type":"string","format":"email"}';
  const ok = validateJson(schema, '"a@b.com"');
  expect(ok.valid).toBe(true);
  const bad = validateJson(schema, '"not-an-email"');
  expect(bad.valid).toBe(false);
  expect(bad.errors[0]?.keyword).toBe('format');

  // With format checking off, the same invalid email is accepted.
  const off = validateJson(schema, '"not-an-email"', { checkFormats: false });
  expect(off.valid).toBe(true);
});

it('an invalid schema is refused with a readable message before any data is checked', () => {
  try {
    validateJson('{"type":"not-a-real-type"}', '"x"');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(SchemaValidatorError);
    expect((err as SchemaValidatorError).kind).toBe('schema');
    expect(typeof (err as Error).message).toBe('string');
    expect((err as Error).message.length).toBeGreaterThan(0);
  }
});

it('nothing is written to the console while compiling or validating', () => {
  const methods = ['log', 'warn', 'error', 'info', 'debug'] as const;
  const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));

  validateJson(AGE_SCHEMA, '{"age":-1}');
  validateJson(AGE_SCHEMA, '{"age":5}');
  try {
    validateJson('{"type":"not-a-real-type"}', '"x"');
  } catch {
    // expected -- still must not have logged anything on the way there
  }
  try {
    validateJson('not json', '"x"');
  } catch {
    // expected
  }

  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  for (const spy of spies) spy.mockRestore();
});

it('RFC 8259 invalid JSON in the schema or the data box is refused naming which box and where', () => {
  try {
    validateJson('{not json', '"x"');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(SchemaValidatorError);
    expect((err as SchemaValidatorError).kind).toBe('schema-json');
    expect((err as SchemaValidatorError).line).toBeDefined();
    expect((err as SchemaValidatorError).column).toBeDefined();
  }
  try {
    validateJson('{"type":"string"}', 'not json');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(SchemaValidatorError);
    expect((err as SchemaValidatorError).kind).toBe('data-json');
  }
});

it('a required property named like a built-in object member (constructor, toString) is missing from an empty object', () => {
  const schema = '{"type":"object","required":["constructor","toString"]}';
  expect(validateJson(schema, '{}').valid).toBe(false);
  expect(validateJson(schema, '{"constructor":1,"toString":2}').valid).toBe(true);
});
