# Semantic HTML Element Builder

Build details and summary, dialog, meter, progress, quotations with citations, figures with captions, time, abbreviations and the text-level tags, with a preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds one semantic HTML element and shows its markup first, ready to copy, with a live preview of the same markup after it. You pick the element and the page offers only what the HTML Living Standard defines for it, and refuses a value the standard does not allow instead of copying it. This edition writes details with its summary, a dialog with a close form, a meter, a progress bar and the time element. A meter or progress bar always gets a label tied to it, so it has an accessible name, and a time value is checked against every date and time form the standard allows. The preview shows the element without loading anything you typed. The standard was read on 2026-10-01 (last updated 2026-09-29); a later edition may differ.

## Supported

- details with exactly one summary first and then the content as paragraphs (blank lines separate them), with open and a group name written only when you choose them
- dialog with its content, an optional id, open, a closedby value from any, closerequest or none, and a close form with method dialog and a button whose text you can change; a tabindex is never written because the standard forbids one on a dialog
- meter with a required value and the min, max, low, high, optimum and title attributes, every number a valid floating-point number and all five ordering rules of WHATWG 4.10.14 checked, with the minimum 0 and the maximum 1 when you leave them blank
- progress with a value between 0 and its max, a max above zero, or no value at all for an indeterminate bar, with a note saying what that means
- A label tied to every meter and progress bar by for and id, so each has an accessible name (HTML-AAM 4.1.7); the id is worked out from the label when you leave it blank
- A time element whose datetime attribute, or its text when no attribute is typed, matches one of the forms WHATWG 4.5.14 lists: a month, date, yearless date, time, local date and time, time-zone offset, global date and time, week, year or duration
- Every date and time example of the standard is accepted, and impossible values are refused naming the field: month 13, February 29 in a common year, hour 24, second 60, four fraction digits and a minus zero offset
- Numbers, dates and times are read as ASCII digits only, in the letter case the grammar writes; digits of other scripts are refused
- Markup first and an inert preview of the same element second, with any warning in a note

## Limits

- Everything you type is escaped before it is placed in the markup, so a tag, an event handler or a script address you type stays text; a javascript:, data: or vbscript: address is kept as typed and flagged.
- The preview replaces every address you typed (src, srcset, poster, href, action, formaction, data and cite) with an inert placeholder or removes it, so nothing you typed is loaded; only the markup you copy keeps the real addresses.
- Each text field is limited to 20,000 characters, details and dialog content to 50 paragraphs, and control characters other than a tab (and line breaks in a text area) are refused because HTML cannot carry them.
- The builder writes one element per run and writes only the attributes you choose; it never adds an attribute for you. Details elements that share a group name open one at a time in the browser, so to build a group, build each details element in turn with the same group name and open at most one of them.
- The preview shows a closed dialog open so you can see it, while the copied markup keeps your choice. The close button in the preview closes the dialog only in some browsers, because the preview frame blocks form submission; the copied markup is not affected.
- A meter or progress bar needs a label here, which the standard does not require, so that every gauge has an accessible name; the label is written as a label element tied by for and id, never as hidden text.
- Single line breaks inside a paragraph are kept as typed and a browser shows them as spaces; a blank line starts a new paragraph.

## Ambiguous cases, and what this does about them

- A time element may carry the machine-readable value in its datetime attribute or, when there is none, in its text; this builder checks whichever one holds the value, and refuses text that is not a valid value when no datetime is typed.
- A year in the standard is four or more ASCII digits that are not all zero, so 0037 is a valid year while 37 is not.
- The standard says a details name must not be the empty string; a name made only of spaces is not the empty string to a parser but means nothing, so it is refused.
- When the minimum is greater than the maximum of a meter, no value can satisfy the standard's ordering rules, so the value is refused with the range in the message.
- The standard allows a meter without fallback text inside it; the text field is optional here and the element is written empty when it is blank.

## Defined by

- [HTML Living Standard, 4.11.1 The details element](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element)
- [HTML Living Standard, 4.11.2 The summary element](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-summary-element)
- [HTML Living Standard, 4.11.4 The dialog element](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element)
- [HTML Living Standard, 4.10.13 The progress element](https://html.spec.whatwg.org/multipage/form-elements.html#the-progress-element)
- [HTML Living Standard, 4.10.14 The meter element](https://html.spec.whatwg.org/multipage/form-elements.html#the-meter-element)
- [HTML Living Standard, 4.5.14 The time element](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-time-element)
- [HTML Living Standard, 2.3.4 Numbers](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#numbers)
- [HTML Living Standard, 2.3.5 Dates and times](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#dates-and-times)
- [HTML Accessibility API Mappings 1.0, 4.1.7 Other form elements accessible name computation](https://www.w3.org/TR/html-aam-1.0/)

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
import { buildElement, checkMeter } from '@fodt/semantic-html-builder';

const gauge = buildElement({ element: 'meter', label: 'Disk usage', value: '0.6', content: '60 percent' });
gauge?.html;
// <label for="disk-usage">Disk usage</label>
// <meter id="disk-usage" value="0.6">60 percent</meter>

checkMeter({ value: '0.6', low: '0.8', high: '0.2' });
// throws MarkupError: Low is above High

const when = buildElement({
  element: 'time',
  content: '18 November 2011',
  datetime: '2011-11-18T14:54:39.929Z',
});
when?.html;
// <time datetime="2011-11-18T14:54:39.929Z">18 November 2011</time>
```

`buildElement(spec)` returns `{ tree, html, preview, warnings }`, or `null` when every text field it reads is blank. `html` is the copyable markup and `preview` is the same tree with every address removed (and a closed dialog shown open). A refused value throws `MarkupError` with a `field` (the label the page shows) and a `message`. `checkMeter({ value, min, max, low, high, optimum })` and `checkProgress({ value, max })` take the typed strings, throw `MarkupError` naming the field and the broken rule, and return the numbers. `SEMANTIC_ELEMENTS` lists the elements and `FIELD_LABELS` the field names used in refusals.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every generated snippet is parsed with parse5 and must report zero parse errors. The date and time examples of WHATWG 2.3.5 and 4.5.14 are checked literally and impossible values must be refused; each of the five meter ordering rules and the progress rules is tested on its own; a dialog must carry no attribute other than id, open and closedby; a meter or progress bar must get its name from a label tied by for and id; and the preview of a closed dialog must show it open while the markup does not.

## Licence

MIT. See [LICENSE](./LICENSE).
