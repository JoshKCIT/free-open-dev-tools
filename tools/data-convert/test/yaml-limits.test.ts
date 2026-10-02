import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertData, DataConvertError } from '../src/index';

// YAML 1.2.2 (https://yaml.org/spec/1.2.2/) section 7.1: an alias node stands for the node its anchor names, so an
// anchored list used 99 times is 99 more lists. A converter that writes JSON, XML or CSV has to write every copy, so
// a document whose aliases expand past 2,000,000 values is refused instead of being expanded.

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

function bombText(): string {
  const items = Array.from({ length: 100_000 }, (_, i) => String(i)).join(',');
  const aliases = Array.from({ length: 99 }, (_, i) => `c${i}: *b`).join('\n');
  return `big: &b [${items}]\n${aliases}\n`;
}

function refusal(text: string, to: 'json' | 'yaml' | 'xml' | 'csv'): DataConvertError {
  try {
    convertData(text, { from: 'yaml', to });
  } catch (err) {
    if (err instanceof DataConvertError) return err;
    throw err;
  }
  throw new Error(`expected a refusal for ${to}`);
}

it('an anchor of 100,000 items used 99 times is refused in every direction instead of being expanded to 9.9 million values', () => {
  for (const to of ['json', 'yaml', 'xml'] as const) {
    expect(refusal(bombText(), to).message, to).toContain('more than 2,000,000 values');
  }
}, 60_000);

it('a document with a few aliases and a modest expansion still converts, with the alias warning', () => {
  const items = Array.from({ length: 1_000 }, (_, i) => String(i)).join(',');
  const aliases = Array.from({ length: 20 }, (_, i) => `c${i}: *b`).join('\n');
  const out = convertData(`big: &b [${items}]\n${aliases}\n`, { from: 'yaml', to: 'json' });
  expect(Object.keys(JSON.parse(out.output) as object)).toHaveLength(21);
  expect(out.warnings.join(' ')).toContain('anchor');
}, 60_000);
