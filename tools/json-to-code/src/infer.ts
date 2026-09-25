/**
 * Builds one language-independent model from a sample JSON value, shared by
 * every emitter in this package. An object met at any one location -- the
 * root, a field of another object, or an element of an array -- is a named
 * type of its own; array elements at the same location are merged into one
 * item type; a key missing from some of the merged instances is optional; a
 * value that was ever literally `null` at a location makes that location
 * nullable; a location that only ever held integers stays an integer, mixed
 * with any non-integer number it widens to a floating number, and any other
 * mix of JSON value kinds (including a mixed array) widens to the any-JSON
 * type, with a warning naming the key. An empty array has no elements to
 * learn a shape from, so its item type is always the any-JSON type.
 *
 * Two different keys that happen to produce identical field shapes still get
 * two separate named types: nothing here compares one object type against
 * another, only against the model's own name registry.
 */

export type FieldKind = 'string' | 'integer' | 'float' | 'boolean' | 'any' | 'array' | 'ref';

export interface FieldType {
  kind: FieldKind;
  /** Set on the field this type belongs to whenever `null` was observed there, in addition to this type. */
  nullable: boolean;
  /** Present only when `kind` is `'array'`: the type of its elements. */
  item?: FieldType;
  /** Present only when `kind` is `'ref'`: the name of the object type in `InferredModel.objects`. */
  name?: string;
}

export interface ModelField {
  /** The original JSON key, unmodified -- every emitter is responsible for turning this into its own language's identifier. */
  key: string;
  type: FieldType;
  /** True when this key was missing from at least one of the merged instances at this location. */
  optional: boolean;
}

export interface ObjectType {
  /** A generic, already-unique PascalCase name; each emitter escapes or suffixes it for its own language's rules. */
  name: string;
  fields: ModelField[];
}

export interface InferredModel {
  rootName: string;
  root: FieldType;
  /** Every named object type this sample produced, in the order first encountered. */
  objects: ObjectType[];
  /** One entry per key whose value kinds were mixed beyond the integer/float rule and were widened to the any-JSON type. */
  warnings: string[];
}

function wordsFromKey(key: string): string[] {
  return key.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

function capitalizeWord(word: string): string {
  const digits = word.match(/^[0-9]*/)![0]!;
  const rest = word.slice(digits.length);
  if (rest.length === 0) return word;
  return digits + rest[0]!.toUpperCase() + rest.slice(1);
}

/** Turns a JSON key into a generic PascalCase type-name candidate. Falls back to `fallback` for an empty or all-punctuation key. */
export function sanitizeTypeName(key: string, fallback: string): string {
  const words = wordsFromKey(key);
  if (words.length === 0) return fallback;
  let name = words.map(capitalizeWord).join('');
  if (name === '') return fallback;
  if (/^[0-9]/.test(name)) name = 'N' + name;
  return name;
}

type Kind = 'string' | 'integer' | 'float' | 'boolean' | 'null' | 'object' | 'array';

function kindOf(value: unknown): Kind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string') return 'string';
  if (t === 'boolean') return 'boolean';
  if (t === 'number') return Number.isInteger(value) ? 'integer' : 'float';
  return 'object';
}

export function inferModel(value: unknown, rootName = 'Root'): InferredModel {
  const objects: ObjectType[] = [];
  const usedNames = new Set<string>();
  const warnings: string[] = [];
  const safeRootName = sanitizeTypeName(rootName, 'Root');

  function uniqueName(base: string): string {
    let name = base;
    let i = 2;
    while (usedNames.has(name)) {
      name = `${base}${i}`;
      i++;
    }
    usedNames.add(name);
    return name;
  }

  function resolve(values: unknown[], nameHint: string, warnKey: string): FieldType {
    const nullable = values.some((v) => v === null);
    const kinds = new Set(values.map(kindOf));
    const nonNull = [...kinds].filter((k) => k !== 'null');
    const nonNullSet = new Set(nonNull);

    if (nonNullSet.size === 0) return { kind: 'any', nullable: true };

    if (nonNullSet.size === 1) {
      const only = nonNull[0]!;
      if (only === 'integer') return { kind: 'integer', nullable };
      if (only === 'float') return { kind: 'float', nullable };
      if (only === 'string') return { kind: 'string', nullable };
      if (only === 'boolean') return { kind: 'boolean', nullable };
      if (only === 'object') {
        const objs = values.filter((v) => kindOf(v) === 'object') as Record<string, unknown>[];
        const ref = resolveObject(objs, nameHint);
        return { ...ref, nullable };
      }
      const arrs = values.filter((v) => kindOf(v) === 'array') as unknown[][];
      const arr = resolveArray(arrs, nameHint, warnKey);
      return { ...arr, nullable };
    }

    if (nonNullSet.size === 2 && nonNullSet.has('integer') && nonNullSet.has('float')) {
      return { kind: 'float', nullable };
    }

    warnings.push(`"${warnKey}" mixes incompatible JSON value types and was widened to the any-JSON type.`);
    return { kind: 'any', nullable };
  }

  function resolveObject(objs: Record<string, unknown>[], nameHint: string): FieldType {
    const typeName = uniqueName(nameHint);
    const objType: ObjectType = { name: typeName, fields: [] };
    objects.push(objType);

    const keyOrder: string[] = [];
    const seen = new Set<string>();
    for (const o of objs) {
      for (const k of Object.keys(o)) {
        if (!seen.has(k)) {
          seen.add(k);
          keyOrder.push(k);
        }
      }
    }

    for (const key of keyOrder) {
      const present = objs.filter((o) => Object.hasOwn(o, key));
      const optional = present.length < objs.length;
      const subValues = present.map((o) => o[key]);
      const childHint = sanitizeTypeName(key, 'Field');
      const fieldType = resolve(subValues, childHint, key);
      objType.fields.push({ key, type: fieldType, optional });
    }

    return { kind: 'ref', name: typeName, nullable: false };
  }

  function resolveArray(arrs: unknown[][], nameHint: string, warnKey: string): FieldType {
    const elements = arrs.flat();
    if (elements.length === 0) {
      return { kind: 'array', nullable: false, item: { kind: 'any', nullable: false } };
    }
    const itemType = resolve(elements, `${nameHint}Item`, warnKey);
    return { kind: 'array', nullable: false, item: itemType };
  }

  const root = resolve([value], safeRootName, safeRootName);
  return { rootName: safeRootName, root, objects, warnings };
}
