import { it, expect } from 'vitest';
import { setOwn, hasOwn, getOwn } from '../src/own-property';

it('setOwn keeps __proto__ and constructor as own keys and Object.prototype gains nothing', () => {
  const target: Record<string, unknown> = {};
  setOwn(target, '__proto__', 'evil');
  setOwn(target, 'constructor', 'also evil');

  expect(hasOwn(target, '__proto__')).toBe(true);
  expect(hasOwn(target, 'constructor')).toBe(true);
  expect(getOwn(target, '__proto__')).toBe('evil');
  expect(getOwn(target, 'constructor')).toBe('also evil');
  expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
  expect(Object.prototype as unknown as Record<string, unknown>).not.toHaveProperty('evil');
  expect(Object.keys(target).sort()).toEqual(['__proto__', 'constructor']);
});

it('hasOwn is false for an inherited property and true only for an own one', () => {
  const target: Record<string, unknown> = {};
  setOwn(target, 'own', 1);
  expect(hasOwn(target, 'own')).toBe(true);
  expect(hasOwn(target, 'toString')).toBe(false);
});

it('getOwn returns undefined for a key that was never set', () => {
  const target: Record<string, unknown> = {};
  expect(getOwn(target, 'missing')).toBeUndefined();
});
