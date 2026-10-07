import type { ModuleData } from './module';

/** The feature names, in the order they are listed. */
export const FEATURE_ORDER: readonly string[] = [
  'SIMD (v128 values)',
  'reference types',
  'garbage collection types',
  'exception handling (tags)',
  '64-bit memory or table limits',
  'multiple memories',
  'shared memory (threads proposal)',
  'extended constants',
];

/**
 * The features a module uses, worked out from what its sections hold: a v128 value in a type, global, table or constant
 * expression; an externref or exnref, a table that is not a lone funcref table, or a table initialiser; struct, array, sub or
 * recursive group types and references to a type index; any tag; 64-bit memory or table limits; more than one memory; the
 * shared flag on a memory or table; and the extended constant instructions. Function bodies are not decoded, so a feature
 * that only instructions inside a body use is not listed.
 */
export function usedFeatures(data: Pick<ModuleData, 'marks' | 'tables' | 'memories' | 'tags'>): string[] {
  const marks = new Set(data.marks);
  if (data.tables.count > 1) marks.add('reference types');
  if (data.memories.count > 1) marks.add('multiple memories');
  if (data.tags.count > 0) marks.add('exception handling (tags)');
  return FEATURE_ORDER.filter((feature) => marks.has(feature));
}
