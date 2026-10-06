# SPF & DMARC Record Checker & Builder

Check an SPF or DMARC record term by term, count the DNS lookups against the limit of 10 without making any, and build either record from fields.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Paste an SPF record, bare or as a zone-file TXT line, and read each term with its position, every syntax error by character position, and the terms that cause DNS lookups counted against the limit of 10 in RFC 7208 section 4.6.4, or build an SPF record from fields. The page reads only the text you give it and never queries DNS, so nothing is looked up and nothing is sent.

## Supported

- A bare SPF record, or a zone-file TXT line: a name, an optional time to live and class, the word TXT and one or more quoted strings, joined with no space added between them as RFC 7208 section 3.3 says, with the parenthesis form over several lines, comment lines, and the escapes backslash-quote, double backslash and a backslash with three digits
- The whole grammar of RFC 7208 section 12: the version v=spf1, the qualifiers + - ? and ~, the mechanisms all, include, a, mx, ptr, ip4, ip6 and exists, the modifiers redirect and exp (each at most once), unknown modifiers (ignored wherever they appear), domain specifications with the toplabel rule, macros with their letters, digit and reverse transformers and delimiters, and the dual prefix lengths of a and mx
- The terms that cause DNS lookups, counted against the limit of 10 of RFC 7208 section 4.6.4: include, a, mx, ptr, exists and redirect count, and all, ip4, ip6 and exp do not; a redirect that sits beside an all is ignored and not counted, and terms after an all are listed as never tested
- IPv4 and IPv6 address literals checked by the grammar of the RFC (no leading zeros in a dotted number, prefix lengths up to 32 and up to 128, no zone id), with every error named by its character position
- Notes on the size of the record (keep it under 450 octets, one string holds at most 255 octets), on +all, ?all and ~all, on ptr, on a record with no all and no redirect, on repeated terms and on the extra address lookups an mx term can cause
- An SPF builder: addresses, networks, includes, a, mx and an ending of -all, ~all, ?all or a redirect, written in a fixed order and checked by the same parser before it is shown

## Limits

- This page reads only the text you paste. It never queries DNS, so it cannot see whether an included name exists, how many addresses an mx term really expands to, whether a name returns an empty answer, or what a receiver would decide for a message.
- The count of 10 covers the records you paste: terms are counted with no lookup made. A record that an include or a redirect points to adds its own terms, which this page cannot see unless you paste that record too.
- A record that checks clean here can still fail in practice: it does not mean mail will be delivered or that SPF will pass for a message, which depends on the sending server and the address it uses.
- A paste is limited to 65,536 characters per box, 100 records and 16,384 characters in one record; the table of terms shows at most 500 rows and says how many were left out. A larger input is refused before any work, naming the box and the position and never repeating what was typed.
- Tab and other white space between terms is a syntax error here, because RFC 7208 separates terms by spaces only; curly quotes in a pasted zone line are replaced with straight quotes and the page says so.

## Ambiguous cases, and what this does about them

- RFC 7208 allows more than one space between terms and trailing spaces, so they are accepted; a tab, a line break or any other character in place of a space is a syntax error.
- The grammar's macro letters c, r and t are written for explanation text only (section 7.2), so they are refused in a domain specification and in a modifier value, as the OpenSPF test suite expects.
- The grammar accepts a number from 0 to 99 as an IPv4 prefix length and 0 to 999 as an IPv6 one, and the text then limits them to 32 and 128; both rules are applied and the error names the one that was broken.

## Defined by

- [RFC 7208: Sender Policy Framework (SPF) for Authorizing Use of Domains in Email, Version 1](https://www.rfc-editor.org/rfc/rfc7208)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/spf-dmarc spf-dmarc
cd spf-dmarc
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/spf-dmarc
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { parseSpf, checkSpf } from '@fodt/spf-dmarc';

// RFC 7208 section 4.6.4: a, mx and two includes are four terms that cause DNS lookups
const report = checkSpf(parseSpf('v=spf1 a mx include:example.com include:example.org -all'));

report.lookupCount; // 4
report.withinLimit; // true
```

`parseSpf(text)` reads one record in a single pass and returns its terms in record order, each with `start` and `end` (1-based character positions in the record), its qualifier, kind, name and arguments, and a list of errors that each hold a message and a position; a record that does not start with v=spf1 followed by a space or the end reports that and has no terms. `checkSpf(record)` returns the lookup terms and their count against `LOOKUP_LIMIT`, the terms never tested and the notes. `readTxtRecords(text)` reads a bare record or zone-file lines into labelled records. A refusal is an `SpfDmarcError` whose message names the part and the position and never holds typed text; the package keeps no state between calls, makes no request and prints nothing.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Expected values come from RFC 7208: the literals of sections 3.3, 3.4, 4.5, 4.6, 4.6.4, 5, 6 and 12 and every example record the RFC prints, retyped with their section in the test title. The first test group holds the tracer rows: a, mx and two includes count as 4 of 10, an empty box shows nothing, and a refusal never repeats typed text.

## Licence

MIT. See [LICENSE](./LICENSE).
