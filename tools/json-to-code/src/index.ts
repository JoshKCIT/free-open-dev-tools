import meta from './meta.json';
import { emitCSharp } from './emit-csharp';
import { emitDart } from './emit-dart';
import { emitGo } from './emit-go';
import { emitJava } from './emit-java';
import { emitKotlin } from './emit-kotlin';
import { emitPhp } from './emit-php';
import { emitProtobuf } from './emit-protobuf';
import { emitPython } from './emit-python';
import { emitRust } from './emit-rust';
import { emitSwift } from './emit-swift';
import { emitTypeScript } from './emit-typescript';
import { type InferredModel, inferModel } from './infer';
import { MAX_JSON_DEPTH, exceedsDepth, parseJsonText } from './json-text';
import { XmlValueError, readXmlValue } from './xml-read';
import { typeXmlValues } from './xml-typed';
import { YamlValueError, readYamlValue } from './yaml-value';

export { meta };
export { MAX_JSON_DEPTH };

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

export const LANGUAGES = [
  'typescript',
  'go',
  'rust',
  'python',
  'java',
  'csharp',
  'kotlin',
  'php',
  'swift',
  'dart',
  'protobuf',
] as const;
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

/** What the input text is written in. `json` is the default and reads exactly as it always has. */
export const INPUT_FORMATS = ['json', 'yaml', 'xml'] as const;
export type InputFormat = (typeof INPUT_FORMATS)[number];

export interface ValueToCodeOptions {
  language: Language;
  rootName?: string;
}

export interface JsonToCodeOptions extends ValueToCodeOptions {
  /** How `text` is written. Default `json`. */
  inputFormat?: InputFormat;
  /** XML input only. Read text written like a JSON number, `true` or `false` as a number or boolean. Default false: every XML leaf is a string. */
  parseValues?: boolean;
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
    case 'java':
      return emitJava(model);
    case 'csharp':
      return emitCSharp(model);
    case 'kotlin':
      return emitKotlin(model);
    case 'php':
      return emitPhp(model);
    case 'swift':
      return emitSwift(model);
    case 'dart':
      return emitDart(model);
    case 'protobuf':
      return emitProtobuf(model);
    default: {
      const exhaustive: never = language;
      throw new JsonToCodeError(`"${String(exhaustive)}" is not a supported language.`);
    }
  }
}

const SINGLE_VALUE_MESSAGE =
  'A YAML document needs a mapping or a list at the top to give types; this one is a single value.';

/** Turns an already parsed value into typed source text for the chosen language. This is the part of `jsonToCode` that comes after the text has been read, so every input format reaches the same generator. */
export function valueToCode(value: unknown, options: ValueToCodeOptions): JsonToCodeResult {
  if (exceedsDepth(value, MAX_JSON_DEPTH)) throw new JsonToCodeError(DEPTH_MESSAGE);

  const model = inferModel(value, options.rootName ?? 'Root');
  const result = emit(model, options.language);

  return {
    output: result.output,
    warnings: [...model.warnings, ...result.warnings],
    typeCount: model.objects.length,
  };
}

/** Reads YAML or XML text into a value, with the warnings the reader gave. */
function readStructured(
  text: string,
  format: 'yaml' | 'xml',
  parseValues: boolean,
): { value: unknown; warnings: string[] } {
  if (format === 'yaml') {
    try {
      const read = readYamlValue(text, { documents: 'one' });
      if (read.value === null || typeof read.value !== 'object') throw new JsonToCodeError(SINGLE_VALUE_MESSAGE);
      return read;
    } catch (err) {
      if (err instanceof YamlValueError) throw new JsonToCodeError(err.message, { line: err.line, column: err.column });
      throw err;
    }
  }
  try {
    const read = readXmlValue(text);
    return { value: parseValues ? typeXmlValues(read.value) : read.value, warnings: read.warnings };
  } catch (err) {
    if (err instanceof XmlValueError) throw new JsonToCodeError(err.message, { line: err.line, column: err.column });
    throw err;
  }
}

/** Turns a sample into typed source text for the chosen language. The sample is JSON unless `inputFormat` says YAML or XML. `rootName` names the top-level type and is sanitised to a valid identifier. */
export function jsonToCode(text: string, options: JsonToCodeOptions): JsonToCodeResult {
  const inputFormat = options.inputFormat ?? 'json';
  if (inputFormat !== 'json') {
    const read = readStructured(text, inputFormat, options.parseValues ?? false);
    const result = valueToCode(read.value, options);
    return { ...result, warnings: [...read.warnings, ...result.warnings] };
  }

  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new JsonToCodeError(parsed.message ?? 'The document could not be parsed.', {
      line: parsed.line,
      column: parsed.column,
    });
  }
  return valueToCode(parsed.value, options);
}
