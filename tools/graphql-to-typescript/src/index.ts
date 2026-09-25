import meta from './meta.json';
import {
  GraphQLError,
  buildSchema,
  parse,
  validateSchema,
  visit,
  type DocumentNode,
  type NamedTypeNode,
} from 'graphql';
import { emitTypeScript, type EmitOptions, type EnumStyle } from './emit';

export { meta };

const BUILT_IN_TYPE_NAMES = new Set(['ID', 'String', 'Int', 'Float', 'Boolean']);

/**
 * graphql-js's own public buildSchema throws a plain Error with no location
 * for a structural problem such as an undefined type reference: internally
 * it collects proper located errors, but its exported entry point joins
 * their messages into one string and discards the locations (confirmed by
 * direct test against the installed graphql 17.0.2 package, not assumed).
 * This re-derives just the "named type is never defined" case from the
 * parsed document, which the reference implementation's own parser and
 * visitor still produce, so the refusal still names the real offending
 * position instead of giving up on it.
 */
function findUnknownTypeReference(sdl: string): { name: string; line?: number; column?: number } | undefined {
  let ast: DocumentNode;
  try {
    ast = parse(sdl);
  } catch {
    return undefined; // a syntax error; buildSchema's own thrown GraphQLError already carries a location for this
  }

  const defined = new Set<string>(BUILT_IN_TYPE_NAMES);
  visit(ast, {
    ScalarTypeDefinition: (node) => defined.add(node.name.value),
    ObjectTypeDefinition: (node) => defined.add(node.name.value),
    InterfaceTypeDefinition: (node) => defined.add(node.name.value),
    UnionTypeDefinition: (node) => defined.add(node.name.value),
    EnumTypeDefinition: (node) => defined.add(node.name.value),
    InputObjectTypeDefinition: (node) => defined.add(node.name.value),
  });

  let found: NamedTypeNode | undefined;
  visit(ast, {
    NamedType: (node) => {
      if (found === undefined && !defined.has(node.name.value)) found = node;
    },
  });
  if (found === undefined) return undefined;
  const start = found.loc?.startToken;
  return { name: found.name.value, line: start?.line, column: start?.column };
}

export class GraphqlToTypeScriptError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'GraphqlToTypeScriptError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export interface GraphqlToTypeScriptOptions {
  /** Union of string literals, or a real TypeScript enum. Default 'union'. */
  enumStyle?: EnumStyle;
  /** Add an optional `__typename` discriminant field to object and interface types. Default false. */
  includeTypename?: boolean;
  /** Maps a custom scalar name to a TypeScript type expression; unmapped scalars stay unknown. */
  scalars?: Record<string, string>;
}

export interface GraphqlToTypeScriptResult {
  output: string;
  /** Count of named GraphQL types turned into a TypeScript declaration. */
  types: number;
  warnings: string[];
}

function fromGraphQLError(error: GraphQLError): GraphqlToTypeScriptError {
  const location = error.locations?.[0];
  return new GraphqlToTypeScriptError(error.message, { line: location?.line, column: location?.column });
}

/**
 * Parses and validates a GraphQL schema definition (SDL) with the official
 * graphql-js reference implementation, then turns every type it declares
 * into a matching TypeScript declaration.
 */
export function graphqlToTypeScript(sdl: string, options: GraphqlToTypeScriptOptions = {}): GraphqlToTypeScriptResult {
  let schema;
  try {
    schema = buildSchema(sdl);
  } catch (err) {
    if (err instanceof GraphQLError) throw fromGraphQLError(err);
    const unknown = findUnknownTypeReference(sdl);
    if (unknown !== undefined) {
      throw new GraphqlToTypeScriptError(`Unknown type "${unknown.name}".`, {
        line: unknown.line,
        column: unknown.column,
      });
    }
    throw new GraphqlToTypeScriptError(err instanceof Error ? err.message : 'The schema could not be parsed.');
  }

  const schemaErrors = validateSchema(schema);
  if (schemaErrors.length > 0) throw fromGraphQLError(schemaErrors[0]!);

  const emitOptions: EmitOptions = {
    enumStyle: options.enumStyle ?? 'union',
    includeTypename: options.includeTypename ?? false,
    scalars: options.scalars ?? {},
  };
  const result = emitTypeScript(schema, emitOptions);

  return { output: result.output, types: result.types, warnings: result.warnings };
}
