import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const base = process.env.VITE_BASE ?? '/';
const toolsDir = resolve(__dirname, '../../tools');

/**
 * Resolve every `@fodt/<id>` import straight to the tool's TypeScript source.
 *
 * The tool packages are the single source of truth. Pointing the site at their
 * source rather than at a built `dist` removes any chance of the deployed site
 * running a stale copy of logic the tests have already changed. The standalone
 * `tsc` build of each package is still exercised separately in CI, which is
 * what proves the folder works on its own.
 */
function toolAliases(): Record<string, string> {
  const alias: Record<string, string> = {};
  for (const id of readdirSync(toolsDir)) {
    if (!statSync(join(toolsDir, id)).isDirectory()) continue;
    alias[`@fodt/${id}`] = join(toolsDir, id, 'src', 'index.ts');
  }
  return alias;
}

export default defineConfig({
  base,
  plugins: [react()],
  resolve: { alias: toolAliases() },
  define: {
    'import.meta.env.VITE_COMMIT': JSON.stringify(process.env.VITE_COMMIT ?? 'development'),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(
      process.env.VITE_BUILD_DATE ?? new Date().toISOString().slice(0, 10),
    ),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Everything ships from our own origin. Nothing is fetched from a CDN at runtime.
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
