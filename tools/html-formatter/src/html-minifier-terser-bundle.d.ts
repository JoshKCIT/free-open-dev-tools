/**
 * `@types/html-minifier-terser` types only the package's default entry
 * point; the pre-built browser bundle this folder imports instead
 * (`html-minifier-terser/dist/htmlminifier.esm.bundle`, see index.ts's own
 * comment for why) has the identical `minify`/`Options` shape, so this
 * declaration re-exports the installed types for that subpath.
 */
declare module 'html-minifier-terser/dist/htmlminifier.esm.bundle' {
  export { minify, Options } from 'html-minifier-terser';
}
