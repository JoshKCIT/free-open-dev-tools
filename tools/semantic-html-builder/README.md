# Semantic HTML Element Builder

Build details and summary, dialog, meter, progress, quotations with citations, figures with captions, time, abbreviations and the text-level tags, with a preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds one semantic HTML element and shows its markup first, ready to copy, with a live preview of the same markup after it. You pick one of fourteen elements and the page offers only what the HTML Living Standard defines for it, and refuses a value the standard does not allow instead of copying it. details gets its summary, dialog a close form, meter and progress a label and the standard's number rules, a quotation its attribution and work title in a caption outside the quote, a figure its caption, and time, ins and del a date or time checked against the forms the standard allows. The preview shows the element without loading anything you typed. The standard was read on 2026-10-01 (last updated 2026-09-29); a later edition may differ.

## Supported

- details with exactly one summary first and then the content as paragraphs (blank lines separate them), with open and a group name written only when you choose them
- dialog with its content, an optional id, open, a closedby value from any, closerequest or none, and a close form with method dialog and a button whose text you can change; a tabindex is never written because the standard forbids one on a dialog
- meter with a required value and the min, max, low, high, optimum and title attributes, every number a valid floating-point number and all five ordering rules of WHATWG 4.10.14 checked, with the minimum 0 and the maximum 1 when you leave them blank
- progress with a value between 0 and its max, a max above zero, or no value at all for an indeterminate bar, with a note saying what that means
- A label tied to every meter and progress bar by for and id, so each has an accessible name (HTML-AAM 4.1.7); the id is worked out from the label when you leave it blank
- A quotation with a citation: a figure holding the blockquote (with its cite address, kept as typed) and a figcaption outside it with the attribution and the work title in a cite element, as WHATWG 4.4.4 and 4.5.6 describe; with no attribution or work title, a bare blockquote
- A figure with one image (its address kept as typed, alt text required, optional width and height as whole numbers) and a caption placed first or last, the two positions WHATWG 4.4.12 allows
- A time element whose datetime attribute, or its text when no attribute is typed, matches one of the forms WHATWG 4.5.14 lists: a month, date, yearless date, time, local date and time, time-zone offset, global date and time, week, year or duration
- ins and del with an optional cite address and a datetime that must be a date or a global date and time (WHATWG 4.7.3); a local date and time is refused there
- abbr with its expansion in the title attribute, and mark, sub, sup, kbd, ins and del wrapping only the text you type, with any text before or after placed outside the element in a paragraph
- Every date and time example of the standard is accepted, and impossible values are refused naming the field: month 13, February 29 in a common year, hour 24, second 60, four fraction digits and a minus zero offset
- Numbers, dates and times are read as ASCII digits only, in the letter case the grammar writes; digits of other scripts are refused
- Markup first and an inert preview of the same element second, with any warning in a note

## Limits

- Everything you type is escaped before it is placed in the markup, so a tag, an event handler or a script address you type stays text; a javascript:, data: or vbscript: address is kept as typed and flagged.
- The preview replaces every address you typed (src, srcset, poster, href, action, formaction, data and cite) with an inert placeholder or removes it, so nothing you typed is loaded; only the markup you copy keeps the real addresses.
- Each text field is limited to 20,000 characters, details, dialog and quotation content to 50 paragraphs, and control characters other than a tab (and line breaks in a text area) are refused because HTML cannot carry them.
- The builder writes one element per run and writes only the attributes you choose; it never adds an attribute for you. Details elements that share a group name open one at a time in the browser, so to build a group, build each details element in turn with the same group name and open at most one of them.
- The preview shows a closed dialog open so you can see it, while the copied markup keeps your choice. The close button in the preview closes the dialog only in some browsers, because the preview frame blocks form submission; the copied markup is not affected.
- A meter or progress bar needs a label here, which the standard does not require, so that every gauge has an accessible name; the label is written as a label element tied by for and id, never as hidden text.
- A figure holds one image and its caption; other figure content is not offered. A kbd element is written on its own, so nested key combinations are not generated; sub and sup are for conventions that have meaning, such as chemical formulas and footnote marks.
- Single line breaks inside a paragraph are kept as typed and a browser shows them as spaces; a blank line starts a new paragraph.

## Ambiguous cases, and what this does about them

- A time element may carry the machine-readable value in its datetime attribute or, when there is none, in its text; this builder checks whichever one holds the value, and refuses text that is not a valid value when no datetime is typed.
- A year in the standard is four or more ASCII digits that are not all zero, so 0037 is a valid year while 37 is not.
- The standard says a details name must not be the empty string; a name made only of spaces is not the empty string to a parser but means nothing, so it is refused.
- When the minimum is greater than the maximum of a meter, no value can satisfy the standard's ordering rules, so the value is refused with the range in the message.
- The standard allows a meter without fallback text inside it; the text field is optional here and the element is written empty when it is blank.
- The standard puts the attribution of a quotation outside the blockquote and says a cite element names a work, never a person; so the attribution is plain text in the caption and only the work title is wrapped in cite.
- The standard allows a figure without a caption, so the caption is optional here; the alt text is required, because the standard asks a generator to get it from the person writing the page.
- The datetime of ins and del is stricter than that of time: the standard asks for a valid date string with optional time, which means a date or a global date and time, so a local date and time is refused for ins and del and accepted for time.

## Defined by

- [HTML Living Standard, 4.11.1 The details element](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element)
- [HTML Living Standard, 4.11.2 The summary element](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-summary-element)
- [HTML Living Standard, 4.11.4 The dialog element](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element)
- [HTML Living Standard, 4.10.13 The progress element](https://html.spec.whatwg.org/multipage/form-elements.html#the-progress-element)
- [HTML Living Standard, 4.10.14 The meter element](https://html.spec.whatwg.org/multipage/form-elements.html#the-meter-element)
- [HTML Living Standard, 4.4.4 The blockquote element](https://html.spec.whatwg.org/multipage/grouping-content.html#the-blockquote-element)
- [HTML Living Standard, 4.4.12 The figure element and 4.4.13 The figcaption element](https://html.spec.whatwg.org/multipage/grouping-content.html#the-figure-element)
- [HTML Living Standard, 4.5.6 The cite element](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-cite-element)
- [HTML Living Standard, 4.5.9 The abbr element](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-abbr-element)
- [HTML Living Standard, 4.5.14 The time element](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-time-element)
- [HTML Living Standard, 4.5.18 The kbd element, 4.5.19 The sub and sup elements and 4.5.23 The mark element](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-kbd-element)
- [HTML Living Standard, 4.7 Edits (the ins and del elements)](https://html.spec.whatwg.org/multipage/edits.html)
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

const quote = buildElement({
  element: 'blockquote',
  paragraphs: 'Quoted words',
  attribution: 'A. Writer',
  workTitle: 'A Book',
});
quote?.html;
// <figure>
//   <blockquote>
//     <p>Quoted words</p>
//   </blockquote>
//   <figcaption>A. Writer, <cite>A Book</cite></figcaption>
// </figure>
```

`buildElement(spec)` returns `{ tree, html, preview, warnings }`, or `null` when every text field it reads is blank. `html` is the copyable markup and `preview` is the same tree with every address removed (and a closed dialog shown open). A refused value throws `MarkupError` with a `field` (the label the page shows) and a `message`. `checkMeter({ value, min, max, low, high, optimum })` and `checkProgress({ value, max })` take the typed strings, throw `MarkupError` naming the field and the broken rule, and return the numbers. `SEMANTIC_ELEMENTS` lists the fourteen elements and `FIELD_LABELS` the field names used in refusals.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every generated snippet is parsed with parse5 and must report zero parse errors. The date and time examples of WHATWG 2.3.5, 4.5.14 and 4.7.3 are checked literally and impossible values must be refused; each of the five meter ordering rules and the progress rules is tested on its own; a dialog must carry no attribute other than id, open and closedby; a meter or progress bar must get its name from a label tied by for and id; a quotation must keep its attribution outside the blockquote and a figure caption must be its first or last child; and hostile text typed into every free-text field of every element must leave the parsed element tree unchanged.

## Licence

MIT. See [LICENSE](./LICENSE).
