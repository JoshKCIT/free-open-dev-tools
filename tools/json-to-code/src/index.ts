import meta from './meta.json';
import { emitGo } from './emit-go';
import { emitPython } from './emit-python';
import { emitRust } from './emit-rust';
import { emitTypeScript } from './emit-typescript';
import { type InferredModel, inferModel } from './infer';
import { MAX_JSON_DEPTH, exceedsDepth, parseJsonText } from './json-text';

export { meta };
export { MAX_JSON_DEPTH };

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

export const LANGUAGES = ['typescript', 'go', 'rust', 'python'] as const;
export type Language = (typeof LANGUAGES)[number];

export class JsonToCodeError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'JsonToCodeError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export interface JsonToCodeOptions {
  language: Language;
  rootName?: string;
}

export interface JsonToCodeResult {
  output: string;
  warnings: string[];
  /** How many named types (interfaces, structs, records or classes) the model produced. */
  typeCount: number;
}

function emit(model: InferredModel, language: Language): { output: string; warnings: string[] } {
  switch (language) {
    case 'typescript':
      return emitTypeScript(model);
    case 'go':
      return emitGo(model);
    case 'rust':
      return emitRust(model);
    case 'python':
      return emitPython(model);
    default: {
      const exhaustive: never = language;
      throw new JsonToCodeError(`"${String(exhaustive)}" is not a supported language.`);
    }
  }
}

/** Turns a JSON sample into typed source text for the chosen language. `rootName` names the top-level type and is sanitised to a valid identifier. */
export function jsonToCode(text: string, options: JsonToCodeOptions): JsonToCodeResult {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new JsonToCodeError(parsed.message ?? 'The document could not be parsed.', {
      line: parsed.line,
      column: parsed.column,
    });
  }
  if (exceedsDepth(parsed.value, MAX_JSON_DEPTH)) throw new JsonToCodeError(DEPTH_MESSAGE);

  const model = inferModel(parsed.value, options.rootName ?? 'Root');
  const result = emit(model, options.language);

  return {
    output: result.output,
    warnings: [...model.warnings, ...result.warnings],
    typeCount: model.objects.length,
  };
}
