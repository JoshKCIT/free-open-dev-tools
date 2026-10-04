/**
 * A refusal of a pasted command. The message says what is wrong and where (the position is in `line` and `column`, both
 * counted from 1); it never repeats more than a few escaped characters of the paste, so it can be shown or copied
 * without leaking a value that was pasted next to a secret.
 */
export class DockerRunError extends Error {
  /** The line of the pasted text the problem is on, counting from 1. */
  readonly line: number;
  /** The column on that line, counting from 1. */
  readonly column: number;

  constructor(message: string, line: number = 1, column: number = 1) {
    super(message);
    this.name = 'DockerRunError';
    this.line = line;
    this.column = column;
  }
}
