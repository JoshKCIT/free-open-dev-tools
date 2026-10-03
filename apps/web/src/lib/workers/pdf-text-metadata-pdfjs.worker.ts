/**
 * This is PDF.js's own worker, not this project's usual message-protocol worker: `apps/web` never installs `pdfjs-dist`
 * itself (pnpm resolves a package's own dependency only inside the package that declared it), so this file imports the
 * tool package's `pdf-worker-entry.ts` by relative path; that file's own `pdfjs-dist` dependency is what pnpm actually
 * resolves. `run-pdf-text-metadata-reader.ts` constructs this with the `?worker&inline` suffix and hands it to PDF.js
 * through the `PDFWorker` `port` option, never `workerSrc` and never a fake in-page worker, and builds a new one for every
 * read, so a document never meets the state of an earlier one.
 *
 * A bare side-effect import is safe here (unlike an ordinary tool folder): `tools/pdf-text-metadata/src/meta.json`'s own
 * `sideEffects` array names `pdf-worker-entry.ts`, which the sync script carries into that package's `package.json`, so the
 * production build keeps the worker's self-starting class block.
 */
import '../../../../../tools/pdf-text-metadata/src/pdf-worker-entry';
