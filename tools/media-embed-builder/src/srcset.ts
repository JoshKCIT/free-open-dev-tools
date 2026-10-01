/**
 * The srcset and sizes attributes of img and picture sources, checked as an author's list.
 *
 * - parseSrcset follows the tokenisation of WHATWG 4.8.4.3.10 (parsing a srcset attribute) and refuses what the
 *   authoring rules of 4.8.4.2.1 refuse but the parser would quietly repair: an empty candidate, a trailing comma, more
 *   than one descriptor.
 * - checkSrcset applies the rest of 4.8.4.2.1: a width descriptor is a whole number above zero followed by w, a density
 *   descriptor a number above zero followed by x, no descriptor kind is mixed, no value is repeated.
 * - checkSizes applies 4.8.4.2.2: a list of media condition and length entries ending in a bare length; the keyword auto
 *   only as the first entry and only when the image loads lazily; no percentage and no negative length.
 *
 * Pure functions only: no DOM, no clock, no network, no storage.
 */
import { MarkupError } from './markup';
import { isValidNonNegativeInteger, isValidFloat, parseValidFloat } from './microsyntax';

/** The most image candidates one list may hold. */
export const MAX_CANDIDATES = 20;

export interface Descriptor {
  kind: 'w' | 'x';
  /** The number as typed, without the letter. */
  value: string;
}

export interface Candidate {
  url: string;
  descriptor: Descriptor | null;
}

const ASCII_WHITESPACE = new Set([' ', '\t', '\n', '\f', '\r']);

function isWhitespace(c: string): boolean {
  return ASCII_WHITESPACE.has(c);
}

/** Reads one descriptor list: the descriptor tokenizer of WHATWG 4.8.4.3.10. */
function readDescriptors(
  input: string,
  from: number,
): { descriptors: string[]; position: number; endedWithComma: boolean } {
  let position = from;
  while (position < input.length && isWhitespace(input.charAt(position))) position++;
  const descriptors: string[] = [];
  let current = '';
  let state: 'in-descriptor' | 'in-parens' | 'after-descriptor' = 'in-descriptor';
  let endedWithComma = false;
  for (;;) {
    const c = position < input.length ? input.charAt(position) : null;
    if (state === 'in-descriptor') {
      if (c === null) {
        if (current !== '') descriptors.push(current);
        break;
      }
      if (isWhitespace(c)) {
        if (current !== '') {
          descriptors.push(current);
          current = '';
        }
        state = 'after-descriptor';
        position++;
      } else if (c === ',') {
        position++;
        if (current !== '') descriptors.push(current);
        endedWithComma = true;
        break;
      } else if (c === '(') {
        current += c;
        state = 'in-parens';
        position++;
      } else {
        current += c;
        position++;
      }
    } else if (state === 'in-parens') {
      if (c === null) {
        if (current !== '') descriptors.push(current);
        break;
      }
      current += c;
      if (c === ')') state = 'in-descriptor';
      position++;
    } else {
      if (c === null) break;
      if (isWhitespace(c)) position++;
      else state = 'in-descriptor';
    }
  }
  return { descriptors, position, endedWithComma };
}

/**
 * Splits a srcset value into its image candidates. Refuses an empty candidate (a comma with no address), a comma
 * after the last candidate, a candidate with more than one descriptor, a descriptor that does not end in w or x, and
 * more than 20 candidates (counted while reading, so a longer list is never fully read).
 */
export function parseSrcset(input: string, field: string): Candidate[] {
  const candidates: Candidate[] = [];
  let position = 0;
  let pendingSeparator = false;
  for (;;) {
    let commas = 0;
    while (position < input.length && (isWhitespace(input.charAt(position)) || input.charAt(position) === ',')) {
      if (input.charAt(position) === ',') commas++;
      position++;
    }
    if (commas > 0) {
      throw new MarkupError(
        field,
        'a comma with no address before it (an empty candidate, or a comma at the start); candidates are separated by one comma (WHATWG 4.8.4.2.1)',
      );
    }
    if (position >= input.length) {
      if (pendingSeparator) {
        throw new MarkupError(
          field,
          'ends with a comma, so there is no candidate after it; remove the comma (WHATWG 4.8.4.2.1)',
        );
      }
      return candidates;
    }
    pendingSeparator = false;
    const start = position;
    while (position < input.length && !isWhitespace(input.charAt(position))) position++;
    let url = input.slice(start, position);
    let descriptors: string[] = [];
    if (url.endsWith(',')) {
      const stripped = url.replace(/,+$/, '');
      if (url.length - stripped.length > 1) {
        throw new MarkupError(
          field,
          'more than one comma after an address; candidates are separated by one comma (WHATWG 4.8.4.2.1)',
        );
      }
      url = stripped;
      pendingSeparator = true;
    } else {
      const read = readDescriptors(input, position);
      descriptors = read.descriptors;
      position = read.position;
      pendingSeparator = read.endedWithComma;
    }
    if (descriptors.length > 1) {
      throw new MarkupError(
        field,
        `"${url}" has ${descriptors.length} descriptors; a candidate has at most one descriptor, either a width such as 400w or a pixel density such as 2x (WHATWG 4.8.4.2.1)`,
      );
    }
    let descriptor: Descriptor | null = null;
    const only = descriptors[0];
    if (only !== undefined) {
      const letter = only.charAt(only.length - 1);
      if (letter !== 'w' && letter !== 'x') {
        throw new MarkupError(
          field,
          `"${only}" is not a width or pixel density descriptor; WHATWG 4.8.4.2.1 allows a width ending in w (400w) or a density ending in x (2x)`,
        );
      }
      descriptor = { kind: letter, value: only.slice(0, -1) };
    }
    candidates.push({ url, descriptor });
    if (candidates.length > MAX_CANDIDATES) {
      throw new MarkupError(
        field,
        `more than ${MAX_CANDIDATES} candidates, but at most ${MAX_CANDIDATES} are written; remove some`,
      );
    }
  }
}

/** The number a descriptor stands for, or an explanation of why it is not valid. */
function descriptorNumber(descriptor: Descriptor): { value: number } | { problem: string } {
  if (descriptor.kind === 'w') {
    if (isValidNonNegativeInteger(descriptor.value) && Number(descriptor.value) > 0) {
      return { value: Number(descriptor.value) };
    }
    return {
      problem: `"${descriptor.value}w" is not a width descriptor; it must be a whole number greater than zero followed by w, such as 400w (WHATWG 4.8.4.2.1)`,
    };
  }
  const density = isValidFloat(descriptor.value) ? parseValidFloat(descriptor.value) : null;
  if (density !== null && density > 0) return { value: density };
  return {
    problem: `"${descriptor.value}x" is not a pixel density descriptor; it must be a number greater than zero followed by x, such as 2x or 1.5x (WHATWG 4.8.4.2.1)`,
  };
}

/**
 * Applies the authoring rules of WHATWG 4.8.4.2.1 to parsed candidates: valid descriptors, no mixing of width and
 * density descriptors (a candidate with none counts as 1x), no repeated value, every candidate a width when a sizes
 * value is present, and a sizes value present when any candidate is a width (4.8.3, 4.8.2). `sizesPresent` is true when
 * a sizes value is typed, or when the image allows auto sizes and so stands in for one. A refusal that asks for the
 * sizes value names `sizesField`.
 */
export function checkSrcset(
  candidates: Candidate[],
  field: string,
  opts: { sizesPresent: boolean; sizesField?: string },
): void {
  if (candidates.length === 0) {
    throw new MarkupError(field, 'has no candidates; type an address, optionally followed by a descriptor');
  }
  if (candidates.length > MAX_CANDIDATES) {
    throw new MarkupError(
      field,
      `${candidates.length} candidates, but at most ${MAX_CANDIDATES} are written; remove some`,
    );
  }
  let widths = 0;
  const seen = new Map<string, string>();
  for (const candidate of candidates) {
    const descriptor = candidate.descriptor;
    if (descriptor !== null) {
      const number = descriptorNumber(descriptor);
      if ('problem' in number) throw new MarkupError(field, number.problem);
    }
    if (descriptor?.kind === 'w') widths++;
  }
  if (widths > 0 && widths < candidates.length) {
    throw new MarkupError(
      field,
      'width descriptors (such as 400w) and pixel density descriptors (such as 2x) cannot be mixed, and a candidate with no descriptor counts as 1x; use one kind in the whole list (WHATWG 4.8.4.2.1)',
    );
  }
  for (const candidate of candidates) {
    const descriptor = candidate.descriptor;
    const kind = descriptor?.kind ?? 'x';
    const number = descriptor === null ? { value: 1 } : descriptorNumber(descriptor);
    if ('problem' in number) continue;
    const key = `${kind}${number.value}`;
    const label =
      descriptor === null ? '1x (a candidate with no descriptor counts as 1x)' : `${descriptor.value}${kind}`;
    if (seen.has(key)) {
      throw new MarkupError(
        field,
        `two candidates have the same ${kind === 'w' ? 'width' : 'pixel density'} descriptor, ${label}; each must be different (WHATWG 4.8.4.2.1)`,
      );
    }
    seen.set(key, label);
  }
  const sizesField = opts.sizesField ?? 'Sizes';
  if (widths > 0 && !opts.sizesPresent) {
    throw new MarkupError(
      sizesField,
      'needed because the list uses width descriptors; WHATWG 4.8.3 says the sizes attribute must also be present, for example 100vw',
    );
  }
  if (opts.sizesPresent && widths === 0) {
    throw new MarkupError(
      field,
      'every candidate needs a width descriptor (such as 400w) when a sizes value is given (WHATWG 4.8.4.2.1)',
    );
  }
}

// ---- sizes --------------------------------------------------------------------------------------------------------

const LENGTH_UNITS =
  'px|cm|mm|q|in|pt|pc|em|rem|ex|rex|cap|rcap|ch|rch|ic|ric|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|svi|svb|svmin|svmax|lvw|lvh|lvi|lvb|lvmin|lvmax|dvw|dvh|dvi|dvb|dvmin|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax';
const LENGTH = new RegExp(`^[+]?(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)(?:e[+-]?[0-9]+)?(?:${LENGTH_UNITS})$`, 'i');
const NEGATIVE_LENGTH = new RegExp(`^-(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)(?:e[+-]?[0-9]+)?(?:${LENGTH_UNITS})$`, 'i');
const ZERO = /^[+-]?0*[.]?0+$/;
const MATH_FUNCTIONS = new Set(['calc', 'min', 'max', 'clamp']);

/** Splits on commas that sit outside parentheses; refuses unbalanced parentheses. */
function splitTopLevel(text: string, field: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth < 0)
        throw new MarkupError(field, 'has unbalanced parentheses: a closing parenthesis with no opening one');
    } else if (c === ',' && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  if (depth !== 0) throw new MarkupError(field, 'has unbalanced parentheses: an opening parenthesis is never closed');
  parts.push(text.slice(from));
  return parts;
}

/** Checks one length: a non-negative CSS length, 0, or a calc, min, max or clamp expression, never a percentage. */
function checkLength(token: string, field: string): void {
  if (token.endsWith(')')) {
    const name = /^([a-zA-Z-]+)\(/.exec(token)?.[1]?.toLowerCase() ?? '';
    if (!MATH_FUNCTIONS.has(name)) {
      throw new MarkupError(
        field,
        `"${token}" is not a length this builder can check; the standard allows only CSS math functions in a size, and this builder checks calc, min, max or clamp (WHATWG 4.8.4.2.2)`,
      );
    }
    if (token.includes('%')) {
      throw new MarkupError(
        field,
        `"${token}" uses a percent; percentages are not allowed in a size, use vw instead (WHATWG 4.8.4.2.2)`,
      );
    }
    return;
  }
  if (token.endsWith('%')) {
    throw new MarkupError(
      field,
      `"${token}" is a percent; percentages are not allowed in a size, use vw instead (WHATWG 4.8.4.2.2)`,
    );
  }
  if (NEGATIVE_LENGTH.test(token) && !ZERO.test(token.replace(/[a-z]+$/i, ''))) {
    throw new MarkupError(field, `"${token}" is a negative length; a size must not be negative (WHATWG 4.8.4.2.2)`);
  }
  if (token === '0' || LENGTH.test(token) || NEGATIVE_LENGTH.test(token)) return;
  throw new MarkupError(
    field,
    `"${token}" is not a length; write a number with a unit such as 100vw, 50vw or 320px, or calc(), min(), max() or clamp() (WHATWG 4.8.4.2.2)`,
  );
}

/** Splits an entry into its media condition (maybe empty) and its trailing length. */
function splitEntry(entry: string): { condition: string; value: string } {
  if (entry.endsWith(')')) {
    let depth = 0;
    let open = -1;
    for (let i = entry.length - 1; i >= 0; i--) {
      const c = entry.charAt(i);
      if (c === ')') depth++;
      else if (c === '(') {
        depth--;
        if (depth === 0) {
          open = i;
          break;
        }
      }
    }
    let start = open;
    while (start > 0 && /[a-zA-Z0-9-]/.test(entry.charAt(start - 1))) start--;
    if (start < open) return { condition: entry.slice(0, start).trim(), value: entry.slice(start) };
    return { condition: entry, value: '' };
  }
  const space = Math.max(entry.lastIndexOf(' '), entry.lastIndexOf('\t'));
  return { condition: entry.slice(0, space + 1).trim(), value: entry.slice(space + 1) };
}

/**
 * Checks a sizes value as WHATWG 4.8.4.2.2 writes it: comma-separated entries, each but the last a media condition and
 * a length, the last a bare length. The keyword auto is allowed only as the first entry (or the whole value) and only
 * when `opts.lazy` says the image allows auto sizes. A media condition is checked only for starting with a parenthesis
 * (or not) and having balanced parentheses; it is not parsed as CSS.
 */
export function checkSizes(text: string, field: string, opts: { lazy: boolean }): void {
  if (text.trim() === '') throw new MarkupError(field, 'is empty; type a size such as 100vw, or leave the field blank');
  const entries = splitTopLevel(text, field).map((e) => e.trim());
  if (entries.some((e) => e === '')) {
    throw new MarkupError(
      field,
      'has an empty entry (a comma with nothing before or after it); remove the extra comma',
    );
  }
  const last = entries.length - 1;
  entries.forEach((entry, index) => {
    if (/^auto$/i.test(entry)) {
      if (index !== 0) {
        throw new MarkupError(
          field,
          'has auto after the first entry; auto is allowed only as the first entry (WHATWG 4.8.4.2.2)',
        );
      }
      if (!opts.lazy) {
        throw new MarkupError(
          field,
          'uses auto, which the standard allows only on an image with loading set to lazy (WHATWG 4.8.4.2.2); set loading to lazy or remove auto',
        );
      }
      return;
    }
    const { condition, value } = splitEntry(entry);
    if (index === last) {
      if (condition !== '') {
        throw new MarkupError(
          field,
          `the last entry "${entry}" must be a length alone, with no media condition; it is the size used when no condition above it matches (WHATWG 4.8.4.2.2)`,
        );
      }
      checkLength(value, field);
      return;
    }
    if (condition === '') {
      throw new MarkupError(
        field,
        `the entry "${entry}" needs a media condition before the length, such as (max-width: 600px) 100vw; only the last entry is a bare length (WHATWG 4.8.4.2.2)`,
      );
    }
    if (!(condition.startsWith('(') || /^not\s/i.test(condition))) {
      throw new MarkupError(
        field,
        `"${condition}" is not a media condition; write it in parentheses, such as (max-width: 600px) (WHATWG 4.8.4.2.2)`,
      );
    }
    checkLength(value, field);
  });
}
