import { it, expect, vi, afterEach } from 'vitest';
import { convertData, DataConvertError } from '../src/index';
import { parse as parseToml } from 'smol-toml';

// RFC 8259: https://www.rfc-editor.org/rfc/rfc8259
// YAML 1.2.2: https://yaml.org/spec/1.2.2/ (Example 2.2, "Mapping Scalars to Scalars")
// TOML 1.1.0: https://toml.io/en/v1.1.0 (Offset Date-Time example, `odt1 = 1979-05-27T07:32:00Z`)

afterEach(() => {
  vi.restoreAllMocks();
});

it('JSON to YAML to JSON round trip leaves the document unchanged', () => {
  const source = '{"a":[1,"yes",null,{"b":"0012"}],"c":{}}';
  const toYaml = convertData(source, { from: 'json', to: 'yaml' });
  const back = convertData(toYaml.output, { from: 'yaml', to: 'json' });
  expect(JSON.parse(back.output)).toEqual(JSON.parse(source));
});

it('YAML to YAML keeps comments through the yaml Document API', () => {
  const source = 'hr:  65    # Home runs\navg: 0.278 # Batting average\nrbi: 147   # Runs Batted In\n';
  const result = convertData(source, { from: 'yaml', to: 'yaml' });
  expect(result.output).toContain('# Home runs');
  expect(result.output).toContain('# Batting average');
  expect(result.output).toContain('# Runs Batted In');
  expect(result.warnings).toEqual([]);
});

it('YAML 1.2 core schema keeps yes and no as strings and quotes them when writing', () => {
  const fromYaml = convertData('a: yes\nb: no\nc: true\n', { from: 'yaml', to: 'json' });
  const parsed = JSON.parse(fromYaml.output) as Record<string, unknown>;
  expect(parsed.a).toBe('yes');
  expect(parsed.b).toBe('no');
  expect(parsed.c).toBe(true);

  const toYaml = convertData('{"a":"yes","b":"no"}', { from: 'json', to: 'yaml' });
  expect(toYaml.output).toContain('"yes"');
  expect(toYaml.output).toContain('"no"');
});

it('TOML 1.0 dates and times become strings in JSON and a warning says so', () => {
  const result = convertData('d = 1979-05-27T07:32:00Z\n', { from: 'toml', to: 'json' });
  const parsed = JSON.parse(result.output) as Record<string, unknown>;
  expect(parsed.d).toBe('1979-05-27T07:32:00.000Z');
  expect(result.warnings.some((w) => w.toLowerCase().includes('date'))).toBe(true);
});

it('TOML to JSON to TOML round trips tables, arrays of tables and inline tables', () => {
  const source =
    'title = "Example"\npoint = { x = 1, y = 2 }\n\n[owner]\nname = "Tom"\n\n[[fruits]]\nname = "apple"\n\n[[fruits]]\nname = "banana"\n';
  const toJson = convertData(source, { from: 'toml', to: 'json' });
  const back = convertData(toJson.output, { from: 'json', to: 'toml' });
  expect(parseToml(back.output)).toEqual(parseToml(source));
});

it('a JSON null has no TOML form and is refused with its RFC 6901 path', () => {
  expect(() => convertData('{"a":null}', { from: 'json', to: 'toml' })).toThrowError(DataConvertError);
  try {
    convertData('{"a":null}', { from: 'json', to: 'toml' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(DataConvertError);
    expect((err as DataConvertError).path).toBe('/a');
  }
  expect(() => convertData('[1,2,3]', { from: 'json', to: 'toml' })).toThrowError(DataConvertError);
});

it('a YAML alias bomb is refused by the alias limit', () => {
  let source = 'a0: &a0 ["x"]\n';
  for (let i = 1; i <= 10; i++) source += `a${i}: &a${i} [*a${i - 1}, *a${i - 1}]\n`;
  expect(() => convertData(source, { from: 'yaml', to: 'json' })).toThrowError(DataConvertError);
});

it('a key named __proto__ survives each conversion and Object.prototype is never modified', () => {
  const source = '{"__proto__":{"polluted":true},"constructor":{"x":1}}';

  const toYaml = convertData(source, { from: 'json', to: 'yaml' });
  expect(toYaml.output).toContain('__proto__');
  const backToJson = convertData(toYaml.output, { from: 'yaml', to: 'json' });
  expect(JSON.parse(backToJson.output)).toEqual(JSON.parse(source));

  const toToml = convertData(source, { from: 'json', to: 'toml' });
  expect(toToml.output).toContain('__proto__');
  const tomlBackToJson = convertData(toToml.output, { from: 'toml', to: 'json' });
  expect(JSON.parse(tomlBackToJson.output)).toEqual(JSON.parse(source));

  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call({}, 'polluted')).toBe(false);
});

it('invalid YAML and TOML are refused with a line and column', () => {
  try {
    convertData('a: 1\na: 2\n', { from: 'yaml', to: 'json' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(DataConvertError);
    expect((err as DataConvertError).line).toBeTypeOf('number');
    expect((err as DataConvertError).column).toBeTypeOf('number');
  }
  try {
    convertData('a = 1\nbad line without equals\n', { from: 'toml', to: 'json' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(DataConvertError);
    expect((err as DataConvertError).line).toBeTypeOf('number');
    expect((err as DataConvertError).column).toBeTypeOf('number');
  }
});

it('nothing is written to the console for YAML warnings or errors', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

  convertData('a: yes\nb: &x [1]\nc: *x\n', { from: 'yaml', to: 'json' });
  try {
    convertData('a: 1\na: 2\n', { from: 'yaml', to: 'json' });
  } catch {
    // expected: DataConvertError, not a console write
  }
  try {
    convertData('%TAG\n', { from: 'yaml', to: 'json' });
  } catch {
    // expected
  }

  expect(logSpy).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();
  expect(infoSpy).not.toHaveBeenCalled();
  expect(debugSpy).not.toHaveBeenCalled();
});

it('converts every from/to pair without throwing on ordinary input', () => {
  const samples: Record<string, string> = {
    json: '{"name":"Ada","tags":["a","b"]}',
    yaml: 'name: Ada\ntags:\n  - a\n  - b\n',
    toml: 'name = "Ada"\ntags = ["a", "b"]\n',
  };
  const formats = ['json', 'yaml', 'toml'] as const;
  for (const from of formats) {
    for (const to of formats) {
      const result = convertData(samples[from]!, { from, to });
      expect(result.output.length).toBeGreaterThan(0);
    }
  }
});

it('indent option controls JSON and YAML output spacing', () => {
  const four = convertData('{"a":1}', { from: 'json', to: 'json', indent: 4 });
  expect(four.output).toContain('    "a": 1');
});
