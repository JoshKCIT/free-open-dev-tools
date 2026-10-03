/**
 * Makes one RSA key pair and posts back its PKCS#8 and SubjectPublicKeyInfo bytes, or an error. Every RSA run of the
 * key converter goes through this worker (see run-key-converter-in-worker.ts's own comment), and every run gets a new
 * one. Generating an RSA key can freeze the page of at least one browser engine for seconds when it runs on the page's
 * own thread, which is why it runs here, and why the page can stop it for real with terminate().
 *
 * The worker imports one function from the tool package, `generateRsa`, which asks the browser's Web Crypto generator
 * for the key; no other source of randomness exists in it. Nothing is fetched, stored or logged here. Only the two
 * byte arrays leave the worker, transferred rather than copied, and an error carries a fixed sentence and the error's
 * own name, never any key bytes.
 *
 * This worker posts `key-converter-ready` as the very last statement of the module, after its message listener exists.
 * The page posts the job only when it has seen that message, so a job can never reach a worker that has not finished
 * starting (a module worker drops a message that arrives before its evaluation is over). The worker cannot report its
 * own timeout: it may be stuck inside one engine call, so the page owns the limit and terminates it.
 */
import { generateRsa } from '@fodt/key-converter';

export interface KeyConverterJobMessage {
  type: 'key-converter-job';
  bits: 2048 | 3072 | 4096;
}

export interface KeyConverterReadyMessage {
  type: 'key-converter-ready';
}

export interface KeyConverterDoneMessage {
  type: 'key-converter-done';
  pkcs8: Uint8Array;
  spki: Uint8Array;
}

export interface KeyConverterErrorMessage {
  type: 'key-converter-error';
  message: string;
}

export type KeyConverterWorkerMessage = KeyConverterReadyMessage | KeyConverterDoneMessage | KeyConverterErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's
 * own global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the
 * mismatch, the same pattern the other workers use.
 */
interface WorkerGlobal {
  postMessage(message: KeyConverterWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<KeyConverterJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

/** A fixed sentence and the error's own name. The package's own errors carry plain messages that hold no key bytes. */
function describe(err: unknown): string {
  if (err instanceof Error && err.name === 'KeyConverterError') return err.message;
  const name = err instanceof Error && err.name !== '' ? err.name : 'Error';
  return `The background task could not make the key (${name}).`;
}

async function handleJob(job: KeyConverterJobMessage): Promise<void> {
  try {
    const { pkcs8, spki } = await generateRsa(job.bits);
    workerGlobal.postMessage({ type: 'key-converter-done', pkcs8, spki }, [
      pkcs8.buffer as ArrayBuffer,
      spki.buffer as ArrayBuffer,
    ]);
  } catch (err) {
    workerGlobal.postMessage({ type: 'key-converter-error', message: describe(err) });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'key-converter-ready' });
