/**
 * Thrown for an identifier the ULID, NanoID, KSUID, Snowflake and ObjectId code cannot make or read. The message is a
 * fixed sentence that names the format and the rule. It never repeats pasted text.
 */
export class IdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentifierError';
  }
}

/** The most identifiers one call makes, the same cap the page has always had for UUIDs. */
export const MAX_IDENTIFIER_COUNT = 10000;

export function checkCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_IDENTIFIER_COUNT) {
    throw new IdentifierError('The count must be a whole number from 1 to 10,000.');
  }
}
