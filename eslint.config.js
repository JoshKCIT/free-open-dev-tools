import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Vendored fixtures under tools/*/test/fixtures/** are third-party
    // snapshots (AM1: never edited), so this project's own lint rules never
    // apply to them -- linting the same rule set on a foreign CommonJS test
    // file (motdotla/dotenv's own upstream tap tests, for example) would
    // otherwise fail on `require`/`Buffer`, which this repo's own source
    // never uses but a vendored Node script legitimately does.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'test-results/**',
      'playwright-report/**',
      'tools/*/test/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // A tool package must be able to run anywhere and must never transmit.
    // The catalog gate checks this too; this catches it earlier, in the editor.
    files: ['tools/**/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'A tool must never make a network request.' },
        { name: 'XMLHttpRequest', message: 'A tool must never make a network request.' },
        { name: 'WebSocket', message: 'A tool must never open a socket.' },
        { name: 'EventSource', message: 'A tool must never open a stream.' },
        { name: 'localStorage', message: 'A tool must never persist input.' },
        { name: 'sessionStorage', message: 'A tool must never persist input.' },
        { name: 'indexedDB', message: 'A tool must never persist input.' },
        { name: 'document', message: 'Tool logic must stay free of the DOM so it can run in Node and be tested.' },
        { name: 'RTCPeerConnection', message: 'A tool must never open a peer connection.' },
        { name: 'webkitRTCPeerConnection', message: 'A tool must never open a peer connection.' },
        { name: 'RTCDataChannel', message: 'A tool must never open a data channel.' },
        { name: 'WebTransport', message: 'A tool must never open a transport connection.' },
      ],
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // Every in-site link must load a new document, so the content security
    // policy written in the page the visitor is on is the one in force
    // (a policy in markup belongs to one document). The shared link pair in
    // components/SiteLink.tsx is the only place allowed to touch the router's
    // link components. The connection globals below are not governed by the
    // page policy's connect-src, so no app code may name them either.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/components/SiteLink.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['react-router-dom', 'react-router'].map((name) => ({
            name,
            importNames: ['Link', 'NavLink', 'useNavigate', 'Navigate', 'redirect'],
            message:
              'Use SiteLink or SiteNavLink: every in-site link must load a new document so the policy of the page you are on is the one in force.',
          })),
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'RTCPeerConnection', message: 'App code must never open a peer connection.' },
        { name: 'webkitRTCPeerConnection', message: 'App code must never open a peer connection.' },
        { name: 'RTCDataChannel', message: 'App code must never open a data channel.' },
        { name: 'WebTransport', message: 'App code must never open a transport connection.' },
      ],
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['**/*.mjs', 'scripts/**/*.js'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
);
