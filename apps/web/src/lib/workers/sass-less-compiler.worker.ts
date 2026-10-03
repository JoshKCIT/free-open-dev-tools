/**
 * Compiles one stylesheet and posts back its CSS, its warnings and the engine that made it, or an error. Every run of
 * the SCSS & Less Compiler goes through this worker (see run-sass-less-compiler-in-worker.ts's own comment), and every
 * run gets a new one, so the compilers start clean each time and nothing is kept once the work ends. A stylesheet that
 * never finishes can freeze whatever thread it runs on, which is why it runs here, and why the page can stop it for
 * real with terminate().
 *
 * The worker imports two things from the tool package, `compileStylesheet` and `StylesheetError`. The package holds both
 * engines: Dart Sass's pure JavaScript build with an importer that refuses every address, and Less built from its core
 * factory with a file manager and a plugin loader that refuse everything, so no file is read and no address is
 * requested from here. The engines are bundled into this worker at build time and loaded with the module, so the time
 * they take to load counts against the page's 10 second start limit and never against the run limit.
 *
 * This worker posts `sass-less-compiler-ready` as the very last statement of the module, after its message listener
 * exists. The page posts the job only when it has seen that message, so a job can never reach a worker that has not
 * finished starting (a module worker drops a message that arrives before its evaluation is over). The worker cannot
 * report its own timeout: it may be stuck inside one engine call, so the page owns the limit and terminates it.
 *
 * A job carries the stylesheet text and two choices. Only the CSS, the warnings and the engine's name come back, or an
 * error carrying the package's own plain message and position, or a fixed sentence and the error's own name for
 * anything else; never any stylesheet text beyond what the package already put in its messages.
 */
import { StylesheetError, compileStylesheet, type Language, type OutputStyle } from '@fodt/sass-less-compiler';

export interface SassLessCompilerJobMessage {
  type: 'sass-less-compiler-job';
  source: string;
  language: Language;
  style: OutputStyle;
}

export interface SassLessCompilerReadyMessage {
  type: 'sass-less-compiler-ready';
}

export interface SassLessCompilerDoneMessage {
  type: 'sass-less-compiler-done';
  css: string;
  warnings: string[];
  engine: string;
}

export interface SassLessCompilerErrorMessage {
  type: 'sass-less-compiler-error';
  message: string;
  kind?: 'syntax' | 'import' | 'limit';
  line?: number;
  column?: number;
}

export type SassLessCompilerWorkerMessage =
  SassLessCompilerReadyMessage | SassLessCompilerDoneMessage | SassLessCompilerErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the browser types tool pages need) but not the worker
 * library, so TypeScript resolves the ambient global in this file to a window-shaped global rather than the worker's
 * own global scope it actually is at runtime. Narrowing once into this small locally declared shape sidesteps the
 * mismatch, the same pattern the other workers use.
 */
interface WorkerGlobal {
  postMessage(message: SassLessCompilerWorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SassLessCompilerJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

/** The package's own plain message and position, or a fixed sentence and the error's own name. */
function describe(err: unknown): SassLessCompilerErrorMessage {
  if (err instanceof StylesheetError) {
    return {
      type: 'sass-less-compiler-error',
      message: err.message,
      kind: err.kind,
      ...(err.line !== undefined ? { line: err.line } : {}),
      ...(err.column !== undefined ? { column: err.column } : {}),
    };
  }
  const name = err instanceof Error && err.name !== '' ? err.name : 'Error';
  return {
    type: 'sass-less-compiler-error',
    message: `The background task could not compile this stylesheet (${name}).`,
  };
}

async function handleJob(job: SassLessCompilerJobMessage): Promise<void> {
  try {
    const { css, warnings, engine } = await compileStylesheet(job.source, { language: job.language, style: job.style });
    workerGlobal.postMessage({ type: 'sass-less-compiler-done', css, warnings, engine });
  } catch (err) {
    workerGlobal.postMessage(describe(err));
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});

// Last statement of the module: the listener above exists, so a job posted now cannot be lost.
workerGlobal.postMessage({ type: 'sass-less-compiler-ready' });
