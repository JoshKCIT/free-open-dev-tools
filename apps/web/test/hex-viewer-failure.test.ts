import { expect, it } from 'vitest';
import {
  HEX_VIEWER_FILE_MESSAGE,
  HEX_VIEWER_MEMORY_MESSAGE,
  HEX_VIEWER_UNKNOWN_MESSAGE,
  hexViewerUnknownFailure,
} from '../src/lib/hex-viewer-failure';

// The texts a browser or a library puts in the errors a failing read can throw. They are built here at run time and the
// tests check that none of them (nor the error's name) ever reaches the sentence the visitor reads.
const CANARY = 'canary-' + String(7_300_000 + 41);
const BROWSER_TEXT =
  'A requested file or directory could not be found at the time an operation was processed. ' + CANARY;

function notFound(): Error {
  return Object.assign(new Error(BROWSER_TEXT), { name: 'NotFoundError' });
}

function aborted(): DOMException {
  return new DOMException(BROWSER_TEXT, 'AbortError');
}

function shows(result: string, err: unknown): void {
  const e = err as { message?: unknown; name?: unknown };
  expect(result).not.toContain(CANARY);
  if (typeof e.message === 'string' && e.message) expect(result).not.toContain(e.message);
  if (typeof e.name === 'string' && e.name) expect(result).not.toContain(e.name);
}

it('a file search that fails for a reason not its own shows the fixed file sentence and none of the browser text', () => {
  const cases: unknown[] = [notFound(), aborted(), new TypeError(BROWSER_TEXT), 'plain string ' + CANARY];
  for (const err of cases) {
    const result = hexViewerUnknownFailure(err, 'file');
    expect(result).toBe('Could not read that file. If it changed or moved after you picked it, pick it again.');
    expect(result).toBe(HEX_VIEWER_FILE_MESSAGE);
    shows(result, err);
  }
});

it('a pasted bytes search that fails for a reason not its own shows the fixed unknown reason sentence', () => {
  const cases: unknown[] = [new TypeError(BROWSER_TEXT), notFound(), 'thrown string ' + CANARY, { message: CANARY }];
  for (const err of cases) {
    const result = hexViewerUnknownFailure(err, 'bytes');
    expect(result).toBe('The background task failed for an unknown reason.');
    expect(result).toBe(HEX_VIEWER_UNKNOWN_MESSAGE);
    shows(result, err);
  }
  // A message that arrived with no job has no kind: the same sentence.
  expect(hexViewerUnknownFailure(new TypeError(BROWSER_TEXT), undefined)).toBe(HEX_VIEWER_UNKNOWN_MESSAGE);
});

it('a failure that names memory shows the memory sentence for a file or pasted bytes', () => {
  const cases: unknown[] = [
    new RangeError('Invalid array length'),
    new RangeError('Invalid string length'),
    new Error('Array buffer allocation failed'),
    new Error('out of memory ' + CANARY),
  ];
  for (const err of cases) {
    for (const kind of ['file', 'bytes'] as const) {
      const result = hexViewerUnknownFailure(err, kind);
      expect(result).toBe('The search needed more memory than this tab could give.');
      expect(result).toBe(HEX_VIEWER_MEMORY_MESSAGE);
      shows(result, err);
    }
  }
});
