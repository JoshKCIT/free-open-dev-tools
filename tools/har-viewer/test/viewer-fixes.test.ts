import { expect, it } from 'vitest';
import * as viewer from '../src/index';
import { HarViewerError, listRequests, readHar } from '../src/index';
import * as jsonText from '../src/json-text';

/*
 * Smaller findings of the phase 13 review of the HAR viewer. The expected values come from the HAR 1.2 specification
 * (http://www.softwareishard.com/blog/har-12-spec/: response.status is a number, and "Custom fields and elements MUST
 * start with an underscore") and from RFC 8259 section 9 ("An implementation may set limits on the maximum depth of
 * nesting").
 */

const LIST = { filter: '', method: '', status: '', sort: 'start', reveal: false, page: 1 } as const;

function entry(url: string, response: Record<string, unknown>) {
  return {
    startedDateTime: '2009-04-16T12:07:23.596Z',
    time: 1,
    request: { method: 'GET', url, httpVersion: 'HTTP/1.1', cookies: [], headers: [], queryString: [] },
    response: { statusText: '', httpVersion: 'HTTP/1.1', cookies: [], headers: [], content: { size: 0 }, ...response },
    cache: {},
    timings: { send: 1 },
  };
}

const harOf = (entries: unknown[]) => JSON.stringify({ log: { version: '1.2', creator: { name: 't' }, entries } });

it('the package exports isSensitive and maskValue, as its notes say', () => {
  expect(typeof viewer.isSensitive).toBe('function');
  expect(typeof viewer.maskValue).toBe('function');
  expect(viewer.isSensitive('header', 'Authorization', 'x')).toBe(true);
  expect(viewer.maskValue('abcdefghijklmnop')).toBe('abcd… (16 characters)');
});

it('sorting by status puts a request with no status last, and a status of 0 (a failed request) first', () => {
  const recording = readHar(
    harOf([
      entry('https://a.example/200', { status: 200 }),
      entry('https://a.example/none', {}),
      entry('https://a.example/0', { status: 0 }),
      entry('https://a.example/404', { status: 404 }),
      entry('https://a.example/text', { status: 'ok' }),
    ]),
  );
  const urls = listRequests(recording, { ...LIST, sort: 'status' }).rows.map((row) => row.url.split('/').pop());
  // 0, 200 and 404 in order; the two without a number keep their recording order after them.
  expect(urls).toEqual(['0', '200', '404', 'none', 'text']);
  // The list still shows 0 for a request with no status.
  expect(listRequests(recording, { ...LIST }).rows[1]!.status).toBe(0);
});

it('a valid document nested very deep is read, and a broken one nested past 512 levels is refused for its depth', () => {
  const depth = 5000;
  const deep = `${'['.repeat(depth)}${']'.repeat(depth)}`;
  const text = `{"log":{"version":"1.2","entries":[],"_deep":${deep}}}`;
  expect(readHar(text).total).toBe(0);
  // Broken: the scanner that finds the error is recursive, so it stops at 512 levels and says so.
  const broken = `{"log":{"version":"1.2","entries":[],"_deep":${'['.repeat(600)}`;
  let error: unknown;
  try {
    readHar(broken);
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(HarViewerError);
  expect((error as Error).message).toContain('512');
  // The depth check that nothing used is gone.
  expect('exceedsDepth' in jsonText).toBe(false);
});

it('a version that is not a plain short token is not copied into the refusal', () => {
  const refuse = (version: string) => {
    try {
      readHar(JSON.stringify({ log: { version, entries: [] } }));
    } catch (err) {
      expect(err).toBeInstanceOf(HarViewerError);
      return (err as Error).message;
    }
    throw new Error('the version was not refused');
  };
  expect(refuse('0.9')).toContain('"0.9"');
  const long = 'x'.repeat(100);
  const message = refuse(long);
  expect(message).not.toContain(long);
  expect(message).toContain('… (100 characters)');
  expect(refuse(['eyJhbGciOi', 'JIUzI1NiJ9', 'e30', 'abc'].join('.'))).not.toContain('eyJhbGciOiJIUzI1NiJ9');
});
