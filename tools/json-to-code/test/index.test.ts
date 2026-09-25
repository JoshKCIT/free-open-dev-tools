import { it, expect } from 'vitest';
import { jsonToCode } from '../src/index';

it('optional keys, nulls and mixed arrays are simplified as the limits describe', () => {
  const merged = JSON.stringify([{ a: 1 }, { a: 1.5, b: 'x' }]);
  const { output } = jsonToCode(merged, { language: 'typescript', rootName: 'Root' });
  expect(output).toContain('a: number;');
  expect(output).toContain('b?: string;');

  const mixed = JSON.stringify({ mixed: [1, 'x'] });
  const mixedResult = jsonToCode(mixed, { language: 'typescript', rootName: 'Root' });
  expect(mixedResult.output).toContain('mixed: unknown[];');
  expect(mixedResult.warnings.some((w) => w.includes('mixed'))).toBe(true);

  const nullSample = JSON.stringify({ manager: null });
  const nullResult = jsonToCode(nullSample, { language: 'typescript', rootName: 'Root' });
  expect(nullResult.output).toContain('manager: unknown | null;');
});

it('nested objects become named types without name collisions', () => {
  const sample = JSON.stringify({ address: { city: 'x' }, workAddress: { city: 'y' } });
  const { output } = jsonToCode(sample, { language: 'typescript', rootName: 'Root' });
  expect(output).toContain('export interface Address {');
  expect(output).toContain('export interface WorkAddress {');

  const clash = JSON.stringify({ 'a-b': { x: 1 }, a_b: { y: 2 } });
  const { output: clashOutput } = jsonToCode(clash, { language: 'typescript', rootName: 'Root' });
  expect(clashOutput).toContain('export interface AB {');
  expect(clashOutput).toContain('export interface AB2 {');
});
