import { expect, it } from 'vitest';
import { Base32Error, decodeBase32 } from '../src/index';

// Tests for the findings of the phase 14 code review (part B) against the TOTP generator.

// B-IN-01: the message about padding read "from at character 9".
it('the padding message says where the padding starts in plain words', () => {
  let message = '';
  try {
    decodeBase32('MZXW6YTB=');
  } catch (err) {
    expect(err).toBeInstanceOf(Base32Error);
    message = (err as Base32Error).message;
  }
  expect(message).toMatch(/^The padding at the end of this secret starts at character 9 and is not the length/);
  expect(message).not.toMatch(/from at/);
  // The position it names is where the padding sign was typed, counted from 1, with a separator before it.
  try {
    decodeBase32('MZXW6 YTB ==');
  } catch (err) {
    message = (err as Base32Error).message;
  }
  expect(message).toMatch(/starts at character 11 and/);
});
