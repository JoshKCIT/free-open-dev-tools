# Form Control Styler (Buttons, Switches, Checkboxes, Radios, Sliders)

Style buttons, switches, checkboxes, radio buttons and range sliders while keeping the native controls.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Styles one family of form controls at a time: a button, a switch, a checkbox, a set of radio buttons or a range slider. Pick a preset, an accent colour, a background colour, a size and a corner radius, and the real controls are drawn in a frame with no scripts, next to the exact CSS and markup to copy. Only the look changes: every control stays a native button or input, so keyboard use, screen readers and form submission work as before, and each one keeps a visible focus ring.

## Supported

- Five control families: button, switch (a checkbox with the switch role), checkbox, radio buttons and a range slider
- Six presets: plain, rounded, pill, outline, soft and bold
- An accent colour, a background colour, a size from 12 to 32 pixels and a corner radius from 0 to 24 pixels
- Hover, keyboard focus, pressed, checked and disabled states, written in a fixed order
- A warning when the accent and background colours are below the 3 to 1 contrast WCAG 2.2 asks for in user interface components
- The CSS to copy and download, and the markup of the native controls to copy

## Limits

- Only the look changes: the controls stay native buttons and inputs, so keyboard use and screen readers work as before.
- Every control keeps a visible focus ring for keyboard users; a colour pair below 3 to 1 contrast is warned about, and the focus ring then uses the text colour.
- The CSS turns off its transitions when the visitor's system asks for reduced motion.
- The preview shows one control family at a time in a frame with no scripts.
- Colours are hexadecimal; a colour box holding other text falls back to the default colour with a warning. Size is clamped to 12 to 32 pixels and the corner radius to 0 to 24 pixels, with a warning.
- The label text is cut to 40 characters and shown as plain text; an empty label becomes Option. It never reaches the CSS.
- Range sliders are styled with the browser-specific parts of the control, so a browser that does not know those parts shows the native slider with the accent colour only.
- The copied markup puts the controls on a surface element of the background colour (the class fc-surface); leave it out to place the controls on your own page, and the controls keep their own rules.

## Ambiguous cases, and what this does about them

- Browsers draw a styled range slider through different internal parts (a WebKit part and a Mozilla part), so the two are written as separate rules with the same values
- A focus ring appears for keyboard use and not for a mouse click on most controls; that is the browser's :focus-visible rule, not a choice made here
- The 3 to 1 contrast figure applies to the parts of a control that show its state against its background; it is a warning here, not a refusal

## Defined by

- [HTML Living Standard (form controls: button, checkbox, radio button, range)](https://html.spec.whatwg.org/multipage/input.html)
- [CSS Basic User Interface Module Level 4 (appearance, accent-color, outline)](https://www.w3.org/TR/css-ui-4/)
- [Web Content Accessibility Guidelines (WCAG) 2.2 (focus visible, non-text contrast)](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA 1.2 (the switch role)](https://www.w3.org/TR/wai-aria-1.2/#switch)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/form-control-styler form-control-styler
cd form-control-styler
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/form-control-styler
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { styleControls } from '@fodt/form-control-styler';

const result = styleControls({ control: 'switch', preset: 'pill', accent: '#2563eb', background: '#ffffff', text: 'Notify me', size: 22, radius: 6 });
// result.css holds the rules (.fc-switch, .fc-switch:checked, .fc-switch:focus-visible ...) and the reduced-motion block
// result.markup holds the native input type="checkbox" role="switch"; result.html is the style element plus the markup
```

styleControls({ control, preset, accent, background, text, size, radius, showDisabled }) takes a control name and a preset name from closed lists, two hex colours, a label text (an empty one becomes Option, at most 40 characters, written into the markup as escaped text and never into the CSS), a size in pixels (clamped to 12 to 32) and a corner radius in pixels (clamped to 0 to 24), and returns { css, markup, html, warnings }. The CSS is written by controlCss, which accepts only the class names in ALLOWED_SELECTORS with a closed list of pseudo-classes, pseudo-elements and properties, and findUnsafeControlCss scans any finished text. contrastRatio(a, b) is the WCAG 2.2 contrast ratio of two hex colours. A name outside its list or a colour that is not a 3, 4, 6 or 8 digit hex colour is refused with FormControlError; colourOrDefault turns a bad colour into a default for a page whose colour box takes any text.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every control and preset gives the native element in its markup and a focus-visible rule with an outline of at least 2 pixels. The contrast ratio is checked against the WCAG 2.2 definition (black on white is 21 to 1, #767676 on white is 4.54 to 1). Hostile field values are fed to every field and never appear in the CSS, and the safety scan refuses an address function, an import rule, a backslash, an expression and an unknown selector. In a browser, the switch, checkbox, radios and slider are operated by pointer and keyboard inside the frame, a keyboard-focused control shows an outline of at least 2 pixels, the copied CSS and markup in an empty page draw the same pixels as the frame, and the transitions compute to zero under reduced motion.

## Licence

MIT. See [LICENSE](./LICENSE).
