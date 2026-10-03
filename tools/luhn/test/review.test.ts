import { it, expect } from 'vitest';
import { computeScheme, validateScheme } from '../src/index';

// Tests for the findings of the phase 14 code review (part B) against the check-digit schemes.

// B-WR-08: the IBAN note said a valid IBAN "has the right form", but only the length and the two check digits are checked.
it('the IBAN notes say right length and check digits, and that the account part is not checked against the country layout', () => {
  // The account part of this IBAN cannot exist in Germany (letters), yet its length and check digits compute and validate.
  const computed = computeScheme('iban', 'DEABCDEFGHIJKLMNOPQR');
  const full = computed.full;
  expect(full).toHaveLength(22);
  const checked = validateScheme('iban', full);
  expect(checked.valid).toBe(true);
  for (const note of [...checked.notes, ...computed.notes]) {
    expect(note).toMatch(/right length and check digits/);
    expect(note).toMatch(/account part is not checked against the layout/);
    expect(note).toMatch(/does not show that the account exists/);
    expect(note).not.toMatch(/right form/);
  }
  expect(checked.notes).toHaveLength(1);
  expect(computed.notes).toHaveLength(1);
});
