import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadJq } from 'jq-wasm/inline';
import {
  engineFailureMessage,
  JqPlaygroundError,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  meta as toolMeta,
  runJq,
  type JqEngine,
  type JqOptions,
} from '../src/index';
import { MANUAL_EXAMPLES } from './fixtures/jq-manual/golden';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The package prints nothing: a spy on every console method asserts it stays silent (the one test that traps the
 * engine, which prints its own abort notice, says so and clears the spies itself).
 */
let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  spies = (['log', 'warn', 'error'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
});
afterEach(() => {
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

const engine: JqEngine = await loadJq();

const DEFAULTS: JqOptions = {
  compact: false,
  raw: false,
  slurp: false,
  sortKeys: false,
  nullInput: false,
  ascii: false,
  indent: '2',
  args: '',
};
const COMPACT: JqOptions = { ...DEFAULTS, compact: true };

/** An engine that fails on first use, to show that a check happens before the engine is asked for anything. */
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error('the engine was used');
    },
  },
) as unknown as JqEngine;

function failure(run: () => unknown): JqPlaygroundError {
  try {
    run();
  } catch (err) {
    if (err instanceof JqPlaygroundError) return err;
    throw err;
  }
  throw new Error('expected a jq error');
}

// ---------------------------------------------------------------------------------------------------------------------
// The jq 1.8 manual is the specification: every example in it is run and its documented outputs are compared as JSON
// values (key order is not part of JSON equality). Source: the manual at tag jq-1.8.2, licensed CC BY 3.0 by the jq
// authors (see test/fixtures/jq-manual/UPSTREAM.md).
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Examples the manual documents for a machine where the environment variable PAGER is set to "less". The engine runs
 * with its own empty environment, so these two cannot reproduce by design (and the page says env shows only defaults).
 */
const EXPECTED_EXCEPTIONS = ['$ENV.PAGER', 'env.PAGER'];

it('jq 1.8 manual: every example reproduces its documented output except the two that read PAGER', () => {
  expect(MANUAL_EXAMPLES.length).toBeGreaterThanOrEqual(240);
  const mismatches: string[] = [];
  let compared = 0;
  for (const example of MANUAL_EXAMPLES) {
    if (EXPECTED_EXCEPTIONS.includes(example.program)) continue;
    compared += 1;
    try {
      const result = runJq(engine, example.input, example.program, COMPACT);
      const lines = result === null || result.output === '' ? [] : result.output.split('\n');
      const actual = lines.map((line) => JSON.parse(line) as unknown);
      const expected = example.output.map((line) => JSON.parse(line) as unknown);
      expect(actual).toEqual(expected);
    } catch (err) {
      mismatches.push(`${example.section} :: ${example.program} :: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  expect(mismatches).toEqual([]);
  expect(compared).toBe(MANUAL_EXAMPLES.length - EXPECTED_EXCEPTIONS.length);
  // The two exceptions really are the examples that read PAGER, and nothing else reads it.
  expect(MANUAL_EXAMPLES.filter((example) => example.program.includes('PAGER')).map((e) => e.program)).toEqual(
    EXPECTED_EXCEPTIONS,
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// Errors. Texts are jq 1.8.2's own; the page shows them as they are, without the program name or the stdin location.
// ---------------------------------------------------------------------------------------------------------------------

it('a compile error carries jq message with its line and column and gives no output', () => {
  // jq prints: jq: error: syntax error, unexpected end of file at <top-level>, line 1, column 4:
  const err = failure(() => runJq(engine, '{}', '.a |', DEFAULTS));
  expect(err.message).toBe('syntax error, unexpected end of file at <top-level>');
  expect([err.part, err.line, err.column, err.output]).toEqual(['filter', 1, 4, '']);
  // Columns count bytes, as jq counts them: the filter "é" | is 5 characters and 6 bytes.
  const bytes = failure(() => runJq(engine, '{}', '"é" |', DEFAULTS));
  expect([bytes.line, bytes.column]).toEqual([1, 6]);
  // A filter that cannot compile because a name is unknown is a compile error too.
  const unknown = failure(() => runJq(engine, '{}', 'nosuchfunction', DEFAULTS));
  expect(unknown.message).toBe('nosuchfunction/0 is not defined at <top-level>');
  expect(unknown.part).toBe('filter');
  // A blank filter runs nothing.
  expect(runJq(engine, '{}', '  \n ', DEFAULTS)).toBeNull();
});

it('a run-time error gives jq message without the stdin location', () => {
  // jq prints: jq: error (at /dev/stdin:0): string ("x") and number (1) cannot be added
  const err = failure(() => runJq(engine, '{"a":"x"}', '.a + 1', DEFAULTS));
  expect(err.message).toBe('string ("x") and number (1) cannot be added');
  expect(err.part).toBe('run');
  expect(err.line).toBeUndefined();
  expect(err.message).not.toContain('stdin');
  // Output produced before the failure is kept.
  const partial = failure(() => runJq(engine, '[1,"x",3]', '.[] | . + 1', COMPACT));
  expect(partial.output).toBe('2');
  // A value that is not a string says so, as jq does.
  expect(failure(() => runJq(engine, 'null', 'error({"a":1})', COMPACT)).message).toBe('error (not a string): {"a":1}');
  expect(failure(() => runJq(engine, 'null', '"boom" | error', COMPACT)).message).toBe('boom');
  // Input that is not JSON is jq's parse error, with its own position text.
  const parse = failure(() => runJq(engine, '{bad', '.', DEFAULTS));
  expect(parse.message).toBe('parse error: Invalid numeric literal at EOF at line 1, column 4');
  expect(parse.part).toBe('input');
});

it('debug and stderr output come back apart from the result and halt_error is not an error', () => {
  const debug = runJq(engine, '1', 'debug', COMPACT)!;
  expect([debug.output, debug.stderr]).toEqual(['1', '["DEBUG:",1]']);
  const halted = runJq(engine, '1', '"bye" | halt_error(0)', COMPACT)!;
  expect(halted.stderr).toContain('bye');
});

// ---------------------------------------------------------------------------------------------------------------------
// Limits.
// ---------------------------------------------------------------------------------------------------------------------

it('input over 5 MiB is refused before the engine runs and exactly 5 MiB is accepted', () => {
  expect([MAX_INPUT_BYTES, MAX_OUTPUT_BYTES]).toEqual([5242880, 1048576]);
  const tooBig = '"' + 'a'.repeat(5242881 - 2) + '"';
  expect(new TextEncoder().encode(tooBig).length).toBe(5242881);
  const err = failure(() => runJq(untouchable, tooBig, 'length', DEFAULTS));
  expect(err.message).toBe(
    'This input is 5,242,881 bytes. The limit is 5 MiB (5,242,880 bytes) because the engine copies the input into memory while it runs.',
  );
  expect(err.part).toBe('input');
  // Bytes are counted, not characters: 1747627 euro signs are 5242881 bytes.
  const euros = '"' + '€'.repeat(1747627) + '"';
  expect(failure(() => runJq(untouchable, euros, 'length', DEFAULTS)).part).toBe('input');

  const exact = '"' + 'a'.repeat(5242880 - 2) + '"';
  expect(new TextEncoder().encode(exact).length).toBe(5242880);
  expect(runJq(engine, exact, 'length', COMPACT)!.output).toBe('5242878');
});

it('output over 1 MiB is cut at 1 MiB with a note', () => {
  const big = runJq(engine, 'null', '[range(250000)] | .[]', COMPACT)!;
  expect(big.truncated).toBe(true);
  expect(new TextEncoder().encode(big.output).length).toBe(1048576);
  expect(big.output.startsWith('0\n1\n2\n')).toBe(true);
  // A cut never lands inside a character: 2-byte characters give a cut one byte short, and no replacement character.
  const wide = runJq(engine, 'null', '"é" * 700000', COMPACT)!;
  expect(wide.truncated).toBe(true);
  const wideBytes = new TextEncoder().encode(wide.output).length;
  expect(wideBytes).toBeLessThanOrEqual(1048576);
  expect(wideBytes).toBeGreaterThanOrEqual(1048574);
  expect(wide.output).not.toContain('�');
  // Output under the limit is whole.
  const small = runJq(engine, 'null', '[range(10)] | .[]', COMPACT)!;
  expect([small.truncated, small.output.split('\n').length]).toEqual([false, 10]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Options, arguments, numbers, environment.
// ---------------------------------------------------------------------------------------------------------------------

it('each option changes the output the way the jq manual says', () => {
  const run = (input: string, filter: string, options: Partial<JqOptions>) =>
    runJq(engine, input, filter, { ...DEFAULTS, ...options })!.output;
  // The manual: output is pretty-printed with two spaces by default, --compact-output removes the whitespace,
  // --indent n and --tab change the indent, --raw-output prints a string without quotes, --slurp reads all the inputs
  // into one array, --sort-keys sorts object keys, --null-input does not read the input, --ascii-output escapes
  // everything outside ASCII.
  expect(run('{"a":[1,2]}', '.', {})).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  expect(run('{"a":[1,2]}', '.', { compact: true })).toBe('{"a":[1,2]}');
  expect(run('{"a":[1]}', '.', { indent: '4' })).toBe('{\n    "a": [\n        1\n    ]\n}');
  expect(run('{"a":[1]}', '.', { indent: 'tab' })).toBe('{\n\t"a": [\n\t\t1\n\t]\n}');
  expect(run('"hi"', '.', { raw: true })).toBe('hi');
  expect(run('1 2 3', '.', { slurp: true, compact: true })).toBe('[1,2,3]');
  expect(run('{"b":1,"a":2}', '.', { sortKeys: true, compact: true })).toBe('{"a":2,"b":1}');
  expect(run('{"b":1,"a":2}', '.', { compact: true })).toBe('{"b":1,"a":2}');
  expect(run('{"ignored":true}', '1 + 1', { nullInput: true })).toBe('2');
  expect(run('{"a":1}', '[inputs]', { nullInput: true, compact: true })).toBe('[{"a":1}]');
  expect(run('"é€"', '.', { ascii: true })).toBe('"\\u00e9\\u20ac"');
  // Several input values are each run through the filter, in order.
  expect(run('1 2 3', '. * 10', { compact: true })).toBe('10\n20\n30');
});

it('a filter that starts with a dash is a filter, never an option', () => {
  // Without a final -- jq would read a filter such as -c as its compact option and the run would not be the filter.
  expect(runJq(engine, '1', '-.', COMPACT)!.output).toBe('-1');
  expect(runJq(engine, '[5]', '-.[0]', COMPACT)!.output).toBe('-5');
  const err = failure(() => runJq(engine, '1', '-c', COMPACT));
  expect(err.message).toBe('c/0 is not defined at <top-level>');
  expect(err.part).toBe('filter');
});

it('arguments become argjson pairs and a name that is not a jq identifier is refused', () => {
  const run = (filter: string, args: string) => runJq(engine, 'null', filter, { ...COMPACT, args })!.output;
  expect(run('[$x, $y]', '{"x": 5, "y": "s"}')).toBe('[5,"s"]');
  // The value is passed as written: a big number is not rounded on the way in.
  expect(run('$big', '{"big": 12345678909876543212345}')).toBe('12345678909876543212345');
  // Nested values, braces and quotes inside strings and escapes do not confuse the reading of the object.
  expect(run('[$o.a[1], $s]', '{"o": {"a": [1, 2]}, "s": "a}\\"{,"}')).toBe('[2,"a}\\"{,"]');
  // A blank arguments text and an empty object pass nothing.
  expect(run('1', '')).toBe('1');
  expect(run('1', '  {}  ')).toBe('1');
  // The last of two equal names wins, as in JSON.parse.
  expect(run('$x', '{"x": 1, "x": 2}')).toBe('2');

  const badName = failure(() => run('1', '{"my-key": 1}'));
  expect(badName.message).toBe(
    'The argument name "my-key" is not a jq variable name. Use letters, digits and underscores, starting with a letter or an underscore.',
  );
  expect(badName.part).toBe('arguments');
  expect(failure(() => run('1', '{"1st": 1}')).message).toContain('"1st"');
  expect(failure(() => run('1', '[1, 2]')).message).toBe(
    'The arguments must be a JSON object such as {"name": "value"}.',
  );
  expect(failure(() => run('1', '{"a": }')).message).toMatch(/^The arguments are not valid JSON: /);
});

it('a big number literal round-trips and arithmetic on it follows double precision as jq documents', () => {
  // jq 1.8 manual, "Identity": a number literal that is not changed keeps its digits.
  const same = runJq(engine, '12345678909876543212345', '.', DEFAULTS)!;
  expect(typeof same.output).toBe('string');
  expect(same.output).toBe('12345678909876543212345');
  expect(runJq(engine, '{"a":12345678901234567890123}', '.a', DEFAULTS)!.output).toBe('12345678901234567890123');
  // Arithmetic converts to an IEEE double, which prints with 17 significant digits: 12345678901234568000000.
  expect(runJq(engine, '{"a":12345678901234567890123}', '.a+1', DEFAULTS)!.output).toBe('12345678901234568000000');
  // The page's text is jq's text: nothing parses it as a JavaScript number, so 9007199254740993 stays exact.
  expect(runJq(engine, '[9007199254740993]', '.[0]', DEFAULTS)!.output).toBe('9007199254740993');
});

it('env shows only the engine defaults, never this machine', () => {
  process.env.FODT_JQ_PROBE = 'machine-secret';
  try {
    const keys = runJq(engine, 'null', 'env | keys', COMPACT)!.output;
    expect(JSON.parse(keys)).toEqual(['HOME', 'LANG', 'LOGNAME', 'PATH', 'PWD', 'USER', '_']);
    expect(runJq(engine, 'null', '$ENV | tojson', COMPACT)!.output).not.toContain('machine-secret');
    expect(runJq(engine, 'null', 'env.FODT_JQ_PROBE', COMPACT)!.output).toBe('null');
    expect(runJq(engine, 'null', '$ENV.PATH', COMPACT)!.output).toBe('"/"');
  } finally {
    delete process.env.FODT_JQ_PROBE;
  }
  // Modules and files are not there either.
  expect(failure(() => runJq(engine, 'null', 'import "x" as x; .', COMPACT)).message).toBe('module not found: x');
});

it('meta pins jq-wasm exactly and declares the jq and Oniguruma notices', () => {
  expect(toolMeta.dependencies).toEqual({ 'jq-wasm': '3.0.0-jq-1.8.2' });
  const notices = toolMeta.bundledData as { name: string; noticeFile: string; attribution: string; licence: string }[];
  const byName = (name: string) => notices.find((entry) => entry.name === name);
  for (const name of ['jq 1.8.2', 'Oniguruma']) {
    const notice = byName(name);
    expect(notice, name).toBeDefined();
    expect(notice!.attribution).toContain('jq-wasm 3.0.0-jq-1.8.2');
    const file = join(here, '..', notice!.noticeFile);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8').trim().length).toBeGreaterThan(0);
  }
  expect(readFileSync(join(here, '..', byName('jq 1.8.2')!.noticeFile), 'utf8')).toContain(
    'jq is copyright (C) 2012 Stephen Dolan',
  );
  expect(readFileSync(join(here, '..', byName('Oniguruma')!.noticeFile), 'utf8')).toContain('Oniguruma LICENSE');
  expect(byName('jq 1.8.2')!.licence).toBe('MIT');
  expect(byName('Oniguruma')!.licence).toBe('BSD-2-Clause');
});

// ---------------------------------------------------------------------------------------------------------------------
// Last: a test that traps the engine runs on a fresh module of its own, after every other test (a trapped WebAssembly
// instance may be left in an undefined state).
// ---------------------------------------------------------------------------------------------------------------------

it('an engine abort becomes the plain out-of-memory message', async () => {
  const message = 'This filter ran out of memory.';
  expect(engineFailureMessage(new WebAssembly.RuntimeError('Aborted(). Build with -sASSERTIONS for more info.'))).toBe(
    message,
  );
  expect(engineFailureMessage(new Error('Aborted(OOM)'))).toBe(message);
  expect(engineFailureMessage(new Error('something else broke'))).toBe('something else broke');
  expect(engineFailureMessage('not an error object')).toBe('The background task failed for an unknown reason.');

  // A real abort: a string longer than the engine's 256 MiB memory ceiling. The engine prints its own notice.
  const fresh = await loadJq();
  let caught: unknown;
  try {
    runJq(fresh, 'null', '"x" * 300000000', COMPACT);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(JqPlaygroundError);
  expect(engineFailureMessage(caught)).toBe(message);
  // Only the engine's own abort notice was printed.
  expect(spies.flatMap((spy) => spy.mock.calls.map((call) => String(call[0])))).toEqual(['Aborted()']);
  for (const spy of spies) spy.mockClear();
  // A fresh module still works.
  expect(runJq(await loadJq(), 'null', '1 + 1', COMPACT)!.output).toBe('2');
});
