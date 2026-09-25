/**
 * Runs one XPath evaluation job and posts back its result or its error.
 * Mirrors jsonpath.worker.ts's shape: no progress message (a synchronous
 * document parse plus one expression evaluation has no point partway
 * through where it could report how far along it is), and this worker
 * cannot report its own timeout either -- see run-xpath-tester-in-worker.ts's
 * own comment for why the page, not this file, owns the time limit.
 */
import { evaluateXPath, XPathTesterError, type XPathEvaluateResult } from '@fodt/xpath-tester';

/** One message the page sends to start a run. */
export interface XPathJobMessage {
  type: 'xpath-job';
  xml: string;
  expression: string;
  namespaces: Record<string, string>;
  maxNodes: number;
  rootNamespaces: boolean;
}

export interface XPathDoneMessage {
  type: 'xpath-done';
  result: XPathEvaluateResult;
}

export interface XPathErrorMessage {
  type: 'xpath-error';
  kind: 'xml' | 'expression';
  message: string;
  line?: number;
  column?: number;
}

export type XPathWorkerMessage = XPathDoneMessage | XPathErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime. Narrowing once into this small locally declared shape
 * sidesteps the mismatch, the same pattern jsonpath.worker.ts uses.
 */
interface WorkerGlobal {
  postMessage(message: XPathWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<XPathJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function handleJob(job: XPathJobMessage): void {
  try {
    const result = evaluateXPath(job.xml, job.expression, {
      namespaces: job.namespaces,
      maxNodes: job.maxNodes,
      rootNamespaces: job.rootNamespaces,
    });
    workerGlobal.postMessage({ type: 'xpath-done', result });
  } catch (err) {
    if (err instanceof XPathTesterError) {
      workerGlobal.postMessage({
        type: 'xpath-error',
        kind: err.kind,
        message: err.message,
        line: err.line,
        column: err.column,
      });
      return;
    }
    workerGlobal.postMessage({
      type: 'xpath-error',
      kind: 'expression',
      message: err instanceof Error ? err.message : 'The background task failed for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  handleJob(event.data);
});
