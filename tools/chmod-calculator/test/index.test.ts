import { describe, it, expect } from 'vitest';
import {
  fromMode,
  toMode,
  toSymbolic,
  parseSymbolic,
  parseOctal,
  applyExpression,
  applyUmask,
  report,
  ChmodError,
} from '../src/index';

describe('octal to symbolic', () => {
  const cases: [number, string][] = [
    [0o000, '---------'],
    [0o644, 'rw-r--r--'],
    [0o755, 'rwxr-xr-x'],
    [0o777, 'rwxrwxrwx'],
    [0o600, 'rw-------'],
    [0o700, 'rwx------'],
    [0o664, 'rw-rw-r--'],
    [0o111, '--x--x--x'],
    [0o421, 'r---w---x'],
  ];

  for (const [mode, symbolic] of cases) {
    it(`${mode.toString(8).padStart(3, '0')} is ${symbolic}`, () => {
      expect(toSymbolic(fromMode(mode))).toBe(symbolic);
      expect(toMode(parseSymbolic(symbolic))).toBe(mode);
    });
  }
});

describe('special bits', () => {
  it('shows setuid as s when execute is set', () => {
    expect(toSymbolic(fromMode(0o4755))).toBe('rwsr-xr-x');
  });

  it('shows setuid as capital S when execute is not set, because the bit does nothing', () => {
    expect(toSymbolic(fromMode(0o4644))).toBe('rwSr--r--');
  });

  it('shows setgid in the group triad', () => {
    expect(toSymbolic(fromMode(0o2775))).toBe('rwxrwsr-x');
    expect(toSymbolic(fromMode(0o2664))).toBe('rw-rwSr--');
  });

  it('shows the sticky bit in the other triad, as /tmp has it', () => {
    expect(toSymbolic(fromMode(0o1777))).toBe('rwxrwxrwt');
    expect(toSymbolic(fromMode(0o1666))).toBe('rw-rw-rwT');
  });

  it('round-trips every special bit combination', () => {
    for (let special = 0; special < 8; special++) {
      for (const base of [0o000, 0o644, 0o755, 0o777]) {
        const mode = (special << 9) | base;
        expect(toMode(parseSymbolic(toSymbolic(fromMode(mode))))).toBe(mode);
      }
    }
  });

  it('round-trips all 4096 modes', () => {
    for (let mode = 0; mode <= 0o7777; mode++) {
      expect(toMode(fromMode(mode))).toBe(mode);
      expect(toMode(parseSymbolic(toSymbolic(fromMode(mode))))).toBe(mode);
    }
  });
});

describe('parsing', () => {
  it('accepts three and four digit octal', () => {
    expect(parseOctal('755')).toBe(0o755);
    expect(parseOctal('0755')).toBe(0o755);
    expect(parseOctal('4755')).toBe(0o4755);
    expect(parseOctal('0o644')).toBe(0o644);
  });

  it('rejects a digit above 7', () => {
    expect(() => parseOctal('789')).toThrow(ChmodError);
  });

  it('rejects the wrong length', () => {
    expect(() => parseOctal('75555')).toThrow(/octal mode/);
    expect(() => parseOctal('')).toThrow();
  });

  it('accepts the ten character form that ls prints', () => {
    expect(toMode(parseSymbolic('-rw-r--r--'))).toBe(0o644);
    expect(toMode(parseSymbolic('drwxr-xr-x'))).toBe(0o755);
    expect(toMode(parseSymbolic('lrwxrwxrwx'))).toBe(0o777);
  });

  it('rejects a symbolic string of the wrong length', () => {
    expect(() => parseSymbolic('rwxrwx')).toThrow(/nine characters/);
  });

  it('rejects an invalid character with its position', () => {
    expect(() => parseSymbolic('rwzr-xr-x')).toThrow(/Position 3/);
    expect(() => parseSymbolic('zwxr-xr-x')).toThrow(/Position 1/);
  });

  it('rejects t in the user triad and s in the other triad', () => {
    expect(() => parseSymbolic('rwtr-xr-x')).toThrow(/Position 3/);
    expect(() => parseSymbolic('rwxr-xr-s')).toThrow(/Position 9/);
  });
});

describe('chmod expressions', () => {
  it('adds a permission', () => {
    expect(applyExpression(0o644, 'u+x')).toBe(0o744);
    expect(applyExpression(0o644, 'a+x')).toBe(0o755);
  });

  it('removes a permission', () => {
    expect(applyExpression(0o777, 'go-w')).toBe(0o755);
    expect(applyExpression(0o666, 'o-rw')).toBe(0o660);
  });

  it('replaces a whole triad with =', () => {
    expect(applyExpression(0o777, 'g=r')).toBe(0o747);
    expect(applyExpression(0o000, 'a=rw')).toBe(0o666);
    expect(applyExpression(0o755, 'o=')).toBe(0o750);
  });

  it('defaults to all three when no who is given', () => {
    expect(applyExpression(0o000, '+r')).toBe(0o444);
    expect(applyExpression(0o777, '-w')).toBe(0o555);
  });

  it('applies several clauses in order', () => {
    expect(applyExpression(0o644, 'u+x,go-r')).toBe(0o700);
    expect(applyExpression(0o000, 'u=rwx,g=rx,o=')).toBe(0o750);
  });

  it('handles the special bits', () => {
    expect(applyExpression(0o755, 'u+s')).toBe(0o4755);
    expect(applyExpression(0o755, 'g+s')).toBe(0o2755);
    expect(applyExpression(0o777, '+t')).toBe(0o1777);
    expect(applyExpression(0o4755, 'u-s')).toBe(0o755);
  });

  it('rejects a clause it cannot parse', () => {
    expect(() => applyExpression(0o644, 'u!x')).toThrow(/not a chmod clause/);
    expect(() => applyExpression(0o644, 'q+x')).toThrow();
  });

  it('ignores empty clauses from a trailing comma', () => {
    expect(applyExpression(0o644, 'u+x,')).toBe(0o744);
  });
});

describe('umask', () => {
  it('computes the default file and directory modes for umask 022', () => {
    expect(applyUmask(0o022, false)).toBe(0o644);
    expect(applyUmask(0o022, true)).toBe(0o755);
  });

  it('computes them for umask 077, the private default', () => {
    expect(applyUmask(0o077, false)).toBe(0o600);
    expect(applyUmask(0o077, true)).toBe(0o700);
  });

  it('computes them for umask 002, the group-collaboration default', () => {
    expect(applyUmask(0o002, false)).toBe(0o664);
    expect(applyUmask(0o002, true)).toBe(0o775);
  });

  it('never grants execute to a new file, whatever the umask', () => {
    for (let umask = 0; umask <= 0o777; umask++) {
      expect(applyUmask(umask, false) & 0o111).toBe(0);
    }
  });
});

describe('reporting', () => {
  it('describes each triad in words', () => {
    const r = report(0o640);
    expect(r.description[0]).toBe('The owner can read, write');
    expect(r.description[1]).toBe('The group can read');
    expect(r.description[2]).toBe('Everyone else can do nothing');
  });

  it('formats the ls style string with a type character', () => {
    expect(report(0o755, true).lsStyle).toBe('drwxr-xr-x');
    expect(report(0o644, false).lsStyle).toBe('-rw-r--r--');
  });

  it('warns about a world-writable file', () => {
    expect(report(0o666).warnings.join(' ')).toMatch(/Anyone on the system can modify/);
  });

  it('suggests the sticky bit for a world-writable directory', () => {
    expect(report(0o777, true).warnings.join(' ')).toMatch(/sticky bit/);
  });

  it('does not warn about /tmp, which has the sticky bit', () => {
    expect(report(0o1777, true).warnings.join(' ')).not.toMatch(/sticky bit \(chmod/);
  });

  it('warns that setuid on a root-owned binary is dangerous', () => {
    expect(report(0o4755).warnings.join(' ')).toMatch(/privilege escalation/);
  });

  it('points out a special bit that has no effect', () => {
    expect(report(0o4644).warnings.join(' ')).toMatch(/does nothing/);
  });

  it('explains read without execute on a directory', () => {
    expect(report(0o644, true).warnings.join(' ')).toMatch(/list the names but not open/);
  });

  it('calls out 777 specifically', () => {
    expect(report(0o777).warnings.join(' ')).toMatch(/almost never the right answer/);
  });

  it('includes the special bits in the chmod command when they are set', () => {
    expect(report(0o4755).chmodCommand).toContain('4755');
    expect(report(0o755).chmodCommand).toContain('755');
  });
});

describe('validation', () => {
  it('rejects a mode outside the octal range', () => {
    expect(() => fromMode(-1)).toThrow(ChmodError);
    expect(() => fromMode(0o10000)).toThrow(ChmodError);
    expect(() => fromMode(1.5)).toThrow(ChmodError);
  });
});
