import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse, print } from 'graphql';
import { formatGraphql, GraphqlFormatterError } from '../src/index';

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

/** The independent second opinion: graphql-js's own printer over its own parser. Comments are not part of the AST, so this compares everything else -- structure, values, directives, descriptions. */
function canonical(source: string): string {
  return print(parse(source));
}

/** A corpus of documents grounded in the GraphQL Specification (September 2025 Edition). */
const CORPUS: { label: string; source: string }[] = [
  {
    // Section 2.3 Operations: named operation and the `{ ... }` shorthand.
    label: '2.3 Operations: named query and shorthand',
    source:
      'query GetHero($episode: Episode) {\n  hero(episode: $episode) {\n    name\n  }\n}\n\n{\n  hero {\n    name\n  }\n}\n',
  },
  {
    // Section 2.8 Fragments: a fragment definition and its spread.
    label: '2.8 Fragments: fragment definition and spread',
    source:
      'query withFragment {\n  hero {\n    ...heroFields\n  }\n}\n\nfragment heroFields on Character {\n  name\n  appearsIn\n}\n',
  },
  {
    // Section 2.9.4 String Value: a block string argument.
    label: '2.9.4 String Value: block string argument',
    source: 'query Q {\n  a(doc: """\n  line one\n  line two\n  """)\n}\n',
  },
  {
    // Section 3.2 Descriptions: a described type and field.
    label: '3.2 Descriptions: type and field descriptions',
    source: '"""A person."""\ntype Person {\n  """Their name."""\n  name: String\n}\n',
  },
  {
    // Section 3.13 Directives, including a repeatable directive definition and @deprecated(reason:).
    label: '3.13 Directives: repeatable directive definition and @deprecated',
    source:
      'directive @auth(role: String) repeatable on FIELD_DEFINITION\n\ntype Person {\n  name: String @deprecated(reason: "use fullName")\n  secret: String @auth(role: "admin") @auth(role: "owner")\n}\n',
  },
  {
    label: 'schema with interfaces implementing interfaces, unions, enums, input objects, extend and schema {}',
    source:
      'schema {\n  query: Query\n}\n\ninterface Node {\n  id: ID!\n}\n\ninterface Named implements Node {\n  id: ID!\n  name: String\n}\n\ntype Query implements Named & Node {\n  id: ID!\n  name: String\n}\n\nunion SearchResult = Query\n\nenum Status {\n  ACTIVE\n  INACTIVE\n}\n\ninput Filter {\n  name: String\n}\n\nextend type Query {\n  extra: String\n}\n',
  },
];

describe('formatGraphql: oracle equality across input, beautified and minified output', () => {
  for (const { label, source } of CORPUS) {
    it(`${label}: print(parse(x)) is equal for input, beautified and minified`, async () => {
      const beautified = await formatGraphql(source, { mode: 'beautify' });
      const minified = await formatGraphql(source, { mode: 'minify' });
      const expected = canonical(source);
      expect(canonical(beautified.output)).toBe(expected);
      expect(canonical(minified.output)).toBe(expected);
    });

    it(`${label}: beautify and minify are each idempotent`, async () => {
      const beautified = await formatGraphql(source, { mode: 'beautify' });
      const beautifiedTwice = await formatGraphql(beautified.output, { mode: 'beautify' });
      expect(beautifiedTwice.output).toBe(beautified.output);

      const minified = await formatGraphql(source, { mode: 'minify' });
      const minifiedTwice = await formatGraphql(minified.output, { mode: 'minify' });
      expect(minifiedTwice.output).toBe(minified.output);
    });
  }
});

describe('formatGraphql: graphql-js JSDoc documented stripIgnoredCharacters example', () => {
  it(// node_modules/.pnpm/graphql@17.0.2/node_modules/graphql/utilities/stripIgnoredCharacters.d.ts, lines 26-40
  'minifies the documented multi-line query to the documented one-line output', async () => {
    const source =
      'query SomeQuery($foo: String!, $bar: String) {\n  someField(foo: $foo, bar: $bar) {\n    a\n    b {\n      c\n      d\n    }\n  }\n}\n';
    const result = await formatGraphql(source, { mode: 'minify' });
    expect(result.output).toBe('query SomeQuery($foo:String!$bar:String){someField(foo:$foo bar:$bar){a b{c d}}}');
  });
});

describe('formatGraphql: beautify options', () => {
  it('indent 4 and tab change indentation', async () => {
    const source = 'query Q {\n  a\n}\n';
    const four = await formatGraphql(source, { mode: 'beautify', indent: 4 });
    expect(four.output).toContain('    a\n');
    const tab = await formatGraphql(source, { mode: 'beautify', indent: 'tab' });
    expect(tab.output).toContain('\ta\n');
  });

  it('printWidth 40 puts each argument on its own line (measured)', async () => {
    const source = 'query Q { a(first: 10, after: "abcdef", filter: {name: "x", age: 3}) { b c } }';
    const result = await formatGraphql(source, { mode: 'beautify', printWidth: 40 });
    expect(result.output).toContain('    first: 10\n');
    expect(result.output).toContain('    after: "abcdef"\n');
    expect(result.output).toContain('    filter: { name: "x", age: 3 }\n');
  });

  it('printWidth 19, 201 and 80.5 are refused with the fixed message', async () => {
    const message = 'Print width must be a whole number from 20 to 200.';
    await expect(formatGraphql('query Q { a }', { printWidth: 19 })).rejects.toThrow(message);
    await expect(formatGraphql('query Q { a }', { printWidth: 201 })).rejects.toThrow(message);
    await expect(formatGraphql('query Q { a }', { printWidth: 80.5 })).rejects.toThrow(message);
  });
});

describe('formatGraphql: comments', () => {
  it('a leading and a trailing comment survive beautify but minify drops every #', async () => {
    const source = '# top\nquery Q {\n  a # trailing\n}\n';
    const beautified = await formatGraphql(source, { mode: 'beautify' });
    expect(beautified.output).toContain('# top');
    expect(beautified.output).toContain('# trailing');

    const minified = await formatGraphql(source, { mode: 'minify' });
    expect(minified.output).not.toContain('#');
  });
});

describe('formatGraphql: block strings (2.9.4 String Value)', () => {
  it('a multi-line indented block string description keeps its value in both modes', async () => {
    const source = 'query Q {\n  a(doc: """\n  line one\n  line two\n  """)\n}\n';

    const beautified = await formatGraphql(source, { mode: 'beautify' });
    const minified = await formatGraphql(source, { mode: 'minify' });

    // The specification's own block-string dedent rule (2.9.4) means the
    // exact indentation of the re-printed block string may differ between
    // Prettier's printer and stripIgnoredCharacters; what must be equal is
    // the dedented VALUE each parses back to.
    const valueOf = (text: string): string => {
      const ast = parse(text);
      const op = ast.definitions[0];
      if (!op || op.kind !== 'OperationDefinition') throw new Error('expected an operation');
      const field = op.selectionSet.selections[0];
      if (!field || field.kind !== 'Field') throw new Error('expected a field');
      const arg = field.arguments?.[0];
      if (!arg || arg.value.kind !== 'StringValue') throw new Error('expected a string argument');
      return arg.value.value;
    };

    const originalValue = valueOf(source);
    expect(valueOf(beautified.output)).toBe(originalValue);
    expect(valueOf(minified.output)).toBe(originalValue);
    expect(minified.output).toContain('"""');
  });
});

describe('formatGraphql: unicode', () => {
  it('an astral character and a \\u{1F600} escape keep their value in both modes', async () => {
    const source = 'query Q {\n  a(s: "\ud83d\ude00 \\u{1F600}")\n}\n';
    const beautified = await formatGraphql(source, { mode: 'beautify' });
    const minified = await formatGraphql(source, { mode: 'minify' });
    for (const output of [beautified.output, minified.output]) {
      const ast = parse(output);
      const op = ast.definitions[0];
      if (!op || op.kind !== 'OperationDefinition') throw new Error('expected an operation');
      const field = op.selectionSet.selections[0];
      if (!field || field.kind !== 'Field') throw new Error('expected a field');
      const arg = field.arguments?.[0];
      if (!arg || arg.value.kind !== 'StringValue') throw new Error('expected a string argument');
      expect(arg.value.value).toBe('\ud83d\ude00 \ud83d\ude00');
    }
  });
});

describe('formatGraphql: CRLF and large input', () => {
  it('CRLF input formats and keeps print(parse()) equality in both modes', async () => {
    const source = 'query Q {\r\n  a\r\n  b\r\n}\r\n';
    const beautified = await formatGraphql(source, { mode: 'beautify' });
    const minified = await formatGraphql(source, { mode: 'minify' });
    const expected = canonical(source);
    expect(canonical(beautified.output)).toBe(expected);
    expect(canonical(minified.output)).toBe(expected);
  });

  it('a large generated schema (1,500 types with descriptions, directives and arguments) keeps equality in both modes', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 1500; i++) {
      lines.push(`"""Type number ${i}."""`);
      lines.push(
        `type T${i} { id: ID! @deprecated(reason: "legacy") name(limit: Int = ${i % 10}): String field${i}: T${(i + 1) % 1500} }`,
      );
    }
    const source = lines.join('\n') + '\n';
    const beautified = await formatGraphql(source, { mode: 'beautify' });
    const minified = await formatGraphql(source, { mode: 'minify' });
    const expected = canonical(source);
    expect(canonical(beautified.output)).toBe(expected);
    expect(canonical(minified.output)).toBe(expected);
  });
});

describe('formatGraphql: errors', () => {
  it("a syntax error throws with the parser's own line and column in both modes", async () => {
    const source = 'query {\n  a(\n}';
    for (const mode of ['beautify', 'minify'] as const) {
      try {
        await formatGraphql(source, { mode });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(GraphqlFormatterError);
        const e = err as GraphqlFormatterError;
        expect(e.message).toContain('Expected Name, found "}"');
        expect(e.line).toBe(3);
        expect(e.column).toBe(1);
      }
    }
  });

  it('empty string and a comments-only document are refused', async () => {
    await expect(formatGraphql('', { mode: 'beautify' })).rejects.toThrow(GraphqlFormatterError);
    await expect(formatGraphql('# just a comment', { mode: 'beautify' })).rejects.toThrow(GraphqlFormatterError);
  });

  it('10,000 nested selection sets throw the too-deeply-nested error, never a raw RangeError', async () => {
    const source = 'query{' + 'a{'.repeat(10_000) + '}'.repeat(10_000);
    for (const mode of ['beautify', 'minify'] as const) {
      try {
        await formatGraphql(source, { mode });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(GraphqlFormatterError);
        expect(err).not.toBeInstanceOf(RangeError);
        expect((err as GraphqlFormatterError).message).toBe('This document is nested too deeply to format.');
      }
    }
  });

  it('fragment variable definitions are refused (PD-5)', async () => {
    await expect(formatGraphql('fragment F($a: Int) on T { a }')).rejects.toThrow(GraphqlFormatterError);
  });
});

describe('formatGraphql: stats (PD-4)', () => {
  it('counts operations (including shorthand), fragments and named type definitions', async () => {
    const source =
      'query A { a }\n\n{ b }\n\nfragment F on T { a }\n\ntype T { a: String }\n\nenum E { X }\n\nextend type T { b: String }\n';
    const result = await formatGraphql(source, { mode: 'beautify' });
    expect(result.stats).toEqual({ operations: 2, fragments: 1, typeDefinitions: 2 });

    const minified = await formatGraphql(source, { mode: 'minify' });
    expect(minified.stats).toEqual({ operations: 2, fragments: 1, typeDefinitions: 2 });
  });
});

it('nothing is written to the console while beautifying or minifying', async () => {
  await formatGraphql('query Q { a }', { mode: 'beautify' });
  await formatGraphql('query Q { a }', { mode: 'minify' });
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});
