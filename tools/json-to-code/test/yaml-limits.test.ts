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

it('an anchor of 100,000 items used 99 times is refused for the values it expands to, not read into 9.9 million values', () => {
  const items = Array.from({ length: 100_000 }, (_, i) => String(i)).join(',');
  const aliases = Array.from({ length: 99 }, (_, i) => `c${i}: *b`).join('\n');
  const err = refusal(`big: &b [${items}]\n${aliases}\n`);
  expect(err.message).toContain('more than 2,000,000 values');
}, 60_000);

it('a document with a few aliases and a modest expansion is still read, with the alias warning', () => {
  const items = Array.from({ length: 1_000 }, (_, i) => String(i)).join(',');
  const aliases = Array.from({ length: 20 }, (_, i) => `c${i}: *b`).join('\n');
  const read = readYamlValue(`big: &b [${items}]\n${aliases}\n`, { documents: 'one' });
  expect(Object.keys(read.value as object)).toHaveLength(21);
  expect(read.warnings.join(' ')).toContain('anchor');
}, 60_000);
