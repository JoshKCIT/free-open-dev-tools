# String Literal Escaper

Escape and unescape string literals for JavaScript, Java, C#, Python, Go, SQL, CSV, POSIX shell, regular expressions and XML.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Escapes plain text into a string literal for nine languages, or into XML element content or an XML attribute value, or unescapes a literal back to plain text. This escapes the contents of one literal, not a whole program or document. Unescaping is a strict left-to-right reader: malformed input is refused with the exact position of the problem, never guessed at.

## Supported

- JavaScript / TypeScript (ECMA-262 string literals, Annex B legacy octal escapes): double or single quote, escape-non-ASCII, one-literal-per-line
- Java (JLS SE 21 sections 3.3 and 3.10.7): the standard escape table, Unicode escape translation, octal escapes on the way in
- C# (the C# language specification's string literal grammar): regular literals with \uXXXX/\UXXXXXXXX/\x, and verbatim (@"...") literals
- Python (Language Reference 2.4.1/2.4.2): single or double quote, \xHH/\uXXXX/\UXXXXXXXX, octal escapes
- Go (the Go specification's rune and string literals): byte escapes \ooo/\xHH and code-point escapes \uXXXX/\UXXXXXXXX, with UTF-8 validation on the way in
- SQL: standard '' quote doubling, or MySQL/MariaDB backslash escapes
- CSV field (RFC 4180 section 2): quoting only when the delimiter, a quote, or a line break is present
- POSIX shell (POSIX.1-2017 section 2.2): single-quoting on the way out, and reading unquoted/single-quoted/double-quoted words on the way in
- Regular expression (ECMA-262 SyntaxCharacter): escaping the characters that are always special in a pattern, plus /
- One literal per line for JavaScript, Java, C# (regular), Python and Go, joined the way each language actually writes multi-line concatenation
- XML element content (XML 1.0 sections 2.4 and 4.6): ampersand, less-than and greater-than written as references, so the sequence that ends a CDATA section never appears
- XML attribute value: also the chosen quote as &quot; or &apos;, and tab, line feed and carriage return as &#9;, &#10; and &#13; so they are not read back as spaces, with or without the surrounding quotes
- XML on the way in: the five predefined entities and decimal or hexadecimal character references only, with raw line breaks and tabs read the way an XML reader reads them

## Limits

- SQL escaping is not a defence against SQL injection. Use parameterised queries; this tool is for building literals by hand, such as in a migration script or a one-off query.
- Forms that mix code and literal text are refused rather than guessed at: JavaScript template literals, Java text blocks, C# interpolated and raw strings, Python triple-quoted strings and the r/b/f prefixes, Go raw (backtick) strings, and PostgreSQL E'...' strings.
- Python's \N{...} named-character escape is refused: this tool bundles no Unicode name table.
- C1 controls and other invisible non-ASCII characters are left raw unless "escape non-ASCII" is turned on.
- Go cannot represent a lone (unpaired) surrogate: Go strings are UTF-8, and a surrogate has no UTF-8 form, so escaping one throws.
- CSV escaping only quotes a field correctly; it does not neutralise spreadsheet formula injection (values starting with =, +, -, @).
- The regular-expression output is meant for use outside a character class, and a raw line break cannot sit inside a /.../ literal.
- POSIX shell unescape refuses anything only a live shell could evaluate ($, backtick, globs, unquoted metacharacters, a leading ~ or #); it never guesses what a shell would have expanded that to.
- XML contexts follow XML 1.0: element content escapes &, < and >; attribute values also escape the quote and write tab, line feed and carriage return as references.
- Characters XML 1.0 does not allow (control characters other than tab, line feed and carriage return, U+FFFE, U+FFFF and lone surrogates) cannot be written, even as references, and are refused with their position.
- XML unescape reads only the five predefined entities and numeric references; any other entity, a bare ampersand, a raw less-than and, inside a quoted attribute value, the closing quote are refused, since no DTD is read.

## Ambiguous cases, and what this does about them

- Java leaves a single quote (') raw inside a string literal, exactly as JLS 3.10.5 allows; \' is still accepted on the way in.
- MySQL's NO_BACKSLASH_ESCAPES sql_mode turns off backslash escaping entirely; when that mode is in effect, use the standard SQL style instead of the MySQL style.
- POSIX shell reads {, } and ! literally, as a plain POSIX sh does. bash/zsh brace expansion and history expansion are not modelled.
- JavaScript's legacy octal escapes (Annex B) are accepted on unescape with a warning rather than refused, because real code in the wild still uses them outside strict mode.
- Python keeps an unrecognised escape such as \q as the two characters \ and q, exactly as CPython itself does, with a warning rather than an error.
- A raw carriage return in XML element content is written as it is, and an XML reader turns it into a line feed (XML 1.0 section 2.11), so it is warned about; in an attribute value it is written as &#13; and kept.
- XML escaping leaves non-ASCII characters as written unless "escape non-ASCII" is turned on, which writes each one as a single hexadecimal reference, so a character beyond the Basic Multilingual Plane is one reference and never two.

## Defined by

- [ECMA-262, String Literals](https://tc39.es/ecma262/#sec-literals-string-literals)
- [ECMA-262, Annex B.1.2 String Literals (legacy octal escapes)](https://tc39.es/ecma262/#sec-additional-syntax-string-literals)
- [ECMA-262, Patterns (SyntaxCharacter)](https://tc39.es/ecma262/#sec-patterns)
- [Java Language Specification SE 21, chapter 3 (sections 3.3 Unicode Escapes, 3.10.7 Escape Sequences; numbered 3.10.6 in SE 8 and earlier)](https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html)
- [C# language specification, Lexical structure, string literals](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/lexical-structure)
- [Python Language Reference, 2.4.1/2.4.2 String and Bytes literals, Escape sequences](https://docs.python.org/3/reference/lexical_analysis.html#string-and-bytes-literals)
- [The Go Programming Language Specification, Rune literals and String literals](https://go.dev/ref/spec#String_literals)
- [PostgreSQL Documentation, String Constants](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-STRINGS)
- [MySQL Reference Manual, String Literals](https://dev.mysql.com/doc/refman/8.4/en/string-literals.html)
- [RFC 4180, Common Format and MIME Type for CSV Files, section 2](https://www.rfc-editor.org/rfc/rfc4180#section-2)
- [POSIX.1-2017, Shell Command Language, section 2.2 Quoting](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html#tag_18_02)
- [Extensible Markup Language (XML) 1.0 (Fifth Edition), sections 2.2, 2.4, 3.3.3 and 4.6](https://www.w3.org/TR/xml/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/string-escape string-escape
cd string-escape
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/string-escape
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { escapeLiteral, unescapeLiteral, LANGUAGES } from '@fodt/string-escape';

escapeLiteral('Line one\nSays "hi"', { language: 'javascript' }).value;
unescapeLiteral('"caf\\xe9 \\x41\\101"', { language: 'python' }).value;
```

Both functions return { value, warnings }. `position` on a thrown StringEscapeError, and on every warning, is a UTF-16 index into the input string. The Go module additionally sets `byteOffset` on the error when the problem was found while validating the accumulated bytes as UTF-8, rather than while parsing an escape sequence. All hexadecimal output is upper case. The two XML contexts are the languages `xml-text` and `xml-attribute`, listed in `XML_LANGUAGES` (kept apart from `LANGUAGES`, which still holds the nine original languages); `escapeXml` and `unescapeXml` are also exported from the package's `xml` module.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Each language's escape table is transcribed by hand from the cited specification section and asserted in both directions. The regular-expression module is additionally checked against a live JavaScript RegExp: for every corpus string without a lone surrogate, escaping it and wrapping it in ^(?:...)$ matches the original text under the '', 'u' and 'v' flags. The XML contexts are asserted against XML 1.0 and against Python's xml.sax.saxutils escape and quoteattr, with output from Python lxml for how a reader reads references and raw whitespace back, and a sample from every Unicode plane round-trips. A round-trip suite runs every language over a shared corpus (every C0 control, DEL, both quote characters, backslashes, CRLF, U+0085, U+2028, U+2029, an accented letter, an astral character, U+10FFFF, and lone surrogates where representable).

## Licence

MIT. See [LICENSE](./LICENSE).
