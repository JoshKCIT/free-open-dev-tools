import { it, expect } from 'vitest';
import { validateScheme, computeScheme, CheckDigitError } from '../src/index';

// The weights of the GS1 and ISBN-13 check digit (ISBN Users Manual 2012, Appendix 1, A1.1): the first twelve digits are
// multiplied alternately by 1 and 3 from the left, the check digit is 10 minus the remainder of the sum divided by 10, and
// 0 when that gives 10. Hand computation for the manual's own number 978-0-11-000222-4:
//   9*1 + 7*3 + 8*1 + 0*3 + 1*1 + 1*3 + 0*1 + 0*3 + 0*1 + 2*3 + 2*1 + 2*3 = 9+21+8+0+1+3+0+0+0+6+2+6 = 56
//   56 mod 10 = 6, 10 - 6 = 4, so the check digit is 4 and the number is valid.
// The manual's two further test numbers are 9780777777770 (sum 150, remainder 0, check digit 0) and 978-951-23-8888-2.

function refusal(run: () => unknown): CheckDigitError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(CheckDigitError);
    return err as CheckDigitError;
  }
  throw new Error('expected a CheckDigitError but nothing was thrown');
}

it('ISBN-13 vectors from the ISBN Users Manual are valid and the check digit computes', () => {
  for (const [typed, plain] of [
    ['978-0-11-000222-4', '9780110002224'],
    ['9780777777770', '9780777777770'],
    ['978-951-23-8888-2', '9789512388882'],
  ] as const) {
    const result = validateScheme('isbn13', typed);
    expect(result.valid).toBe(true);
    expect(result.normalised).toBe(plain);
    expect(result.checkDigit).toBe(plain.slice(-1));
    expect(result.expected).toBe(plain.slice(-1));
  }
  const computed = computeScheme('isbn13', '978011000222');
  expect(computed.checkDigit).toBe('4');
  expect(computed.full).toBe('9780110002224');
  // Spaces and hyphens are ignored when computing as well.
  expect(computeScheme('isbn13', '978-0-11-000222').full).toBe('9780110002224');
  expect(computeScheme('isbn13', '978077777777').checkDigit).toBe('0');
});

it('a wrong check digit names the expected digit and a bad character gives only its position', () => {
  const wrong = validateScheme('isbn13', '978-0-11-000222-5');
  expect(wrong.valid).toBe(false);
  expect(wrong.checkDigit).toBe('5');
  expect(wrong.expected).toBe('4');

  // A letter is refused with the place it stands, counted in the text as typed, and the message never repeats it.
  const typed = '978-0-11-000222-z';
  const bad = refusal(() => validateScheme('isbn13', typed));
  expect(bad.position).toBe(typed.indexOf('z'));
  expect(bad.message).toContain('17');
  expect(bad.message).not.toMatch(/z/i);
  const inside = refusal(() => validateScheme('isbn13', '97801z0002224'));
  expect(inside.position).toBe(5);
  expect(inside.message).not.toMatch(/z/i);
  // Computing refuses the same way.
  expect(refusal(() => computeScheme('isbn13', '97801100022z')).position).toBe(11);
});

it('a number of the wrong length is refused naming the expected length', () => {
  for (const typed of ['97801100022244', '978011000222', '', '9780110002224 9']) {
    const error = refusal(() => validateScheme('isbn13', typed));
    expect(error.message).toContain('13');
    expect(error.position).toBeUndefined();
  }
  // Computing wants the first twelve digits.
  for (const typed of ['9780110002224', '97801100022', '']) {
    const error = refusal(() => computeScheme('isbn13', typed));
    expect(error.message).toContain('12');
    expect(error.position).toBeUndefined();
  }
});
