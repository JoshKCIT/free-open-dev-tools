/**
 * Does the font inspector's heavy work in a background worker: unpacks a WOFF or WOFF2 file and posts the font inside it
 * back as bytes, and, when the visitor asked for a conversion, converts the font, reads the result back and checks it, and
 * posts the converted bytes with the report. A TrueType or OpenType file that is only inspected is read on the page itself
 * and never starts this worker.
 *
 * The WOFF2 engine is imported from the tool folder by its relative path and by nothing else, so it reaches the build only
 * inside this worker and the page's own code never carries it. The package index does not import it either. The engine
 * builds part of its own code when it starts; that is why the page allows run-time code generation, and nothing opened
 * here is ever used as code.
 *
 * Every job gets a new worker (see run-font-inspector-in-worker.ts), so nothing read from a font is kept once it ends.
 * The engine is started before the ready message, so its start-up counts against the start limit and never against the
 * run limit. This worker posts `font-inspector-ready` as the very last statement of the module, after its message
 * listener exists: the page posts the job only when it has seen that message, so a job can never reach a worker that has
 * not finished starting (a module worker drops a message that arrives before its evaluation is over).
 *
 * A converted file is read back and checked next to the engine (verifyConversion) before its bytes are posted. When the
 * check finds a problem the report is posted and the bytes are not, so the page has nothing it could offer.
 */
import {
  FontInspectorError,
  convertSfnt,
  readWoff1Header,
  unpackWoff2,
  unwrapWoff1,
  verifyConversion,
  type ConversionReport,
  type ConvertTarget,
} from '@fodt/font-inspector';
import { woff2Compress, woff2Decompress } from '../../../../../tools/font-inspector/src/engine';

export interface FontInspectorJobMessage {
  type: 'font-inspector-job';
  /** The whole file. It is transferred to the worker, so the page must not use it afterwards. */
  bytes: Uint8Array;
  /** Which container the bytes are, as the page recognised it. */
  container: 'sfnt' | 'woff' | 'woff2';
  /** The conversion asked for, or 'none' to only unpack. */
  convertTo: 'none' | ConvertTarget;
  /** The opened file's name, used for the saved name only when the font has no usable name of its own. */
  fileName: string;
}

export interface FontInspectorReadyMessage {
  type: 'font-inspector-ready';
}

/** What the worker learned about the wrapper around the font, for the page to show. */
export interface FontInspectorWrapper {
  kind: 'woff' | 'woff2';
  fileSize: number;
  sfntSize: number;
  tableCount: number;
  notes: string[];
}

/** The outcome of a conversion that ran: the check's report and, only when the check passed, the file and its name. */
export interface FontInspectorConversion {
  target: ConvertTarget;
  report: ConversionReport;
  /** The converted file, transferred back; null when the check found a problem. */
  bytes: Uint8Array | null;
  name: string | null;
}

export interface FontInspectorWorkerResult {
  /** The font as a plain sfnt, transferred back. */
  sfnt: Uint8Array;
  /** The WOFF or WOFF2 wrapper the font came from, or null when it was already a plain sfnt. */
  wrapper: FontInspectorWrapper | null;
  /** Set when a conversion ran. */
  conversion: FontInspectorConversion | null;
  /** Set when the conversion was refused before it ran, in plain words. */
  refusal: string | null;
}

export interface FontInspectorDoneMessage {
  type: 'font-inspector-done';
  result: FontInspectorWorkerResult;
}

export interface FontInspectorErrorMessage {
  type: 'font-inspector-error';
  message: string;
}

export type FontInspectorWorkerMessage =
  FontInspectorReadyMessage | FontInspectorDoneMessage | FontInspectorErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's
 * own global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the
 * mismatch, the same pattern the other workers use.
 */
interface WorkerGlobal {
  postMessage(message: FontInspectorWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<FontInspectorJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

const MEMORY_MESSAGE = 'The font needed more memory than this tab could give.';
const UNKNOWN_MESSAGE = 'The background task failed for an unknown reason.';

/** A fixed sentence for any failure; a font's own text is never part of it. */
function failure(err: unknown): FontInspectorErrorMessage {
  if (err instanceof FontInspectorError) return { type: 'font-inspector-error', message: err.message };
  const text = err instanceof Error ? `${err.name} ${err.message}` : '';
  if (/RangeError|Invalid (array|string) length|allocation|memory/i.test(text)) {
    return { type: 'font-inspector-error', message: MEMORY_MESSAGE };
  }
  return { type: 'font-inspector-error', message: UNKNOWN_MESSAGE };
}

async function handleJob(message: FontInspectorJobMessage): Promise<void> {
  try {
    const { bytes, container, convertTo, fileName } = message;
    let sfnt: Uint8Array;
    let wrapper: FontInspectorWrapper | null = null;
    if (container === 'sfnt') {
      sfnt = bytes;
    } else if (container === 'woff2') {
      const unpacked = await unpackWoff2(bytes, woff2Decompress);
      sfnt = unpacked.sfnt.slice();
      wrapper = {
        kind: 'woff2',
        fileSize: bytes.length,
        sfntSize: sfnt.length,
        tableCount: unpacked.header.numTables,
        notes: unpacked.header.notes,
      };
    } else {
      const header = readWoff1Header(bytes);
      sfnt = unwrapWoff1(bytes);
      wrapper = {
        kind: 'woff',
        fileSize: bytes.length,
        sfntSize: sfnt.length,
        tableCount: header.numTables,
        notes: header.notes,
      };
    }

    // The conversion, when one was asked for: converted next to the engine, then read back and checked. A refusal in plain
    // words (the engine could not pack the font, a table lies outside the file) is posted as the reason; the font itself is
    // still posted so the page can show what it read.
    let conversion: FontInspectorConversion | null = null;
    let refusal: string | null = null;
    if (convertTo !== 'none') {
      try {
        const converted = await convertSfnt(
          { sfnt, source: container, target: convertTo, fileName },
          { woff2Compress, woff2Decompress },
        );
        const report = await verifyConversion(sfnt, converted.bytes, { woff2Decompress });
        conversion = {
          target: convertTo,
          report,
          bytes: report.ok ? converted.bytes : null,
          name: report.ok ? converted.name : null,
        };
      } catch (err) {
        if (!(err instanceof FontInspectorError)) throw err;
        refusal = err.message;
      }
    }
    // Both buffers move to the page. They are different buffers: the converted file is always a copy of its own.
    const transfer: Transferable[] = [sfnt.buffer];
    if (conversion?.bytes) transfer.push(conversion.bytes.buffer);
    workerGlobal.postMessage({ type: 'font-inspector-done', result: { sfnt, wrapper, conversion, refusal } }, transfer);
  } catch (err) {
    workerGlobal.postMessage(failure(err));
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});

// Start the engine now, so its start-up is counted against the start limit. A failure here is ignored: the job itself
// reports it in plain words if the engine really cannot run.
try {
  await woff2Decompress(new Uint8Array(0));
} catch {
  // Expected: an empty input is refused after the engine has started.
}

// Last statement of the module: the listener above exists and the engine has started, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'font-inspector-ready' });
