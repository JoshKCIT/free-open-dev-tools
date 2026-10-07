import { ByteReader } from './bytes';
import { MAX_AXES, MAX_INSTANCES } from './limits';
import { pickName, type NameTable } from './names';
import { tableBytes, type TableEntry } from './sfnt';

export interface Axis {
  tag: string;
  /** The axis values, read exactly from 16.16 fixed point numbers. */
  min: number;
  default: number;
  max: number;
  flags: number;
  nameId: number;
  /** The axis name from the name table, or '' when there is none. */
  name: string;
}

export interface Instance {
  nameId: number;
  name: string;
  coordinates: { tag: string; value: number }[];
  /** The PostScript name identifier, when the instance record has one. */
  postScriptNameId: number | null;
}

export interface VariationResult {
  axes: Axis[];
  instances: Instance[];
  /** How many instances the table states (the list is capped). */
  instanceCount: number;
  notes: string[];
}

/**
 * Reads the fvar table: the variation axes and the named instances. Counts and record sizes are compared with the bytes of
 * the table before anything is read, and the axes (64) and instances (1,000) are capped. Outline changes along the axes (the
 * gvar table) are not read.
 */
export function readVariations(
  bytes: Uint8Array,
  entry: TableEntry | undefined,
  names: NameTable | null,
): VariationResult | null {
  const data = tableBytes(bytes, entry);
  if (!data) return null;
  const notes: string[] = [];
  if (data.length < 16)
    return { axes: [], instances: [], instanceCount: 0, notes: ['The fvar table is too short to hold a header.'] };
  const r = new ByteReader(data);
  const axesAt = r.u16(4);
  const axisCount = r.u16(8);
  const axisSize = r.u16(10);
  const instanceCount = r.u16(12);
  const instanceSize = r.u16(14);

  const axes: Axis[] = [];
  let usable = axisCount;
  if (axisSize < 20) {
    usable = 0;
    if (axisCount > 0) notes.push('The fvar table states an axis record size that is too small, so no axes are read.');
  }
  if (usable > MAX_AXES) {
    notes.push(`The font has ${usable} axes; only the first ${MAX_AXES} are read.`);
    usable = MAX_AXES;
  }
  if (axisSize >= 20 && !r.has(axesAt, usable * axisSize)) {
    usable = Math.max(0, Math.floor((data.length - axesAt) / axisSize));
    notes.push('The fvar table states more axes than it has room for; the ones that fit are read.');
  }
  for (let i = 0; i < usable; i++) {
    const at = axesAt + i * axisSize;
    const nameId = r.u16(at + 18);
    axes.push({
      tag: r.tag(at),
      min: r.fixed(at + 4),
      default: r.fixed(at + 8),
      max: r.fixed(at + 12),
      flags: r.u16(at + 16),
      nameId,
      name: pickName(names, nameId) ?? '',
    });
  }

  const instances: Instance[] = [];
  const coordinatesSize = 4 * axisCount;
  if (axes.length === axisCount && instanceSize >= 4 + coordinatesSize && instanceCount > 0) {
    const instancesAt = axesAt + axisCount * axisSize;
    const room = Math.floor((data.length - instancesAt) / instanceSize);
    const count = Math.min(instanceCount, room, MAX_INSTANCES);
    if (instanceCount > room)
      notes.push('The fvar table states more instances than it has room for; the ones that fit are read.');
    else if (instanceCount > MAX_INSTANCES)
      notes.push(`The font has ${instanceCount} named instances; only the first ${MAX_INSTANCES} are read.`);
    for (let i = 0; i < count; i++) {
      const at = instancesAt + i * instanceSize;
      const nameId = r.u16(at);
      instances.push({
        nameId,
        name: pickName(names, nameId) ?? '',
        coordinates: axes.map((axis, k) => ({ tag: axis.tag, value: r.fixed(at + 4 + 4 * k) })),
        postScriptNameId: instanceSize >= 4 + coordinatesSize + 2 ? r.u16(at + 4 + coordinatesSize) : null,
      });
    }
  } else if (instanceCount > 0 && axes.length !== axisCount) {
    notes.push('Named instances are not read because the axes could not all be read.');
  }
  return { axes, instances, instanceCount, notes };
}
