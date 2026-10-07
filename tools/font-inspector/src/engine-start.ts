import type { ConvertEngine } from './convert';
import { EngineRefusedError } from './errors';
import { isCodeGenerationRefusal } from './woff2';

/**
 * Whether the WOFF2 engine started. The engine builds its bindings with run-time code generation while it starts, and
 * when the browser refuses that, the engine does not fail in a way a caller can catch: its start never settles (its calls
 * return promises that neither resolve nor reject), and the refusal reaches the global scope only as an unhandled
 * rejection, an EvalError. This was recorded with the real engine on Node 22.14.0 run with
 * `--disallow-code-generation-from-strings`.
 *
 * So the start is watched from two sides: the start call settling (either way) means the engine started, and a code
 * generation refusal among the unhandled rejections means it never will. This module starts no timer and touches no
 * global: the caller (the background worker) passes in how to listen to unhandled rejections and decides how long to
 * wait before it goes on without an answer.
 */

export type EngineStartState = 'started' | 'refused';

/**
 * Settles with 'started' once `start` settles (a call of the engine on an empty input, which the started engine refuses:
 * either outcome means it started), or with 'refused' when `onUnhandledRejection` reports a code generation refusal first.
 * `onUnhandledRejection` registers a listener and returns a function that removes it; the listener returns true when it
 * took the reason as the refusal (so the caller may stop the browser from reporting it again). Only a refusal is taken;
 * any other reason is left alone. The listener is removed as soon as the answer is known.
 */
export function watchEngineStart(
  start: Promise<unknown>,
  onUnhandledRejection: (listener: (reason: unknown) => boolean) => () => void,
): Promise<EngineStartState> {
  return new Promise<EngineStartState>((resolve) => {
    let settled = false;
    let stop: (() => void) | null = null;
    const finish = (state: EngineStartState): void => {
      if (settled) return;
      settled = true;
      if (stop) stop();
      resolve(state);
    };
    stop = onUnhandledRejection((reason) => {
      if (settled || !isCodeGenerationRefusal(reason)) return false;
      finish('refused');
      return true;
    });
    if (settled) stop();
    start.then(
      () => finish('started'),
      () => finish('started'),
    );
  });
}

/**
 * The engine's two calls, each waiting for the start first. Once the start was refused, every call fails at once with an
 * `EngineRefusedError` (which the unpacking and packing steps turn into their own plain sentence) and the engine itself is
 * never called again, so no job waits on an engine that will never answer. Work that needs no engine (WOFF 1.0, a
 * TrueType or OpenType file) never calls these at all.
 */
export function guardEngine(engine: ConvertEngine, state: Promise<EngineStartState>): ConvertEngine {
  const ready = async (): Promise<void> => {
    if ((await state) === 'refused') throw new EngineRefusedError();
  };
  return {
    async woff2Compress(input: Uint8Array): Promise<Uint8Array> {
      await ready();
      return engine.woff2Compress(input);
    },
    async woff2Decompress(input: Uint8Array): Promise<Uint8Array> {
      await ready();
      return engine.woff2Decompress(input);
    },
  };
}
