/**
 * A side-effect-only import of PDF.js's own worker build. This file exists
 * because pnpm's own node_modules layout resolves a package's dependency
 * only inside the package that declared it: `apps/web` never installs
 * `pdfjs-dist` itself, so `apps/web/src/lib/workers/pdf-to-image.worker.ts`
 * cannot import `pdfjs-dist/legacy/build/pdf.worker.mjs` directly -- it
 * imports this file by relative path instead, and this file's own
 * `pdfjs-dist` dependency is what pnpm actually resolves.
 *
 * Imports the `legacy/build/` worker, not the modern `build/` worker:
 * measured directly this session, the modern build throws
 * `UnknownErrorException: hashOriginal.toHex is not a function` the moment
 * a document is opened under plain Node, and pdfjs-dist's own modern build
 * prints "Please use the `legacy` build in Node.js environments" for
 * exactly this reason. This package's own `src/index.ts` re-exports the
 * matching `legacy/build/pdf.mjs` API entry, so the worker and the main
 * thread always agree on which build they are running -- confirmed
 * loading and rendering correctly both under plain Node (this package's
 * own standalone test suite) and on every tested browser project
 * (chromium, firefox, webkit, mobile-chrome).
 *
 * `pdf.worker.mjs` self-initialises through its own static class block
 * (`WorkerMessageHandler`'s `static { if (typeof window === "undefined" &&
 * ...) this.initializeFromPort(self); }`) -- no call from this file is
 * needed for that to run. Measured directly this session: after Vite's
 * production build inlined this worker (`?worker&inline`), every
 * `getDocument()` call hung forever, because this file being a *bare*
 * side-effect import with no consumed binding let Rollup's tree-shaking
 * drop it entirely -- this package's own `package.json` declares
 * `"sideEffects": false` (every tool folder does, so a folder copied out
 * on its own tree-shakes cleanly), and dropping this import dropped the
 * static block's own effect along with it. An earlier attempt at fixing
 * this by calling `initializeFromPort` explicitly from here, alongside the
 * static block, double-initialised the message handler once the real fix
 * below let both survive -- observed directly as recurring
 * `Cannot resolve callback N` / `Cannot read properties of undefined
 * (reading 'pullCall')` page errors from two competing handlers racing the
 * same underlying port. The real, single fix is `src/meta.json`'s own
 * `sideEffects` array naming this exact file, which
 * `scripts/sync-tools.mjs` now honours -- letting the static block run
 * exactly once, on its own.
 */
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
