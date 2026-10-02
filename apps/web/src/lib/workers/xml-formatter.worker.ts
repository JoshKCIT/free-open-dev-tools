/**
 * Runs one Canonical XML or equivalence run and posts back its result or its error. Every canonical or compare run
 * of the XML formatter goes through this worker (see run-xml-formatter-in-worker.ts's own comment), and every run
 * gets a new one, so the engine and every document it parsed start clean each time and nothing is kept once the
 * run ends. Format, minify, check and the tree view never come here: they stay on the page.
 *
 * The engine is libxml2 compiled to WebAssembly by libxml2-wasm. The package carries its WebAssembly inside its own
 * JavaScript and awaits it at the top level of its module, so this worker is built as a module worker and the engine
 * is imported here, by a relative path into the tool folder's installed copy (the package is declared only in that
 * folder, so a bare import would not resolve from here; the path is five levels up from lib/workers to the
 * repository root). The tool folder itself imports only the engine's types, so the engine lands in this worker's
 * source and in no page chunk. This is the browser entry: the Node entry and the input provider that could read
 * files are never imported, so nothing a document names can be loaded.
 *
 * This worker posts `xml-formatter-ready` as the very last statement of the module. Module evaluation does not
 * finish until the import above has finished awaiting the engine, and the page posts the job only when it has seen
 * that message, so a job can never reach a worker that has not finished starting. The worker cannot report its own
 * timeout: it may be stuck inside one synchronous engine call, so the page owns the limit and terminates it.
 */
import * as libxml2 from '../../../../../tools/xml-formatter/node_modules/libxml2-wasm/lib/index.mjs';
import { canonicalizeXml, compareXml, XmlFormatterError, type C14nMode, type CompareResult } from '@fodt/xml-formatter';

export interface XmlFormatterJobMessage {
  type: 'xml-formatter-job';
  operation: 'canonical' | 'compare';
  text: string;
  /** The second document; only the compare operation reads it. */
  second: string;
  mode: C14nMode;
  /** Keep comments; only the canonical operation reads it (a comparison always leaves them out). */
  withComments: boolean;
}

export interface XmlFormatterReadyMessage {
  type: 'xml-formatter-ready';
}

export type XmlFormatterResult =
  { operation: 'canonical'; output: string } | { operation: 'compare'; result: CompareResult };

export interface XmlFormatterDoneMessage {
  type: 'xml-formatter-done';
  result: XmlFormatterResult;
}

export interface XmlFormatterErrorMessage {
  type: 'xml-formatter-error';
  message: string;
  line?: number;
  column?: number;
  part?: 'first' | 'second';
}

export type XmlFormatterWorkerMessage = XmlFormatterReadyMessage | XmlFormatterDoneMessage | XmlFormatterErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern the other workers use.
 */
interface WorkerGlobal {
  postMessage(message: XmlFormatterWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<XmlFormatterJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

const MEMORY_MESSAGE = 'The document needed more memory than this tab could give.';

function failureMessage(err: unknown): string {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/RuntimeError|Aborted|memory|allocation|Invalid array length/i.test(text)) return MEMORY_MESSAGE;
  return err instanceof Error && err.message ? err.message : 'The background task failed for an unknown reason.';
}

function handleJob(job: XmlFormatterJobMessage): void {
  try {
    const result: XmlFormatterResult =
      job.operation === 'compare'
        ? { operation: 'compare', result: compareXml(libxml2, job.text, job.second, { mode: job.mode }) }
        : {
            operation: 'canonical',
            output: canonicalizeXml(libxml2, job.text, { mode: job.mode, withComments: job.withComments }),
          };
    workerGlobal.postMessage({ type: 'xml-formatter-done', result });
  } catch (err) {
    if (err instanceof XmlFormatterError) {
      workerGlobal.postMessage({
        type: 'xml-formatter-error',
        message: err.message,
        line: err.line,
        column: err.column,
        part: err.part,
      });
    } else {
      workerGlobal.postMessage({ type: 'xml-formatter-error', message: failureMessage(err) });
    }
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});

// Last statement of the module: the engine has finished loading and the listener above exists, so a job posted now
// cannot be lost.
workerGlobal.postMessage({ type: 'xml-formatter-ready' });
