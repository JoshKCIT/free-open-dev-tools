import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertData, DataConvertError, type DataFormat } from '../src/index';

// YAML 1.2.2 (https://yaml.org/spec/1.2.2/):
//   section 3.2.2.2 (two keys are the same when their values are equal, so the integer 1 and the string "1" are two
//   keys in YAML but one name in JSON, XML, CSV and TOML, which name a key with text),
//   section 6.8.1 (the %YAML directive names the version a document is written in; 1.1 reads yes as true and 0777 as
//   octal). The YAML 1.1 merge key type (https://yaml.org/type/merge.html) is the key `<<`; YAML 1.2 dropped it.

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(console.log).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

function refusal(text: string, to: DataFormat): DataConvertError {
  try {
    convertData(text, { from: 'yaml', to });
  } catch (err) {
    if (err instanceof DataConvertError) return err;
    throw err;
  }
  throw new Error(`expected a refusal for ${to}`);
}

it('two YAML keys that are the same name as text are refused with the line and column of the second, in every other format', () => {
  for (const to of ['json', 'xml', 'toml'] as const) {
    const err = refusal('a: 1\n1: a\n"1": b\n', to);
    expect(err.message, to).toContain('"1"');
    expect(err.line, to).toBe(3);
    expect(err.column, to).toBe(1);
  }
  expect(refusal('a:\n  true: x\n  "true": y\n', 'json').line).toBe(3);
  expect(refusal('null: x\n"": y\n', 'json').line).toBe(2);
  expect(refusal('1.0: x\n1: y\n', 'json').line).toBe(2);
});

it('keys that differ as text, and one key in two mappings, convert as before, and YAML to YAML keeps keys that only look alike', () => {
  expect(JSON.parse(convertData('1: a\n2: b\n"3": c\n', { from: 'yaml', to: 'json' }).output)).toEqual({
    '1': 'a',
    '2': 'b',
    '3': 'c',
  });
  expect(JSON.parse(convertData('a:\n  1: x\nb:\n  "1": y\n', { from: 'yaml', to: 'json' }).output)).toEqual({
    a: { '1': 'x' },
    b: { '1': 'y' },
  });
  // Written back as YAML nothing collapses, so nothing is refused.
  expect(convertData('1: a\n"1": b\n', { from: 'yaml', to: 'yaml' }).output).toBe('1: a\n"1": b\n');
});

it('a merge key is read as an ordinary key named << and a warning says nothing was merged', () => {
  const out = convertData('base: &b {x: 1}\nchild:\n  <<: *b\n  y: 2\n', { from: 'yaml', to: 'json' });
  expect(JSON.parse(out.output)).toEqual({ base: { x: 1 }, child: { '<<': { x: 1 }, y: 2 } });
  expect(out.warnings.join(' ')).toContain('merge');
  expect(out.warnings.join(' ')).toContain('<<');
  expect(convertData('a: 1\n', { from: 'yaml', to: 'json' }).warnings).toEqual([]);
});

it('a %YAML 1.1 directive is reported, because yes becomes true and 0777 becomes 511 under it', () => {
  const out = convertData('%YAML 1.1\n---\na: yes\nb: 0777\n', { from: 'yaml', to: 'json' });
  expect(JSON.parse(out.output)).toEqual({ a: true, b: 511 });
  expect(out.warnings.join(' ')).toContain('%YAML 1.1');
  expect(convertData('%YAML 1.2\n---\na: yes\n', { from: 'yaml', to: 'json' }).warnings).toEqual([]);
});
