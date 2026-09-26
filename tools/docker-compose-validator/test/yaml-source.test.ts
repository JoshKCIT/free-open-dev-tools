import { it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import {
  readYaml,
  locatePointer,
  findingsFromAjvErrors,
  pointerToPath,
  YamlSourceError,
  MAX_YAML_BYTES,
} from '../src/yaml-source';

it('a YAML syntax error is reported with its line and column', () => {
  try {
    readYaml('services:\n  web:\n    - broken: [\n');
    expect.unreachable('expected a YamlSourceError');
  } catch (err) {
    expect(err).toBeInstanceOf(YamlSourceError);
    const e = err as YamlSourceError;
    expect(e.line).toBeTypeOf('number');
    expect(e.column).toBeTypeOf('number');
  }
});

it('a duplicate key is reported at the line of its second occurrence', () => {
  try {
    readYaml('a: 1\nb: 2\na: 3\n');
    expect.unreachable('expected a YamlSourceError');
  } catch (err) {
    expect(err).toBeInstanceOf(YamlSourceError);
    expect((err as YamlSourceError).line).toBe(3);
  }
});

it('an alias that expands past the limit is refused rather than expanded', () => {
  let source = 'a0: &a0 ["x"]\n';
  for (let i = 1; i <= 10; i++) source += `a${i}: &a${i} [*a${i - 1}, *a${i - 1}]\n`;
  expect(() => readYaml(source)).toThrowError(YamlSourceError);
});

it('a document nested more than 512 levels deep is refused', () => {
  const source = '['.repeat(600) + '1' + ']'.repeat(600);
  expect(() => readYaml(source)).toThrowError(YamlSourceError);
});

it('an input over the size limit is refused before parsing', () => {
  const source = 'a: "' + 'x'.repeat(MAX_YAML_BYTES + 10) + '"';
  try {
    readYaml(source);
    expect.unreachable('expected a YamlSourceError');
  } catch (err) {
    expect(err).toBeInstanceOf(YamlSourceError);
    expect((err as YamlSourceError).message).toContain('5 MB');
  }
});

it('an Ajv instance path is located at the line and column of its YAML node', () => {
  const source = readYaml('a:\n  b:\n    c: 1\n');
  const pos = locatePointer(source, 0, '/a/b/c');
  expect(pos.line).toBe(3);
});

it('an unknown key is located at the key itself and a missing key at its parent mapping', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  };
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  const okKeySource = readYaml('name: "a"\nbogus: 1\n');
  const notOk = validate(okKeySource.documents[0]!.value);
  expect(notOk).toBe(false);
  const findings = findingsFromAjvErrors(okKeySource, 0, validate.errors ?? []);
  const additionalPropertyFinding = findings.find((f) => f.keyword === 'additionalProperties');
  expect(additionalPropertyFinding).toBeDefined();
  expect(additionalPropertyFinding!.line).toBe(2);
  expect(additionalPropertyFinding!.message).toContain('bogus');

  const missingKeySource = readYaml('bogus: 1\n');
  validate(missingKeySource.documents[0]!.value);
  const requiredFindings = findingsFromAjvErrors(missingKeySource, 0, validate.errors ?? []);
  const requiredFinding = requiredFindings.find((f) => f.keyword === 'required');
  expect(requiredFinding).toBeDefined();
  expect(requiredFinding!.line).toBe(1);
  expect(requiredFinding!.message).toContain('name');
});

it('errors from alternative branches of the same node are merged into one finding', () => {
  const schema = {
    oneOf: [{ type: 'string' }, { type: 'number' }],
  };
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const source = readYaml('true\n');
  validate(source.documents[0]!.value);
  const findings = findingsFromAjvErrors(source, 0, validate.errors ?? []);
  expect(findings.length).toBe(1);
  expect(findings[0]!.keyword).toBe('oneOf');
});

it('pointerToPath renders a dotted path with bracket indexes and quotes special keys', () => {
  expect(pointerToPath('/services/web/ports/0')).toBe('services.web.ports[0]');
  expect(pointerToPath('/a.b')).toBe('"a.b"');
  expect(pointerToPath('')).toBe('');
});
