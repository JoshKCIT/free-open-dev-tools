/**
 * Prototype-pollution-safe reads and writes for an object built one
 * input-derived key at a time.
 *
 * A plain `obj[key] = value` loop over untrusted keys lets a key named
 * `__proto__` replace the object's prototype instead of becoming an
 * ordinary property, and a key named `constructor` can shadow the wrong
 * thing depending on the engine. `Object.defineProperty` always creates an
 * own, enumerable, writable property no matter what the key's text is,
 * which is what makes it the only shape used here.
 */

export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

export function hasOwn(target: object, key: string): boolean {
  return Object.hasOwn(target, key);
}

export function getOwn(target: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(target, key) ? target[key] : undefined;
}
