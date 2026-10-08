/**
 * A refusal of what was pasted. The message says what is wrong and where (which file of the paste and which line of it)
 * and which limit applies, and never repeats any of the pasted text, so it can be shown, copied or logged by someone else
 * without leaking a path, a folder name or a setting. A file whose settings do not apply to the path is never a refusal:
 * it is a result.
 */
export class EditorConfigError extends Error {
  /** The reason alone, without the place it happened. */
  readonly reason: string;
  /** Which file of the paste the problem is in, such as `File 2`. Absent when no single file is to blame. */
  readonly file?: string;
  /** The line the problem is on: a line of that file, or a line of the whole paste when no file is named. */
  readonly line?: number;

  constructor(reason: string, file?: string, line?: number) {
    super(place(file, line) + reason);
    this.name = 'EditorConfigError';
    this.reason = reason;
    if (file !== undefined) this.file = file;
    if (line !== undefined) this.line = line;
  }
}

function place(file: string | undefined, line: number | undefined): string {
  if (file !== undefined && line !== undefined) return `${file}, line ${line}: `;
  if (file !== undefined) return `${file}: `;
  if (line !== undefined) return `Line ${line} of the paste: `;
  return '';
}
