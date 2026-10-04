/**
 * A refusal of input that is over a limit (a field, a list or the whole manifest). The message says which field or list
 * and what the limit is; it never repeats the text that was typed, so it can be shown or copied without leaking it.
 * Anything else a visitor types, however odd, is not an error: it becomes a finding.
 */
export class ManifestBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestBuilderError';
  }
}
