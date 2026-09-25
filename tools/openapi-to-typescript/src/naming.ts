/**
 * Turns an OpenAPI schema name or operation id into a valid, unique
 * TypeScript identifier. Words are split on any run of non-alphanumeric
 * characters (so "Order Item" and "order-item" both split into the same
 * two words), PascalCased, and a leading digit gets an "N" prefix (TypeScript
 * type names never start with a digit). Collisions across an entire
 * generation pass are suffixed with a number, keyed by call order, so two
 * different source names that happen to produce the same candidate still
 * end up as two distinct, valid names.
 */

const TS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function wordsFromKey(key: string): string[] {
  return key.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

function capitalizeWord(word: string): string {
  const digits = word.match(/^[0-9]*/)![0]!;
  const rest = word.slice(digits.length);
  if (rest.length === 0) return word;
  return digits + rest[0]!.toUpperCase() + rest.slice(1);
}

/** PascalCase, falling back to `fallback` for an empty or all-punctuation key. */
export function pascalCase(key: string, fallback: string): string {
  const words = wordsFromKey(key);
  if (words.length === 0) return fallback;
  let name = words.map(capitalizeWord).join('');
  if (name === '') return fallback;
  if (/^[0-9]/.test(name)) name = `N${name}`;
  return name;
}

/** A valid TypeScript property name: the key as written when it is already an IdentifierName, else a quoted string literal. */
export function typescriptPropertyName(key: string): string {
  return TS_IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/**
 * Assigns a unique PascalCase TypeScript type name to every key, in order.
 * A candidate that collides with one already produced for an earlier key
 * gets a number appended (2, 3, ...) until it is unique -- this is how two
 * different source names that PascalCase to the same candidate ("Order
 * Item" and "order-item" both become "OrderItem") still end up distinct.
 */
export function assignTypeNames(keys: string[], fallback = 'Schema'): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const key of keys) {
    const base = pascalCase(key, fallback);
    let candidate = base;
    let i = 2;
    while (used.has(candidate)) {
      candidate = `${base}${i}`;
      i++;
    }
    used.add(candidate);
    result.set(key, candidate);
  }
  return result;
}
