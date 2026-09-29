/**
 * The 24 units this tool converts between (IEC 80000-13 binary prefixes,
 * the SI Brochure's decimal prefixes), each carried as an exact bit count
 * so every conversion is a single exact-rational multiply and divide.
 */

export type UnitSystem = 'SI' | 'IEC' | 'none';
export type UnitKind = 'bit' | 'byte';

export interface UnitDef {
  id: string;
  symbol: string;
  name: string;
  /** How many bits one whole unit is, exactly. */
  bits: bigint;
  system: UnitSystem;
  kind: UnitKind;
}

const KI = 1024n;
const MI = KI * KI;
const GI = MI * KI;
const TI = GI * KI;
const PI = TI * KI;
const EI = PI * KI;

const K = 1_000n;
const M = K * K;
const G = M * K;
const T = G * K;
const P = T * K;
const E = P * K;

export const UNITS: readonly UnitDef[] = [
  { id: 'bit', symbol: 'bit', name: 'bit', bits: 1n, system: 'none', kind: 'bit' },
  { id: 'kbit', symbol: 'kbit', name: 'kilobit (10^3 bit)', bits: K, system: 'SI', kind: 'bit' },
  { id: 'Mbit', symbol: 'Mbit', name: 'megabit (10^6 bit)', bits: M, system: 'SI', kind: 'bit' },
  { id: 'Gbit', symbol: 'Gbit', name: 'gigabit (10^9 bit)', bits: G, system: 'SI', kind: 'bit' },
  { id: 'Tbit', symbol: 'Tbit', name: 'terabit (10^12 bit)', bits: T, system: 'SI', kind: 'bit' },
  { id: 'Pbit', symbol: 'Pbit', name: 'petabit (10^15 bit)', bits: P, system: 'SI', kind: 'bit' },
  { id: 'Kibit', symbol: 'Kibit', name: 'kibibit (2^10 bit)', bits: KI, system: 'IEC', kind: 'bit' },
  { id: 'Mibit', symbol: 'Mibit', name: 'mebibit (2^20 bit)', bits: MI, system: 'IEC', kind: 'bit' },
  { id: 'Gibit', symbol: 'Gibit', name: 'gibibit (2^30 bit)', bits: GI, system: 'IEC', kind: 'bit' },
  { id: 'Tibit', symbol: 'Tibit', name: 'tebibit (2^40 bit)', bits: TI, system: 'IEC', kind: 'bit' },
  { id: 'Pibit', symbol: 'Pibit', name: 'pebibit (2^50 bit)', bits: PI, system: 'IEC', kind: 'bit' },
  { id: 'B', symbol: 'B', name: 'byte', bits: 8n, system: 'none', kind: 'byte' },
  { id: 'kB', symbol: 'kB', name: 'kilobyte (10^3 bytes)', bits: 8n * K, system: 'SI', kind: 'byte' },
  { id: 'MB', symbol: 'MB', name: 'megabyte (10^6 bytes)', bits: 8n * M, system: 'SI', kind: 'byte' },
  { id: 'GB', symbol: 'GB', name: 'gigabyte (10^9 bytes)', bits: 8n * G, system: 'SI', kind: 'byte' },
  { id: 'TB', symbol: 'TB', name: 'terabyte (10^12 bytes)', bits: 8n * T, system: 'SI', kind: 'byte' },
  { id: 'PB', symbol: 'PB', name: 'petabyte (10^15 bytes)', bits: 8n * P, system: 'SI', kind: 'byte' },
  { id: 'EB', symbol: 'EB', name: 'exabyte (10^18 bytes)', bits: 8n * E, system: 'SI', kind: 'byte' },
  { id: 'KiB', symbol: 'KiB', name: 'kibibyte (2^10 bytes)', bits: 8n * KI, system: 'IEC', kind: 'byte' },
  { id: 'MiB', symbol: 'MiB', name: 'mebibyte (2^20 bytes)', bits: 8n * MI, system: 'IEC', kind: 'byte' },
  { id: 'GiB', symbol: 'GiB', name: 'gibibyte (2^30 bytes)', bits: 8n * GI, system: 'IEC', kind: 'byte' },
  { id: 'TiB', symbol: 'TiB', name: 'tebibyte (2^40 bytes)', bits: 8n * TI, system: 'IEC', kind: 'byte' },
  { id: 'PiB', symbol: 'PiB', name: 'pebibyte (2^50 bytes)', bits: 8n * PI, system: 'IEC', kind: 'byte' },
  { id: 'EiB', symbol: 'EiB', name: 'exbibyte (2^60 bytes)', bits: 8n * EI, system: 'IEC', kind: 'byte' },
];

export type UnitId = (typeof UNITS)[number]['id'];

export function findUnit(id: string): UnitDef {
  const u = UNITS.find((u) => u.id === id);
  if (!u) throw new Error(`unknown unit "${id}"`);
  return u;
}

export interface TimeUnitDef {
  id: string;
  symbol: string;
  name: string;
  seconds: bigint;
}

export const TIME_UNITS: readonly TimeUnitDef[] = [
  { id: 's', symbol: 's', name: 'second', seconds: 1n },
  { id: 'min', symbol: 'min', name: 'minute', seconds: 60n },
  { id: 'h', symbol: 'h', name: 'hour', seconds: 3600n },
];

export type TimeUnitId = (typeof TIME_UNITS)[number]['id'];

export function findTimeUnit(id: string): TimeUnitDef {
  const u = TIME_UNITS.find((u) => u.id === id);
  if (!u) throw new Error(`unknown time unit "${id}"`);
  return u;
}
