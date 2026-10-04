# Keyboard Event Viewer

Press keys and see the key, code, legacy key code, location, modifiers, repeat and composition state the browser reports.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Click in the key capture box at the top of the output and press keys: every key down, key press and key up appears as a row showing exactly what your browser reported for it, so you can see which key and code a shortcut handler will receive. Keys are read only by the capture box itself and only while it has focus, so nothing is read when you click elsewhere. The legacy numbers (keyCode, which and charCode) are shown as this browser reports them, because the UI Events specification does not define them. Nothing you press is sent, stored or logged: the history lives only in this page's memory.

## Supported

- keydown, keypress (a legacy event) and keyup events, and the compositionstart, compositionupdate and compositionend events of an input method
- For each event: key, code, keyCode, which, charCode (key press only), location in words, the four modifiers (Ctrl, Shift, Alt, Meta), repeat, isComposing and defaultPrevented
- Composition text (the data of a composition event), shown escaped
- Choosing which event types are shown; this changes only what is displayed, never what is kept
- An option to prevent the browser's default action for every key except Tab and Escape, so you can see keys such as Space or F5 without the page scrolling or reloading
- Left, right and numpad variants of a key through the location value, and held keys through repeat

## Limits

- The history keeps the latest 200 events in this page's memory only; Clear history empties it.
- Key names and composition text are shown with control and direction-changing characters escaped and cut at 64 characters.
- This page shows every key you type while the capture box has focus, so do not type passwords or other secrets into it.
- Your browser and operating system keep some key combinations for themselves (for example switching tabs or windows, or an input method switch), so those never reach the page.
- Composition events appear only with an input method; the legacy keyCode, which and charCode values are whatever this browser reports, because the UI Events specification does not define them.

## Ambiguous cases, and what this does about them

- key is the character or named key the press produced, so it changes with the keyboard layout and with Shift; code names the physical key whatever the layout. On a non-US layout the same code can show different key values.
- The key down and key up of one press are separate rows, and so are two events with the same key and code, such as the repeated key downs of a held key (repeat is true on the second and later ones).
- During an input method session a key down often reports the key Process and the legacy value 229, with isComposing true, instead of the key you pressed.
- The numpad location on key up can differ between browsers for the same press; each row shows what this browser reported.

## Defined by

- [UI Events (W3C Working Draft)](https://www.w3.org/TR/uievents/)
- [UI Events KeyboardEvent key Values](https://www.w3.org/TR/uievents-key/)
- [UI Events KeyboardEvent code Values](https://www.w3.org/TR/uievents-code/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/keyboard-event-viewer keyboard-event-viewer
cd keyboard-event-viewer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/keyboard-event-viewer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { KeyHistory, recordRow, KEY_COLUMNS, visible, locationLegendRows } from '@fodt/keyboard-event-viewer';

const history = new KeyHistory();
history.add({
  type: 'keydown', key: 'a', code: 'KeyA', keyCode: 65, which: 65, charCode: 0, location: 0,
  ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
  repeat: false, isComposing: false, defaultPrevented: false, data: '',
});

KEY_COLUMNS;                                  // ['Event', 'key', 'code', ...]
recordRow(history.rows(shown)[0]);            // ['keydown', 'a', 'KeyA', '65', ...]
visible('\u202e');                             // { shown: '\\u{202E}', truncated: false }
locationLegendRows();                         // [['0', 'standard', 'DOM_KEY_LOCATION_STANDARD'], ...]
```

Everything here is pure: no document, clock, console or storage is touched, so the escaping, the column text and the bounded history can be tested in Node. `recordRow` turns one record into the table cells (numbers as decimal text, charCode only on a key press, location as number and name). `visible` escapes control characters and the characters that change text direction as `\u{XX}` and cuts at 64 code points. `KeyHistory` keeps at most `MAX_HISTORY_ROWS` (200) records and drops the oldest first; `rows(shown)` filters for display only. `LOCATION_NAMES` is a Map, so a key such as `__proto__` is never looked up as a property. Reading real key events is done by the page's own capture box, not by this package.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The browser itself is the oracle for what a key reports: the phase browser spec attaches its own listener to the same capture box and compares every displayed cell with what that listener recorded, in chromium, firefox, webkit and mobile-chrome, and also checks the values recorded from the engines (pressing a gives keydown a KeyA 65 with location 0, keypress charCode 97, keyup). Held keys, modifiers, the numpad (key up location checked per engine), Tab and Shift+Tab leaving the box, reading only while focused, the 200 row bound and Clear are checked in all four. A real input method composition is checked in chromium, mobile-chrome and firefox; WebKit gives no composition events for scripted input, so there the escaping is checked with dispatched events. Unit tests cover the location names of the UI Events specification, the escaping and the 64 character cut, and the history bound.

## Licence

MIT. See [LICENSE](./LICENSE).
