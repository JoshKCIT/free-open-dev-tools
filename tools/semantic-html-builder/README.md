# Semantic HTML Element Builder

Build details and summary, dialog, meter, progress, quotations with citations, figures with captions, time, abbreviations and the text-level tags, with a preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds one semantic HTML element and shows its markup first, ready to copy, with a live preview of the same markup after it. You pick the element and the page offers only what the HTML Living Standard defines for it. This first edition writes the time element: the machine-readable value, whether you type it in the datetime attribute or leave it as the text, is checked against every form the standard allows (a year, a month, a date, a time, a local or global date and time, a week, a time-zone offset or a duration), so an impossible date such as 2011-13-45 is refused instead of copied. The preview shows the element without loading anything you typed. The standard was read on 2026-10-01 (last updated 2026-09-29); a later edition may differ.

## Supported

- A time element whose datetime attribute, or its text when no attribute is typed, matches one of the forms WHATWG 4.5.14 lists: a month, date, yearless date, time, local date and time, time-zone offset, global date and time, week, year or duration
- Every date and time example of the standard is accepted, and impossible values are refused naming the field: month 13, February 29 in a common year, hour 24, second 60, four fraction digits and a minus zero offset
- Numbers, dates and times are read as ASCII digits only, in the letter case the grammar writes; digits of other scripts are refused
- Markup first and an inert preview of the same element second, with any warning in a note

## Limits

- Everything you type is escaped before it is placed in the markup, so a tag, an event handler or a script address you type stays text; a javascript:, data: or vbscript: address is kept as typed and flagged.
- The preview replaces every address you typed (src, srcset, poster, href, action, formaction, data and cite) with an inert placeholder or removes it, so nothing you typed is loaded; only the markup you copy keeps the real addresses.
- Each text field is limited to 20,000 characters, and control characters other than a tab (and line breaks in a text area) are refused because HTML cannot carry them.
- The builder writes one element per run and writes only the attributes you choose; it never adds an attribute for you.

## Ambiguous cases, and what this does about them

- A time element may carry the machine-readable value in its datetime attribute or, when there is none, in its text; this builder checks whichever one holds the value, and refuses text that is not a valid value when no datetime is typed.
- A year in the standard is four or more ASCII digits that are not all zero, so 0037 is a valid year while 37 is not.

## Defined by

- [HTML Living Standard, 4.5.14 The time element](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-time-element)
- [HTML Living Standard, 2.3.5 Dates and times](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#dates-and-times)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/semantic-html-builder semantic-html-builder
cd semantic-html-builder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/semantic-html-builder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildElement } from '@fodt/semantic-html-builder';

const built = buildElement({
  element: 'time',
  content: '18 November 2011',
  datetime: '2011-11-18T14:54:39.929Z',
});
built?.html;
// <time datetime="2011-11-18T14:54:39.929Z">18 November 2011</time>
```

`buildElement(spec)` returns `{ tree, html, preview, warnings }`, or `null` when every field it reads is blank. `html` is the copyable markup and `preview` is the same tree with every address removed. A refused value throws `MarkupError` with a `field` (the label the page shows) and a `message`.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every generated snippet is parsed with parse5 and must report zero parse errors. The date and time examples of WHATWG 2.3.5 and 4.5.14 are checked literally, impossible values must be refused, and hostile text typed into every field must leave the parsed element tree unchanged.

## Licence

MIT. See [LICENSE](./LICENSE).
