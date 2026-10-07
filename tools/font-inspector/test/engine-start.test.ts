import { expect, it } from 'vitest';
import {
  FontInspectorError,
  convertSfnt,
  guardEngine,
  unpackWoff2,
  unwrapWoff1,
  verifyConversion,
  watchEngineStart,
} from '../src/index';
import { woff2Compress, woff2Decompress } from '../src/engine';
import { fontBytes } from './fixtures/fonts';

/*
 * The WOFF2 engine builds its bindings with run-time code generation while it starts. How the real engine behaves when that
 * is refused was recorded on Node 22.14.0 with `--disallow-code-generation-from-strings`, the switch that refuses it as a
 * page policy without code generation would: the engine module imports, its start never settles (a call neither resolves
 * nor rejects within 5 seconds), and an EvalError reaches the global scope as an unhandled rejection. The fake engine below
 * behaves exactly that way: its calls return promises that never settle, and the refusal arrives only as an unhandled
 * rejection the test emits. Unit tests never start a process, so the recording is not repeated here.
 */

const UNPACK_REFUSED =
  'The browser did not allow this page to generate code at run time, which the WOFF2 engine needs, so the file could not be unpacked.';
const PACK_REFUSED =
  'The browser did not allow this page to generate code at run time, which the WOFF2 engine needs, so the font could not be packed.';

/** A stand-in for the global scope's unhandled rejections: listeners say whether they handled a reason. */
function rejections(): {
  on: (listener: (reason: unknown) => boolean) => () => void;
  emit: (reason: unknown) => boolean;
  count: () => number;
} {
  const listeners = new Set<(reason: unknown) => boolean>();
  return {
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(reason) {
      let handled = false;
      for (const listener of [...listeners]) if (listener(reason)) handled = true;
      return handled;
    },
    count: () => listeners.size,
  };
}

it('when the browser refuses code generation the engine never starts, WOFF2 work says so in plain words and WOFF work goes on', async () => {
  const global = rejections();
  let calls = 0;
  const pending = (): Promise<Uint8Array> => {
    calls++;
    return new Promise<Uint8Array>(() => {});
  };
  const neverStarts = { woff2Compress: pending, woff2Decompress: pending };

  const state = watchEngineStart(neverStarts.woff2Decompress(new Uint8Array(0)), global.on);
  // A rejection that is not a refusal is left for the browser to report; the refusal is taken, and the watch stops listening.
  expect(global.emit(new TypeError('something else went wrong'))).toBe(false);
  expect(global.emit(new EvalError('Code generation from strings disallowed for this context'))).toBe(true);
  expect(await state).toBe('refused');
  expect(global.count()).toBe(0);

  // Every call of the guarded engine fails at once with the sentence for its own step, and the engine is never called again.
  calls = 0;
  const engine = guardEngine(neverStarts, state);
  const unpacked = await unpackWoff2(fontBytes('plain.woff2'), engine.woff2Decompress).catch((err: unknown) => err);
  expect(unpacked).toBeInstanceOf(FontInspectorError);
  expect((unpacked as Error).message).toBe(UNPACK_REFUSED);
  const packed = await convertSfnt(
    { sfnt: fontBytes('plain.ttf'), source: 'sfnt', target: 'woff2', fileName: 'plain.ttf' },
    engine,
  ).catch((err: unknown) => err);
  expect(packed).toBeInstanceOf(FontInspectorError);
  expect((packed as Error).message).toBe(PACK_REFUSED);
  expect(calls).toBe(0);

  // WOFF needs no engine: a TrueType font still converts to WOFF, reads back and passes the check, with the same engine.
  const woff = await convertSfnt(
    { sfnt: fontBytes('plain.ttf'), source: 'sfnt', target: 'woff', fileName: 'plain.ttf' },
    engine,
  );
  const report = await verifyConversion(fontBytes('plain.ttf'), woff.bytes, engine);
  expect(report.problems).toEqual([]);
  expect(report.ok).toBe(true);
  expect(unwrapWoff1(fontBytes('plain.woff')).length).toBeGreaterThan(0);
  expect(calls).toBe(0);
});

it('an engine that starts settles its start call, and the guarded engine then unpacks and packs as the engine does', async () => {
  const global = rejections();
  // The start is a call on an empty input, which the started engine refuses: either outcome means it started.
  const state = watchEngineStart(woff2Decompress(new Uint8Array(0)), global.on);
  expect(await state).toBe('started');
  expect(global.count()).toBe(0);
  // A refusal that arrives after the start is not taken: nothing is listening any more.
  expect(global.emit(new EvalError('late'))).toBe(false);

  const engine = guardEngine({ woff2Compress, woff2Decompress }, state);
  const direct = await unpackWoff2(fontBytes('plain.woff2'), woff2Decompress);
  const guarded = await unpackWoff2(fontBytes('plain.woff2'), engine.woff2Decompress);
  expect(Buffer.from(guarded.sfnt).equals(Buffer.from(direct.sfnt))).toBe(true);
  const packed = await convertSfnt(
    { sfnt: fontBytes('plain.ttf'), source: 'sfnt', target: 'woff2', fileName: 'plain.ttf' },
    engine,
  );
  const report = await verifyConversion(fontBytes('plain.ttf'), packed.bytes, engine);
  expect(report.ok).toBe(true);

  // A start that resolves counts as started too.
  expect(await watchEngineStart(Promise.resolve(new Uint8Array(0)), global.on)).toBe('started');
});
