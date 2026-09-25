import { it, expect, vi } from 'vitest';
import { formatSql, SqlFormatterError, SQL_DIALECTS } from '../src/index';
import { minifySql } from '../src/minify';

/**
 * sql-formatter 15.9.0 README (fetched 2026-09-25 from the installed
 * package's own README.md), "Usage as library":
 *
 *   import { format } from 'sql-formatter';
 *   console.log(format('SELECT * FROM tbl', { language: 'mysql' }));
 *
 * "This will output:"
 *
 *   SELECT
 *     *
 *   FROM
 *     tbl
 */
const README_OUTPUT = 'SELECT\n  *\nFROM\n  tbl';

/**
 * A representative small corpus, valid in every dialect tested below and
 * carrying no comment of its own -- minifying deliberately removes an
 * ordinary comment (proven separately below), so a corpus entry that had
 * one would make format(minify(x)) differ from format(x) for a reason
 * that has nothing to do with token preservation, which is what this
 * oracle checks.
 */
const CORPUS = [
  'SELECT * FROM tbl WHERE id = 1',
  "SELECT a, b FROM t WHERE name = 'it''s here'",
  'SELECT a FROM t WHERE b = 2',
  'INSERT INTO t (a, b) VALUES (1, 2), (3, 4)',
  'SELECT a, b, c FROM t1 JOIN t2 ON t1.id = t2.id WHERE t1.x > 10 ORDER BY a',
];

it('formatting a minified query gives the same result as formatting the original for every tested dialect', () => {
  const dialects = ['sql', 'mysql', 'postgresql', 'sqlite', 'transactsql'];
  for (const dialect of dialects) {
    for (const query of CORPUS) {
      const minified = minifySql(query, dialect);
      const direct = formatSql(query, { mode: 'format', dialect }).output;
      const fromMinified = formatSql(minified, { mode: 'format', dialect }).output;
      expect(fromMinified, `dialect ${dialect}, query ${JSON.stringify(query)}`).toBe(direct);
    }
  }
});

it('string literals holding comment markers, quotes and line breaks survive minifying unchanged', () => {
  // From this plan's own behaviour spec: a single-quoted string holding a
  // line-comment marker, and a double-quoted identifier holding a block
  // comment opener, both survive; the trailing line comment is removed.
  const source = 'select \'a -- b\', "x/*y" from t -- note';
  const minified = minifySql(source, 'postgresql');
  expect(minified).toContain("'a -- b'");
  expect(minified).toContain('"x/*y"');
  expect(minified).not.toContain('note');

  const withDoubledQuote = "select 'it''s a test', 'line\nbreak' from t";
  const minified2 = minifySql(withDoubledQuote, 'sql');
  expect(minified2).toContain("'it''s a test'");
  expect(minified2).toContain("'line\nbreak'");

  const withBackslash = "select 'a\\'b' from t";
  const minifiedMysql = minifySql(withBackslash, 'mysql');
  expect(minifiedMysql).toContain("'a\\'b'");
});

it('PostgreSQL dollar-quoted strings survive formatting and minifying unchanged', () => {
  // PostgreSQL 17 documentation, "4.1.2.4. Dollar-Quoted String Constants"
  // (fetched 2026-09-25): "A dollar-quoted string constant consists of a
  // dollar sign ($), an optional 'tag' of zero or more characters, another
  // dollar sign, an arbitrary sequence of characters that makes up the
  // string content, a dollar sign, the same tag that began this dollar
  // quote, and a dollar sign. [...] no characters inside a dollar-quoted
  // string are ever escaped: the string content is always written
  // literally."
  const untagged = 'select $$ select 1; -- not a comment $$ as body';
  expect(minifySql(untagged, 'postgresql')).toContain('$$ select 1; -- not a comment $$');

  const tagged = 'select $fn$ select 1; $fn$ as body';
  expect(minifySql(tagged, 'postgresql')).toContain('$fn$ select 1; $fn$');

  const escapeStyle = "select E'foo' as x";
  expect(minifySql(escapeStyle, 'postgresql')).toContain("E'foo'");

  const formatted = formatSql(tagged, { mode: 'format', dialect: 'postgresql' }).output;
  expect(formatted).toContain('$fn$ select 1; $fn$');
});

it('MySQL backticks, hash comments and executable comments are handled in both modes', () => {
  const source = 'select `col` #comment\nfrom t /*! STRAIGHT_JOIN */';
  const minified = minifySql(source, 'mysql');
  expect(minified).toContain('`col`');
  expect(minified).not.toContain('comment');
  expect(minified).toContain('/*! STRAIGHT_JOIN */');

  const hint = 'select /*+ INDEX(t idx) */ * from t';
  expect(minifySql(hint, 'mysql')).toContain('/*+ INDEX(t idx) */');

  const formatted = formatSql('select `col` from `t`', { mode: 'format', dialect: 'mysql' }).output;
  expect(formatted).toContain('`col`');
  expect(formatted).toContain('`t`');
});

it('SQL Server bracket identifiers survive both modes', () => {
  // Microsoft Learn, "Database Identifiers" (fetched 2026-09-25): "Delimited
  // identifiers are enclosed in double quotation marks (") or brackets
  // ([ and ]) [...] SELECT * FROM [HumanResources].[Employee] --Delimiter is
  // optional."
  const source = 'select [order] from [dbo].[t]';
  expect(minifySql(source, 'transactsql')).toBe(source);
  const formatted = formatSql(source, { mode: 'format', dialect: 'transactsql' }).output;
  expect(formatted).toContain('[order]');
  expect(formatted).toContain('[dbo]');
  expect(formatted).toContain('[t]');

  const doubled = 'select [a]]b] from t';
  expect(minifySql(doubled, 'transactsql')).toContain('[a]]b]');
});

it('SQLite double-quoted, backticked and bracketed identifiers survive both modes', () => {
  // SQLite "Keywords" documentation (fetched 2026-09-25): "There are four
  // ways of quoting keywords in SQLite: 'keyword' [...] a string literal.
  // "keyword" [...] an identifier. [keyword] [...] an identifier. [...]
  // `keyword` [...] an identifier [...] used by MySQL and is included in
  // SQLite for compatibility."
  const source = 'select "a", `b`, [c] from t';
  const minified = minifySql(source, 'sqlite');
  expect(minified).toContain('"a"');
  expect(minified).toContain('`b`');
  expect(minified).toContain('[c]');

  const formatted = formatSql(source, { mode: 'format', dialect: 'sqlite' }).output;
  expect(formatted).toContain('"a"');
  expect(formatted).toContain('`b`');
  expect(formatted).toContain('[c]');
});

it('the sql-formatter README example gives the documented layout', () => {
  const result = formatSql('SELECT * FROM tbl', { mode: 'format', dialect: 'mysql' });
  expect(result.output).toBe(README_OUTPUT);
  expect(SQL_DIALECTS.some((d) => d.value === 'mysql')).toBe(true);
});

it('a query the chosen dialect cannot parse is refused with its line and column', () => {
  expect(() => formatSql('SELECT FROM WHERE (((', { mode: 'format', dialect: 'mysql' })).toThrow(SqlFormatterError);
  try {
    formatSql('SELECT FROM WHERE (((', { mode: 'format', dialect: 'mysql' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(SqlFormatterError);
    expect((err as SqlFormatterError).line).toBe(1);
    expect((err as SqlFormatterError).column).toBeGreaterThan(0);
  }
});

it('keyword case follows the chosen option and identifiers are never changed', () => {
  const upper = formatSql('select COL1 from Tbl', { mode: 'format', dialect: 'mysql', keywordCase: 'upper' }).output;
  expect(upper).toContain('SELECT');
  expect(upper).toContain('FROM');
  expect(upper).toContain('COL1');
  expect(upper).toContain('Tbl');

  const lower = formatSql('SELECT COL1 FROM Tbl', { mode: 'format', dialect: 'mysql', keywordCase: 'lower' }).output;
  expect(lower).toContain('select');
  expect(lower).toContain('from');
  expect(lower).toContain('COL1');
  expect(lower).toContain('Tbl');
});

it('nothing is written to the console while formatting', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const mocks = spies.map((name) => vi.spyOn(console, name).mockImplementation(() => {}));

  try {
    formatSql('SELECT * FROM tbl', { mode: 'format', dialect: 'mysql' });
    formatSql('select `col` #c\nfrom t', { mode: 'minify', dialect: 'mysql' });
    try {
      formatSql('SELECT FROM WHERE (((', { mode: 'format', dialect: 'mysql' });
    } catch {
      // malformed input; only console silence is under test here
    }

    for (const mock of mocks) {
      expect(mock).not.toHaveBeenCalled();
    }
  } finally {
    vi.restoreAllMocks();
  }
});

it('a token joining guard keeps minus signs, slash-star and adjacent words apart', () => {
  expect(minifySql('a - - b', 'sql')).toBe('a - - b');
  expect(minifySql('a / * b', 'sql')).toBe('a / * b');
  expect(minifySql('a b', 'sql')).toBe('a b');
  expect(minifySql('select ( a , b ) ;', 'sql')).toBe('select(a,b);');
});
