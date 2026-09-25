import meta from './meta.json';

export { meta };

export class TsToJsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TsToJsError';
  }
}

export interface StripTypesDiagnostic {
  message: string;
  line: number;
  column: number;
}

export interface StripTypesOptions {
  target?: 'ES2015' | 'ES2017' | 'ES2020' | 'ES2022' | 'ESNext';
  module?: 'preserve' | 'commonjs';
  jsx?: 'preserve' | 'react-jsx' | 'react';
  removeComments?: boolean;
}

export interface StripTypesResult {
  output: string;
  diagnostics: StripTypesDiagnostic[];
}

// RED-phase stub (TDD, this plan's Task 2): not implemented yet.
export function stripTypes(_source: string, _options: StripTypesOptions = {}): StripTypesResult {
  throw new TsToJsError('not implemented');
}
