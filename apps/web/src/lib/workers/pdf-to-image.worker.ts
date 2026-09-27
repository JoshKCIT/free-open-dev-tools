/**
 * This is PDF.js's own worker, not this project's usual message-protocol
 * worker: `apps/web` never installs `pdfjs-dist` itself (pnpm resolves a
 * package's own dependency only inside the package that declared it), so
 * this file imports the tool package's `pdf-worker-entry.ts` by relative
 * path -- that file's own `pdfjs-dist` dependency is what pnpm actually
 * resolves. `run-pdf-to-image.ts` constructs this with the `?worker&inline`
 * suffix and hands it to PDF.js through the `PDFWorker` `port` option,
 * never `workerSrc` and never a fake in-page worker.
 *
 * A bare side-effect import is safe here (unlike an ordinary tool folder):
 * `tools/pdf-to-image/src/meta.json`'s own `sideEffects` array names
 * `pdf-worker-entry.ts` explicitly, which `scripts/sync-tools.mjs` carries
 * into that package's `package.json` -- see that file's own header comment
 * for the production-build failure this fixes.
 */
import '../../../../../tools/pdf-to-image/src/pdf-worker-entry';
