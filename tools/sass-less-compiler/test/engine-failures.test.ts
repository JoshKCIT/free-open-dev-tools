import { expect, it, vi } from 'vitest';
import { StylesheetError, compileStylesheet, type Language } from '../src/index';

/**
 * A stand-in for the Sass compiler that fails the way the real one did when a stylesheet doubled a list 40 times: the
 * JavaScript engine's own "Invalid array length" came back wrapped as a Sass error with a position. The real input needs
 * about 4 GB and 9 seconds, so it is not run here. Any source that starts with the marker gets the failure its first
 * line names; every other source goes to the real compiler.
 */
vi.mock('sass', async (importOriginal) => {
  const real = await importOriginal<typeof import('sass')>();
  const failures = new Map<string, () => Error>([
    [
      'array',
      () => Object.assign(new Error('x'), { sassMessage: 'Invalid array length.', span: { start: { offset: 42 } } }),
    ],
    [
      'string',
      () => Object.assign(new Error('x'), { sassMessage: 'Invalid string length', span: { start: { offset: 3 } } }),
    ],
    [
      'stack',
      () =>
        Object.assign(new Error('x'), {
          sassMessage: 'Maximum call stack size exceeded',
          span: { start: { offset: 3 } },
        }),
    ],
    ['range', () => new RangeError('Maximum call stack size exceeded')],
  ]);
  return {
    ...real,
    compileString: (source: string, options: unknown) => {
      const named = /^\/\*mock:(\w+)\*\//.exec(source)?.[1];
      const failure = named === undefined ? undefined : failures.get(named);
      if (failure !== undefined) throw failure();
      return (real.compileString as (s: string, o: unknown) => unknown)(source, options);
    },
  };
});

async function failureOf(source: string, language: Language): Promise<StylesheetError> {
  try {
    await compileStylesheet(source, { language, style: 'expanded' });
  } catch (err) {
    expect(err).toBeInstanceOf(StylesheetError);
    return err as StylesheetError;
  }
  throw new Error('the compile was expected to fail');
}

const SASS_TOO_DEEP = 'This stylesheet nests or repeats too deeply, or builds something too large, for the compiler.';

it('a Sass failure that is the JavaScript engine running out of array, string or stack room is a limit with no position', async () => {
  for (const name of ['array', 'string', 'stack', 'range']) {
    const error = await failureOf(`/*mock:${name}*/ $l: (1, 2, 3);`, 'scss');
    expect(error.kind, name).toBe('limit');
    expect(error.message, name).toBe(SASS_TOO_DEEP);
    expect(error.line, name).toBeUndefined();
    expect(error.column, name).toBeUndefined();
  }
});

it('a visitor own @error that happens to use the engine words is still a syntax error at its position', async () => {
  const error = await failureOf('@error "the handler is not a function";', 'scss');
  expect(error.kind).toBe('syntax');
  expect(error.message).toMatch(/\(line 1, column 1\)\.$/);
  expect(error.message).not.toContain('could not process');
});

it('a mistake in the stylesheet is still a syntax error with its position when the compiler is the stand-in', async () => {
  const error = await failureOf('a { b: 1 +; }', 'scss');
  expect(error.kind).toBe('syntax');
  expect(error.message).toBe('Expected expression (line 1, column 11).');
});
