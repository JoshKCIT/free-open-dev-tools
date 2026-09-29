/**
 * Thrown by every function in this package. `position` is a character
 * index into the relevant field, present only when a specific position is
 * known. The message never contains a fragment of a password (S2).
 */
export class DbHashError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'DbHashError';
    this.position = position;
  }
}
