import {
  KEY_COLUMNS,
  KeyHistory,
  recordRow,
  type KeyEventRecord,
  type KeyEventType,
  type ShownTypes,
} from '@fodt/keyboard-event-viewer';

/**
 * The key capture area of the Keyboard Event Viewer: a page-local box placed at the top of the Output panel, with the
 * history table and a Clear button under it.
 *
 * Privacy rules this file keeps (D-206):
 *  - Keys and composition events are read only by listeners on the capture box itself, never on the document or the
 *    window, so nothing is read while focus is anywhere else.
 *  - The history lives in this module's memory, is bounded by the package's KeyHistory (200 rows), is emptied by
 *    Clear history and is forgotten when the capture area leaves the page. Nothing is logged, stored, put in the
 *    address, the title or a file name, or sent.
 *  - Cells are written with textContent only, and the shown text has control and direction-changing characters escaped.
 *  - Tab, Shift+Tab and Escape are never prevented, so focus can always leave the box (no keyboard trap).
 *  - The box is an ordinary editable text area: an input method only starts in an editable element.
 *
 * The shared page shell is not touched: the area is created once by the page's own run and updated afterwards, the same
 * injection site the camera helper uses.
 */

export const KEY_CAPTURE_ID = 'fodt-key-capture';

export interface KeyCaptureOptions {
  show: ShownTypes;
  /** Prevent the browser's default action for keys other than Tab, Escape and the keys of an input method. */
  preventOther: boolean;
}

const HOST_SELECTOR = 'section[aria-label="Output"] .panel-body';
const EMPTY_TEXT = 'No key events yet.';
const WARNING_TEXT =
  'This box shows every key you press while it has focus. Do not type passwords or other secrets. ' +
  'Your browser and operating system keep some key combinations for themselves, so those never reach this page.';

interface Area {
  container: HTMLElement;
  box: HTMLTextAreaElement;
  scroller: HTMLElement;
  body: HTMLTableSectionElement;
  emptyRow: HTMLTableRowElement;
  dataRows: number;
}

/** The one history of this page's memory; a replaced container keeps showing it. */
const history = new KeyHistory();
let options: KeyCaptureOptions = {
  show: { keydown: true, keypress: true, keyup: true, composition: true },
  preventOther: false,
};
let area: Area | null = null;

function isShown(type: KeyEventType): boolean {
  if (type === 'keydown') return options.show.keydown;
  if (type === 'keypress') return options.show.keypress;
  if (type === 'keyup') return options.show.keyup;
  return options.show.composition;
}

function styled<T extends HTMLElement>(element: T, style: Partial<CSSStyleDeclaration>): T {
  Object.assign(element.style, style);
  return element;
}

function cell(tag: 'th' | 'td', text: string, mono: boolean): HTMLTableCellElement {
  const element = document.createElement(tag);
  element.textContent = text;
  styled(element, {
    border: '1px solid var(--border)',
    padding: '4px 8px',
    textAlign: 'left',
    verticalAlign: 'top',
    whiteSpace: 'nowrap',
  });
  if (tag === 'th') {
    element.style.background = 'var(--bg-inset)';
    element.style.position = 'sticky';
    element.style.top = '0';
  }
  if (mono) element.style.fontFamily = 'var(--mono)';
  return element;
}

function dataRow(record: KeyEventRecord): HTMLTableRowElement {
  const row = document.createElement('tr');
  recordRow(record).forEach((text, index) => row.append(cell('td', text, index !== 0)));
  return row;
}

/** Shows exactly the kept events of the shown types. */
function render(): void {
  if (!area) return;
  const a = area;
  a.body.replaceChildren();
  const rows = history.rows(options.show);
  for (const record of rows) a.body.append(dataRow(record));
  a.dataRows = rows.length;
  if (rows.length === 0) a.body.append(a.emptyRow);
}

/** Adds the row of one new event and drops the rows the history has dropped. */
function append(record: KeyEventRecord): void {
  const a = area;
  if (!a || !isShown(record.type)) return;
  if (a.dataRows === 0) a.emptyRow.remove();
  a.body.append(dataRow(record));
  a.dataRows++;
  const keep = history.rows(options.show).length;
  while (a.dataRows > keep) {
    a.body.firstElementChild?.remove();
    a.dataRows--;
  }
  a.scroller.scrollTop = a.scroller.scrollHeight;
}

/** The keys whose default action is never prevented: Tab and Escape (no keyboard trap) and an input method's keys. */
function mayPrevent(event: KeyboardEvent): boolean {
  if (event.key === 'Tab' || event.key === 'Escape' || event.key === 'Process') return false;
  if (event.isComposing || event.keyCode === 229) return false;
  return true;
}

function keyRecord(event: KeyboardEvent): KeyEventRecord {
  return {
    type: event.type as KeyEventType,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    which: event.which,
    charCode: event.charCode,
    location: event.location,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    repeat: event.repeat,
    isComposing: event.isComposing,
    defaultPrevented: event.defaultPrevented,
    data: '',
  };
}

function compositionRecord(event: CompositionEvent): KeyEventRecord {
  return {
    type: event.type as KeyEventType,
    key: '',
    code: '',
    keyCode: 0,
    which: 0,
    charCode: 0,
    location: 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    // A composition event has no such property; it is true from the start of a session to just before its end.
    isComposing: event.type !== 'compositionend',
    defaultPrevented: event.defaultPrevented,
    data: event.data,
  };
}

function onKey(event: Event): void {
  if (!(event instanceof KeyboardEvent)) return;
  if (options.preventOther && (event.type === 'keydown' || event.type === 'keypress') && mayPrevent(event)) {
    event.preventDefault();
  }
  const record = keyRecord(event);
  history.add(record);
  append(record);
}

function onComposition(event: Event): void {
  if (!(event instanceof CompositionEvent)) return;
  const record = compositionRecord(event);
  history.add(record);
  append(record);
}

function build(): Area {
  const container = document.createElement('div');
  container.id = KEY_CAPTURE_ID;
  styled(container, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: '0',
    padding: '12px',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-sunken)',
  });

  const heading = styled(document.createElement('div'), { fontWeight: '640' });
  heading.textContent = 'Key capture';

  const warning = styled(document.createElement('p'), {
    margin: '0',
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
  });
  warning.textContent = WARNING_TEXT;

  const box = styled(document.createElement('textarea'), {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '4.5em',
    padding: '8px',
    font: 'inherit',
    fontFamily: 'var(--mono)',
    color: 'var(--text)',
    background: 'var(--bg)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
  });
  box.setAttribute('aria-label', 'Key capture box');
  box.setAttribute('autocomplete', 'off');
  box.setAttribute('autocapitalize', 'off');
  box.setAttribute('autocorrect', 'off');
  box.spellcheck = false;
  box.rows = 3;
  box.placeholder = 'Click here, then press keys.';

  const clear = styled(document.createElement('button'), {
    alignSelf: 'flex-start',
    padding: '5px 12px',
    font: 'inherit',
    color: 'var(--text)',
    background: 'var(--bg-raised)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
  });
  clear.type = 'button';
  clear.textContent = 'Clear history';

  const scroller = styled(document.createElement('div'), {
    maxHeight: '320px',
    overflow: 'auto',
    maxWidth: '100%',
  });
  const table = styled(document.createElement('table'), {
    borderCollapse: 'collapse',
    fontSize: '0.8rem',
    width: '100%',
  });
  table.setAttribute('role', 'log');
  table.setAttribute('aria-live', 'off');
  table.setAttribute('aria-label', 'Key event history');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of KEY_COLUMNS) headRow.append(cell('th', column, false));
  head.append(headRow);
  const body = document.createElement('tbody');
  const emptyRow = document.createElement('tr');
  const emptyCell = cell('td', EMPTY_TEXT, false);
  emptyCell.colSpan = KEY_COLUMNS.length;
  emptyRow.append(emptyCell);
  table.append(head, body);
  scroller.append(table);

  for (const type of ['keydown', 'keypress', 'keyup']) box.addEventListener(type, onKey);
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
    box.addEventListener(type, onComposition);
  }

  clear.addEventListener('click', () => {
    history.clear();
    box.value = '';
    render();
  });

  container.append(heading, warning, box, clear, scroller);
  return { container, box, scroller, body, emptyRow, dataRows: 0 };
}

/**
 * Makes sure the capture area is in the Output panel and uses the given options. The area is created once and only its
 * options change afterwards, so the box, what was typed and the history survive field edits, Run and Reset. Returns
 * `no-host` when the Output panel is not on the page.
 */
export function ensureKeyCapture(next: KeyCaptureOptions): 'ready' | 'no-host' {
  const host = document.querySelector(HOST_SELECTOR);
  if (!host) return 'no-host';
  options = { show: { ...next.show }, preventOther: next.preventOther };
  const present = host.querySelector('#' + KEY_CAPTURE_ID);
  if (present && area && area.container === present) {
    render();
    return 'ready';
  }
  present?.remove();
  // The earlier container is gone from the page (the visitor left the tool, or the panel was replaced): what was typed
  // there is forgotten, so the history never outlives the page it was typed on.
  if (area && !area.container.isConnected) history.clear();
  area = build();
  host.prepend(area.container);
  render();
  return 'ready';
}
