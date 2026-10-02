import { it, expect } from 'vitest';
import { readYamlValue, YamlValueError } from '../src/yaml-value';

// YAML 1.2.2 (https://yaml.org/spec/1.2.2/):
//   section 3.2.2.2 (a mapping's keys are unique; two keys are the same when their values are equal, so the
//   integer 1 and the string "1" are different keys in YAML but the same key once a JSON object names them),
//   section 6.8.1 (the %YAML directive names the version a document is written in),
//   section 3.2.2.1 / 7.1 (an alias node stands for the node its anchor names, so an anchored list used 99 times is
//   99 more lists). The YAML 1.1 merge key type (https://yaml.org/type/merge.html) is the key `<<`.

function refusal(text: string): YamlValueError {
  try {
    readYamlValue(text, { documents: 'one' });
  } catch (err) {
    if (err instanceof YamlValueError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

it('a merge key is read as an ordinary key named << and a warning says nothing was merged', () => {
  const read = readYamlValue('base: &b {x: 1}\nchild:\n  <<: *b\n  y: 2\n', { documents: 'one' });
  expect(read.value).toEqual({ base: { x: 1 }, child: { '<<': { x: 1 }, y: 2 } });
  expect(read.warnings.join(' ')).toContain('<<');
  expect(read.warnings.join(' ')).toContain('merge');
  // No warning when no key is <<.
  expect(readYamlValue('a: 1\n', { documents: 'one' }).warnings).toEqual([]);
});

it('a %YAML 1.1 directive is reported, because yes becomes true and 0777 becomes 511 under it', () => {
  const read = readYamlValue('%YAML 1.1\n---\na: yes\nb: 0777\n', { documents: 'one' });
  expect(read.value).toEqual({ a: true, b: 511 });
  expect(read.warnings.join(' ')).toContain('%YAML 1.1');
  // The 1.2 directive changes nothing and is not reported.
  expect(readYamlValue('%YAML 1.2\n---\na: yes\n', { documents: 'one' }).warnings).toEqual([]);
});

it('two keys that are the same text once turned into names are refused with the line and column of the second', () => {
  const same = refusal('1: a\n"1": b\n');
  expect(same.message).toContain('"1"');
  expect(same.line).toBe(2);
  expect(same.column).toBe(1);
  expect(refusal('a:\n  true: x\n  "true": y\n').line).toBe(3);
  expect(refusal('null: x\n"": y\n').line).toBe(2);
  expect(refusal('1.0: x\n1: y\n').line).toBe(2);
  expect(refusal('- ok: 1\n- 5: a\n  "5": b\n').line).toBe(3);
});

it('keys that differ once turned into names, and the same key in two different mappings, are not refused', () => {
  expect(readYamlValue('1: a\n2: b\n"3": c\n', { documents: 'one' }).value).toEqual({ '1': 'a', '2': 'b', '3': 'c' });
  expect(readYamlValue('a:\n  1: x\nb:\n  "1": y\n', { documents: 'one' }).value).toEqual({
    a: { '1': 'x' },
    b: { '1': 'y' },
  });
});
