/**
 * Runs one decode and posts back its report or its error. Every source map decode goes through this worker (see
 * run-source-map-decoder-in-worker.ts's own comment), and every run gets a new one, so nothing read from the maps is
 * kept once the run ends.
 *
 * The worker reads the opened map files itself: the page posts the `File` objects, their sizes are checked before any
 * of them is read, and each is read as text here. There is no WebAssembly and nothing to fetch: addresses inside a map
 * or a trace are text and are never requested.
 *
 * This worker posts `source-map-decoder-ready` as the very last statement of the module, after its message listener
 * exists. The page posts the job only when it has seen that message, so a job can never reach a worker that has not
 * finished starting (a module worker drops a message that arrives before its evaluation is over). The worker cannot
 * report its own timeout: it may be inside a long read, so the page owns the limit and terminates it.
 */
import {
  SourceMapError,
  checkInput,
  decodeStackTrace,
  type DecodeReport,
  type OpenedFile,
} from '@fodt/source-map-decoder';

export interface SourceMapDecoderJobMessage {
  type: 'source-map-decoder-job';
  trace: string;
  maps: string;
  /** The map files the visitor opened, still unread. */
  files: File[];
  context: number;
  hideIgnored: boolean;
}

export interface SourceMapDecoderReadyMessage {
  type: 'source-map-decoder-ready';
}

export interface SourceMapDecoderDoneMessage {
  type: 'source-map-decoder-done';
  report: DecodeReport;
}

export interface SourceMapDecoderErrorMessage {
  type: 'source-map-decoder-error';
  message: string;
}

export type SourceMapDecoderWorkerMessage =
  SourceMapDecoderReadyMessage | SourceMapDecoderDoneMessage | SourceMapDecoderErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's
 * own global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the
 * mismatch, the same pattern the hex viewer worker uses.
 */
interface WorkerGlobal {
  postMessage(message: SourceMapDecoderWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SourceMapDecoderJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

const MEMORY_MESSAGE = 'The decode needed more memory than this tab could give.';
const UNKNOWN_MESSAGE = 'The background task failed for an unknown reason.';

/** The decoder's own plain sentence for an expected failure; a memory failure is named as running out of memory. */
function failure(err: unknown): SourceMapDecoderErrorMessage {
  if (err instanceof SourceMapError) return { type: 'source-map-decoder-error', message: err.message };
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/RangeError|Invalid (array|string) length|allocation|memory/i.test(text)) {
    return { type: 'source-map-decoder-error', message: MEMORY_MESSAGE };
  }
  return { type: 'source-map-decoder-error', message: UNKNOWN_MESSAGE };
}

async function handleJob(message: SourceMapDecoderJobMessage): Promise<void> {
  try {
    // Sizes first: nothing is read from a file until the whole set is known to be within the limits.
    checkInput({ trace: message.trace, maps: message.maps, fileSizes: message.files.map((file) => file.size) });
    const opened: OpenedFile[] = [];
    for (const file of message.files) opened.push({ name: file.name, text: await file.text() });
    const report = decodeStackTrace({
      trace: message.trace,
      maps: message.maps,
      files: opened,
      context: message.context,
      hideIgnored: message.hideIgnored,
    });
    workerGlobal.postMessage({ type: 'source-map-decoder-done', report });
  } catch (err) {
    workerGlobal.postMessage(failure(err));
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'source-map-decoder-ready' });
