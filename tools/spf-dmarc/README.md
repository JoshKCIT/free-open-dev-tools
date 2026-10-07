# SPF & DMARC Record Checker & Builder

Check an SPF or DMARC record term by term, count the DNS lookups against the limit of 10 without making any, and build either record from fields.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Paste an SPF record or a DMARC record, bare or as a zone-file TXT line, and read each term or tag with its meaning, every syntax error by character position, and for SPF the terms that cause DNS lookups counted against the limit of 10 in RFC 7208 section 4.6.4; or build either record from fields. DMARC records are read under RFC 9989: every tag with its default, the policy that applies to the domain, its subdomains and its non-existent subdomains, and the report addresses as written. The page reads only the text you give it and never queries DNS, so nothing is looked up and nothing is sent.

## Supported

- A bare SPF record, or a zone-file TXT line: a name, an optional time to live and class, the word TXT and one or more quoted strings, joined with no space added between them as RFC 7208 section 3.3 says, with the parenthesis form over several lines, comment lines, and the escapes backslash-quote, double backslash and a backslash with three digits
- The whole grammar of RFC 7208 section 12: the version v=spf1, the qualifiers + - ? and ~, the mechanisms all, include, a, mx, ptr, ip4, ip6 and exists, the modifiers redirect and exp (each at most once), unknown modifiers (ignored wherever they appear), domain specifications with the toplabel rule, macros with their letters, digit and reverse transformers and delimiters, and the dual prefix lengths of a and mx
- The terms that cause DNS lookups, counted against the limit of 10 of RFC 7208 section 4.6.4: include, a, mx, ptr, exists and redirect count, and all, ip4, ip6 and exp do not; a redirect that sits beside an all is ignored and not counted, and terms after an all are listed as never tested
- IPv4 and IPv6 address literals checked by the grammar of the RFC (no leading zeros in a dotted number, prefix lengths up to 32 and up to 128, no zone id), with every error named by its character position
- Notes on the size of the record (keep it under 450 octets, one string holds at most 255 octets), on +all, ?all and ~all, on ptr, on a record with no all and no redirect, on repeated terms and on the extra address lookups an mx term can cause
- A whole-tree count: further lines of the SPF box are records with their names (name: v=spf1 ... or a zone-file line), and the count follows include and redirect through them only, in evaluation order, with a loop cut at once and named, a name that was not pasted listed, and counting stopped at 11
- An SPF builder: addresses, networks, includes, a, mx and an ending of -all, ~all, ?all or a redirect, written in a fixed order and checked by the same parser before it is shown; an entry typed with the prefix the builder writes itself (include:, redirect=, ip4: or ip6:) is kept without it and the page says so
- A bare DMARC record, or a zone-file TXT line with several quoted strings (the form of the RFC 9989 Appendix B examples, comment lines included): the tags are listed in record order with their value, meaning, default and status, then every tag the record does not hold with its default, in the order of RFC 9989 Table 2
- The policy a receiver reads for the domain, for its existing subdomains (sp, else p) and for its non-existent subdomains (np, else sp, else p), and the report addresses of rua and ruf as written
- pct, rf and ri are marked retired in RFC 9989, never as syntax errors
- Every tag checked against the rules of RFC 9989 section 4.8: v must come first and is case sensitive (v=dmarc1 makes the whole record ignored), p, sp and np take none, quarantine or reject, t takes y or n, psd takes y, n or u, adkim and aspf take r or s, fo takes 0, 1, d and s separated by colons with 0 and 1 never together and d and s at most once, and a wrong value is ignored with its default used
- A repeated tag (the first value is used and the repeat is reported), two DMARC records in the box (all discarded, RFC 9989 section 4.10), an empty element between two semicolons (ignored and noted), one trailing semicolon (valid), and tag names such as constructor and toString (plain names)
- Report addresses: each mailto address is checked for a mailbox and a domain, other schemes are kept as written, and the obsolete size suffix such as !10m is flagged and ignored; with the domain typed, the name another domain must publish for an address outside it is written exactly, for example example.com._report._dmarc.thirdparty.example.net with the value v=DMARC1; (RFC 9989 Appendix B.2.3 and RFC 9990 section 4)
- A DMARC builder that writes only RFC 9989 tags (never pct, rf or ri) in a fixed order, turns a bare report address into a mailto address, offers t=y, shows the RFC 9989 section 7.4 advice for p=reject as advice and never an error, and shows the record on one line and in zone-file form, split into strings of at most 255 octets that join back to the same record; the SPF builder shows its zone form too

## Limits

- This page reads only the text you paste. It never queries DNS, so it cannot see whether an included name exists, how many addresses an mx term really expands to, whether a name returns an empty answer, or what a receiver would decide for a message.
- The count of 10 covers the records you paste: terms are counted with no lookup made. A record that an include or a redirect points to adds its own terms, which this page cannot see unless you paste that record too, on its own line with its name (name: v=spf1 ... or a zone-file line). The whole-tree count then follows include and redirect through the records you pasted only; a name you did not paste, or a name that holds a macro, makes the count a lower bound, and counting stops at 11 and reads 11 or more.
- A record that checks clean here can still fail in practice: it does not mean mail will be delivered or that SPF will pass for a message, which depends on the sending server and the address it uses.
- A paste is limited to 65,536 characters per box, 100 records and 16,384 characters in one record; the table of terms shows at most 500 rows and says how many were left out. A larger input is refused before any work, naming the box and the position and never repeating what was typed.
- Tab and other white space between terms is a syntax error here, because RFC 7208 separates terms by spaces only; curly quotes in a pasted zone line are replaced with straight quotes and the page says so.
- DMARC is checked against RFC 9989 (May 2026). Receivers that still follow RFC 7489 also read pct, rf and ri; the page marks them retired, not wrong. The DNS tree walk that finds the record is not performed, and a record that checks clean here can still fail in practice: it does not mean mail will be delivered or that DMARC will pass for a message.
- The page cannot see whether a report address in another domain has published the record that authorises it, so it writes the name to look for and nothing more. It has no list of public suffixes, so it compares domain names only: an address in a sibling subdomain of your own organization still shows a name that is not needed.
- RFC 9989 does not say whether tag names are case sensitive or what a repeated tag means, so tag names are read in lower case and the first value of a repeated tag is used. Tags and addresses that are not valid are ignored as RFC 9989 section 4.8 says, and an invalid p, sp or np reads as p=none as section 4.10.1 says; the page shows what the text says, not what every receiver does.

## Ambiguous cases, and what this does about them

- RFC 7208 allows more than one space between terms and trailing spaces, so they are accepted; a tab, a line break or any other character in place of a space is a syntax error.
- The grammar's macro letters c, r and t are written for explanation text only (section 7.2), so they are refused in a domain specification and in a modifier value, as the OpenSPF test suite expects.
- The grammar accepts a number from 0 to 99 as an IPv4 prefix length and 0 to 999 as an IPv6 one, and the text then limits them to 32 and 128; both rules are applied and the error names the one that was broken.
- RFC 9989 does not say whether tag names are case sensitive or what a repeated tag means. The page reads names in lower case, so P=none is an unknown tag that is ignored, and when a tag repeats the first value is used and the repeat is reported.
- RFC 9989 section 4.8 says syntax errors in the rest of a record are discarded in favour of default values, while section 4.10.1 says a record whose p, sp or np is not valid is read as p=none when rua holds a valid address and otherwise gets no DMARC processing. The page follows section 4.10.1 for those three tags and shows each effective policy as none.
- When a rua or ruf tag holds several addresses and only some are usable, the tag is kept and the unusable ones are listed; a tag with no usable address is ignored as a whole.
- RFC 9989 Appendix B.2.3 sends the reader to section 3 of RFC 9990 for the checks on addresses in other domains; in the published text of RFC 9990 those checks are section 4, which is the section this page cites.

## Defined by

- [RFC 7208: Sender Policy Framework (SPF) for Authorizing Use of Domains in Email, Version 1](https://www.rfc-editor.org/rfc/rfc7208)
- [RFC 9989: Domain-Based Message Authentication, Reporting, and Conformance (DMARC)](https://www.rfc-editor.org/rfc/rfc9989)
- [RFC 9990: Domain-Based Message Authentication, Reporting, and Conformance (DMARC) Aggregate Reporting](https://www.rfc-editor.org/rfc/rfc9990)

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
import { parseSpf, checkSpf, parseDmarc, checkDmarc, buildDmarc, toZoneForm } from '@fodt/spf-dmarc';

// RFC 7208 section 4.6.4: a, mx and two includes are four terms that cause DNS lookups
const spf = checkSpf(parseSpf('v=spf1 a mx include:example.com include:example.org -all'));
spf.lookupCount; // 4

// RFC 9989 Appendix B.2.3: reports go to a third party, which must publish v=DMARC1; at the name below
const dmarc = checkDmarc(
  parseDmarc('v=DMARC1; p=none; ruf=mailto:auth-reports@thirdparty.example.net'),
  'example.com',
);
dmarc.policy.domain; // 'none'
dmarc.authorisations[0]?.name; // 'example.com._report._dmarc.thirdparty.example.net'

const built = buildDmarc({
  policy: 'quarantine', subPolicy: 'inherit', nonExistent: 'inherit', adkim: 'r', aspf: 'r',
  rua: 'dmarc-feedback@example.com', ruf: '', fo: '0', test: true,
});
built.record; // 'v=DMARC1; p=quarantine; rua=mailto:dmarc-feedback@example.com; t=y'
toZoneForm('_dmarc', built.record); // '_dmarc IN TXT "v=DMARC1; ..."'
```

`parseSpf(text)` reads one record in a single pass and returns its terms in record order, each with `start` and `end` (1-based character positions in the record), its qualifier, kind, name and arguments (the domain, the address and the prefix lengths), and a list of problems that each hold a fixed message and a position; a record that does not start with v=spf1 followed by a space or the end reports that and has no terms. `checkSpf(record, strings?)` returns the terms that cause lookups and their count against `LOOKUP_LIMIT`, the terms never tested, whether a redirect was ignored, the size in octets and the notes; the optional strings are the quoted strings a zone-file line was read from. `readTxtRecords(text, part)` reads a bare record, a labelled record or zone-file lines (the parenthesis form, comments, escapes) into records with their labels. `countLookups(records, mainIndex)` follows include and redirect through the labelled records given, cutting a loop and listing a name that is missing. `spfVerdict(report, tree)` gives the one-line verdict the page shows: a warning when the first record has a syntax error or more than 10 lookups, or when the records pasted with it take the whole-tree count over 10, and otherwise a success that says when the whole-tree count is a lower bound. `buildSpf(fields)` writes a record in a fixed order and returns the problems it left out and, in `adjusted`, the entries it kept after dropping a prefix it writes itself (include:, redirect=, ip4: or ip6:). A refusal is an `SpfDmarcError` whose message names the part and the position and never holds typed text; the package keeps no state between calls, makes no request and prints nothing. `parseDmarc(text)` reads one DMARC record in a single pass and returns its tags in record order, then every tag the record does not hold with its default in the order of RFC 9989 Table 2; each tag has a value, a meaning, a default, a position and a status of ok, default-used, retired, unknown, invalid or repeated, and `byName` is a Map of the first copy of each tag. `checkDmarc(record, domain?)` returns the effective policy for the domain, for its subdomains and for its non-existent subdomains, the usable report addresses, for a domain given the name another domain must publish for each address outside it, and notes; a domain that is not a name is refused with an `SpfDmarcError` whose part is domain. `pickDmarcRecord(records)` sets aside what RFC 9989 section 4.10 discards (all records when more than one starts with v=DMARC1). `buildDmarc(fields)` writes only RFC 9989 tags in a fixed order and returns the addresses it left out and advice; `toZoneForm(name, text)` writes a TXT line, splitting a long record into strings of at most 255 octets.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Expected values come from RFC 7208: the literals of sections 3.3, 3.4, 4.5, 4.6, 4.6.4, 5, 6 and 12 and every example record the RFC prints, retyped with their section in the test title, and the boundaries it states (10 and 11 lookup terms, 450 octets, a 255 octet string, prefix lengths 32 and 128). The OpenSPF rfc7208 test suite (pyspf commit 4bf96ea63af4999663809bae9b5530bce25e6f16, three files vendored unedited under its BSD-style licence, their git blob SHAs checked by a test) is used for syntax only: of 189 cases whose domain holds exactly one record, 139 were curated by hand, 76 valid and 63 syntax errors, each with a reviewed mark and a reason, and the 50 left out are listed with theirs. Node net isIPv4 and isIPv6 are the second opinion for the address checks over a seeded corpus, with one named difference: Node accepts a zone id after an IPv6 address, which the grammar has no place for. Records pasted with names, loops, missing names, repeated routes and the stop at 11 are tested for the whole-tree count. Modifier names such as constructor and toString, refusals that never repeat typed text and every parser on hostile strings at two sizes are tested. The DMARC half is grounded on RFC 9989 (May 2026): the Appendix B records are retyped with their section and read through the zone-file reader, the tag rules come from sections 4.7, 4.8 and 4.10, the retired tags from Appendix C.5.2, the advice from section 7.4, and the authorisation name from Appendix B.2.3 and RFC 9990 section 4 (the example of blue.example.com and red.example.net is retyped). Defaults and Table 2 order, v rules, repeats, two records, fo, empty elements, address checks, wrong values, the builder over a seeded run of 300 field sets, the zone form at 255, 256, 510 and 511 octets with a read back, tag names such as constructor and toString, refusals that never repeat typed text and every parser on hostile strings at two sizes are tested.

## Licence

MIT. See [LICENSE](./LICENSE).
