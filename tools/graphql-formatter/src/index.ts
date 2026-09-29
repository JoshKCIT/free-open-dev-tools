import meta from './meta.json';
// Subpaths confirmed from the installed prettier@3.9.9 package's own `exports`
// map, the same pair css-formatter uses for its own syntax: `prettier/standalone`
// (the bundler-friendly entry with no Node APIs) and `prettier/plugins/graphql`
// (the GraphQL parser/printer plugin). Prettier here is a runtime dependency of
// this folder only. `graphql` is the reference implementation: its own `parse`
// checks syntax before either mode runs, and its own `stripIgnoredCharacters`
// implements minifying per the specification's Ignored Tokens rule.
import * as prettier from 'prettier/standalone';
import * as graphqlPlugin from 'prettier/plugins/graphql';
import { parse, stripIgnoredCharacters, GraphQLError, Kind, type DocumentNode } from 'graphql';

export { meta };

export class GraphqlFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'GraphqlFormatterError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export type GraphqlFormatterMode = 'beautify' | 'minify';
export type GraphqlFormatterIndent = 2 | 4 | 'tab';

export interface FormatGraphqlOptions {
  mode?: GraphqlFormatterMode;
  /** Beautify only. Default 2. */
  indent?: GraphqlFormatterIndent;
  /** Beautify only. A whole number from 20 to 200. Default 80. */
  printWidth?: number;
}

/**
 * Counts of the document's own top-level definitions (PD-4): `operations`
 * counts OperationDefinition nodes (including the `{ ... }` shorthand),
 * `fragments` counts FragmentDefinition nodes, and `typeDefinitions` counts
 * only the six named type definition kinds (scalar, object, interface,
 * union, enum, input object). Schema definitions, directive definitions and
 * type extensions are read but never counted here -- see this package's own
 * `meta.json` `ambiguities`.
 */
export interface GraphqlDocumentStats {
  operations: number;
  fragments: number;
  typeDefinitions: number;
}

export interface FormatGraphqlResult {
  output: string;
  inputBytes: number;
  outputBytes: number;
  stats: GraphqlDocumentStats;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

const NAMED_TYPE_DEFINITION_KINDS: ReadonlySet<string> = new Set([
  Kind.SCALAR_TYPE_DEFINITION,
  Kind.OBJECT_TYPE_DEFINITION,
  Kind.INTERFACE_TYPE_DEFINITION,
  Kind.UNION_TYPE_DEFINITION,
  Kind.ENUM_TYPE_DEFINITION,
  Kind.INPUT_OBJECT_TYPE_DEFINITION,
]);

function computeStats(ast: DocumentNode): GraphqlDocumentStats {
  let operations = 0;
  let fragments = 0;
  let typeDefinitions = 0;
  for (const def of ast.definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION) operations++;
    else if (def.kind === Kind.FRAGMENT_DEFINITION) fragments++;
    else if (NAMED_TYPE_DEFINITION_KINDS.has(def.kind)) typeDefinitions++;
  }
  return { operations, fragments, typeDefinitions };
}

function validatePrintWidth(printWidth: number): void {
  if (!Number.isInteger(printWidth) || printWidth < 20 || printWidth > 200) {
    throw new GraphqlFormatterError('Print width must be a whole number from 20 to 200.');
  }
}

interface PrettierParseError extends Error {
  loc?: { start?: { line?: number; column?: number } };
}

function isPrettierParseError(err: unknown): err is PrettierParseError {
  return err instanceof Error && 'loc' in err;
}

/** graphql-js's parser and Prettier's own graphql printer both overflow the call stack (RangeError) on a document nested thousands of levels deep, well before either could return a useful error; PD-7 turns that into one typed, line-less message instead of a crash. */
function isStackOverflow(err: unknown): boolean {
  return err instanceof RangeError;
}

/**
 * Beautifies a GraphQL document with Prettier's own GraphQL printer, or
 * minifies it with graphql-js's `stripIgnoredCharacters` (specification
 * section 2.1.7, Ignored Tokens). Both modes first parse the input with
 * graphql-js's own `parse`, using its default options (PD-5: fragment
 * variable definitions, an experimental proposal outside the specification,
 * are refused with the parser's own message), so a syntax error is refused
 * the same way in either mode, with the parser's own message, line and
 * column.
 */
export async function formatGraphql(source: string, options: FormatGraphqlOptions = {}): Promise<FormatGraphqlResult> {
  const { mode = 'beautify', indent = 2, printWidth = 80 } = options;

  if (mode === 'beautify') validatePrintWidth(printWidth);

  const inputBytes = byteLength(source);

  let ast;
  try {
    ast = parse(source);
  } catch (err) {
    if (err instanceof GraphQLError) {
      const location = err.locations?.[0];
      throw new GraphqlFormatterError(err.message, { line: location?.line, column: location?.column });
    }
    if (isStackOverflow(err)) {
      throw new GraphqlFormatterError('This document is nested too deeply to format.');
    }
    throw new GraphqlFormatterError(err instanceof Error ? err.message : 'This document could not be parsed.');
  }

  // graphql-js's own grammar requires a Document to have at least one
  // Definition, so `parse` above already refuses empty or comments-only
  // input with a Syntax Error before this line is reached (verified
  // directly against the installed graphql@17.0.2 package).
  const stats = computeStats(ast);

  let output: string;
  if (mode === 'minify') {
    try {
      output = stripIgnoredCharacters(source);
    } catch (err) {
      if (isStackOverflow(err)) {
        throw new GraphqlFormatterError('This document is nested too deeply to format.');
      }
      throw new GraphqlFormatterError(err instanceof Error ? err.message : 'This document could not be minified.');
    }
  } else {
    const tabWidth = indent === 'tab' ? 2 : indent;
    const useTabs = indent === 'tab';
    try {
      output = await prettier.format(source, {
        parser: 'graphql',
        plugins: [graphqlPlugin],
        tabWidth,
        useTabs,
        printWidth,
      });
    } catch (err) {
      if (isPrettierParseError(err)) {
        throw new GraphqlFormatterError(err.message.split('\n')[0] ?? err.message, {
          line: err.loc?.start?.line,
          column: err.loc?.start?.column,
        });
      }
      if (isStackOverflow(err)) {
        throw new GraphqlFormatterError('This document is nested too deeply to format.');
      }
      throw new GraphqlFormatterError(err instanceof Error ? err.message : 'This document could not be formatted.');
    }
  }

  return { output, inputBytes, outputBytes: byteLength(output), stats };
}
