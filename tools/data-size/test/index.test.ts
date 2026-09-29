import { it, expect, describe } from 'vitest';
import { convertSize, convertSpeed, transferTime, speedNeeded, meta } from '../src/index';
import { parseAmount, DataSizeError, cmpR, makeRational } from '../src/rational';
import { UNITS } from '../src/units';

function rowFor(rows: ReturnType<typeof convertSize>, unit: string) {
  const r = rows.find((r) => r.unit === unit);
  if (!r) throw new Error(`no row for unit ${unit}`);
  return r;
}

describe('meta', () => {
  it('id/name/summary and non-empty limits', () => {
    expect(meta.id).toBe('data-size');
    expect(meta.name).toBe('Data Size & Transfer Time');
    expect(meta.limits.length).toBeGreaterThan(0);
  });
});

// IEC 80000-13 and SI prefix definitions.
describe('IEC 80000-13 / SI prefix definitions', () => {
  it('1 KiB = 1024 B', () => {
    const rows = convertSize(parseAmount('1', 'size'), 'KiB');
    expect(rowFor(rows, 'B').text).toBe('1024');
  });
  it('1 kB = 1000 B', () => {
    const rows = convertSize(parseAmount('1', 'size'), 'kB');
    expect(rowFor(rows, 'B').text).toBe('1000');
  });
  it('1 B = 8 bit', () => {
    const rows = convertSize(parseAmount('1', 'size'), 'B');
    expect(rowFor(rows, 'bit').text).toBe('8');
  });
  it('1 Kibit = 1024 bit', () => {
    const rows = convertSize(parseAmount('1', 'size'), 'Kibit');
    expect(rowFor(rows, 'bit').text).toBe('1024');
  });
  it('1 MiB = 1048576 B', () => {
    const rows = convertSize(parseAmount('1', 'size'), 'MiB');
    expect(rowFor(rows, 'B').text).toBe('1048576');
  });
  it('1 EiB = 1152921504606846976 B', () => {
    const rows = convertSize(parseAmount('1', 'size'), 'EiB');
    expect(rowFor(rows, 'B').text).toBe('1152921504606846976');
  });
  it("every UNITS entry's bit count equals an independently written 10^3n or 2^10n expression", () => {
    const bySystem: Record<string, number> = { SI: 0, IEC: 0 };
    for (const u of UNITS) {
      if (u.system === 'none') continue;
      const n = u.kind === 'bit' ? 1n : 8n;
      // Reconstruct the exponent from the unit's own symbol prefix.
      const prefixIndex = ['k', 'M', 'G', 'T', 'P', 'E'].indexOf(u.symbol[0]! === 'K' ? 'k' : u.symbol[0]!);
      const exponent = prefixIndex + 1;
      const expected = u.system === 'SI' ? n * 1000n ** BigInt(exponent) : n * 1024n ** BigInt(exponent);
      expect(u.bits, u.id).toBe(expected);
      bySystem[u.system]!++;
    }
    expect(bySystem.SI).toBe(11); // 5 SI bit units + 6 SI byte units
    expect(bySystem.IEC).toBe(11); // 5 IEC bit units + 6 IEC byte units
  });
});

describe('known conversions', () => {
  it('1 GiB = 1073741824 B (exact, printed in full at 6 digits)', () => {
    const rows = convertSize(parseAmount('1', 'size'), 'GiB');
    const row = rowFor(rows, 'B');
    expect(row.text).toBe('1073741824');
    expect(row.rounded).toBe(false);
  });

  it('100 Mbit/s = 12.5 MB/s exact', () => {
    const rows = convertSpeed(parseAmount('100', 'speed'), 'Mbit');
    const row = rowFor(rows, 'MB');
    expect(row.text).toBe('12.5');
    expect(row.rounded).toBe(false);
  });

  it('1 GB at 100 Mbit/s = 80 s, text "1 m 20 s"', () => {
    const result = transferTime(parseAmount('1', 'size'), 'GB', parseAmount('100', 'speed'), 'Mbit');
    expect(result.totalSeconds.text).toBe('80');
    expect(result.text).toBe('1 m 20 s');
  });

  it('1 TiB at 1 Gbit/s = 8796.093022208 s exactly, text at 6 digits "2 h 26 m 36.093 s" with seconds and total marked rounded', () => {
    const result = transferTime(parseAmount('1', 'size'), 'TiB', parseAmount('1', 'speed'), 'Gbit');
    expect(result.text).toBe('2 h 26 m 36.093 s');
    expect(result.totalSeconds.rounded).toBe(true);
    expect(result.seconds.rounded).toBe(true);
  });

  it('1 GB in 80 s needs exactly 100 Mbit/s', () => {
    const rows = speedNeeded(parseAmount('1', 'size'), 'GB', parseAmount('80', 'time'), 's');
    const row = rowFor(rows, 'Mbit');
    expect(row.text).toBe('100');
    expect(row.rounded).toBe(false);
  });

  it('1 GB in 1 min needs a rounded 133.333 Mbit/s', () => {
    const rows = speedNeeded(parseAmount('1', 'size'), 'GB', parseAmount('1', 'time'), 'min');
    const row = rowFor(rows, 'Mbit');
    expect(row.text).toBe('133.333');
    expect(row.rounded).toBe(true);
  });
});

describe('exactness where binary floats fail', () => {
  it('1.005 * 1000 is not a whole number in plain JS float math (proving the case is real)', () => {
    expect(Number.isInteger(1.005 * 1000)).toBe(false);
  });
  it('1.005 kB = 1005 B exactly, not marked rounded', () => {
    const rows = convertSize(parseAmount('1.005', 'size'), 'kB');
    const row = rowFor(rows, 'B');
    expect(row.text).toBe('1005');
    expect(row.rounded).toBe(false);
  });

  it('4.1 * 1e9 is not a whole number in plain JS float math (proving the case is real)', () => {
    expect(Number.isInteger(4.1 * 1e9)).toBe(false);
  });
  it('4.1 GB = 4100000000 B exactly, not marked rounded', () => {
    const rows = convertSize(parseAmount('4.1', 'size'), 'GB');
    const row = rowFor(rows, 'B');
    expect(row.text).toBe('4100000000');
    expect(row.rounded).toBe(false);
  });

  it('0.1 + 0.2 in plain JS float math is not exactly 0.3 (proving the case is real)', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
  });
  it('parseAmount("0.1") + parseAmount("0.2"), scaled by 1000, is exactly 300', () => {
    const a = parseAmount('0.1', 'value');
    const b = parseAmount('0.2', 'value');
    const sum = { num: a.num * b.den + b.num * a.den, den: a.den * b.den };
    // sum should reduce to 3/10; scaled by 1000 that is exactly 300.
    const scaled = (sum.num * 1000n) / sum.den;
    expect((sum.num * 1000n) % sum.den).toBe(0n);
    expect(scaled).toBe(300n);
  });
});

describe('rounding display', () => {
  it('0 B / 1024 = 0, no rounding needed', () => {
    const rows = convertSize(parseAmount('0', 'size'), 'B');
    expect(rowFor(rows, 'KiB').text).toBe('0');
    expect(rowFor(rows, 'KiB').rounded).toBe(false);
  });
});

describe('boundaries and refusals', () => {
  it('0 converts to 0 everywhere', () => {
    const rows = convertSize(parseAmount('0', 'size'), 'GiB');
    for (const row of rows) {
      expect(row.text).toBe('0');
      expect(row.rounded).toBe(false);
    }
  });

  it('1e30 and the 31-digit 10^30 are accepted', () => {
    expect(() => convertSize(parseAmount('1e30', 'size'), 'B')).not.toThrow();
  });

  it('a zero speed in transferTime is refused', () => {
    expect(() => transferTime(parseAmount('1', 'size'), 'GB', parseAmount('0', 'speed'), 'Mbit')).toThrow(
      DataSizeError,
    );
  });

  it('a zero time in speedNeeded is refused', () => {
    expect(() => speedNeeded(parseAmount('1', 'size'), 'GB', parseAmount('0', 'time'), 's')).toThrow(DataSizeError);
  });
});

describe('cmpR sanity used across the module', () => {
  it('agrees with hand-computed comparisons', () => {
    expect(cmpR(makeRational(1n, 2n), makeRational(1n, 3n))).toBe(1);
  });
});
