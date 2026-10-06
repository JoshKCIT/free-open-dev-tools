import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// The WebRTC and WebTransport names. `no-restricted-globals` only sees a bare name, so each block below also bans them
// as a member (`window.RTCPeerConnection`, `globalThis.WebTransport`, `self['RTCDataChannel']`) and as a name taken
// out by destructuring (`const { RTCPeerConnection } = window`).
const CONNECTION_NAMES = /^(webkitRTCPeerConnection|RTCPeerConnection|RTCDataChannel|WebTransport)$/;
const connectionSyntax = (message) => [
  { selector: `MemberExpression[computed=false][property.name=${CONNECTION_NAMES}]`, message },
  { selector: `MemberExpression[computed=true][property.value=${CONNECTION_NAMES}]`, message },
  { selector: `ObjectPattern > Property[key.name=${CONNECTION_NAMES}]`, message },
];

// Run-time code generation in every form lint can see: bare and indirect eval and `new Function` (no-eval,
// no-new-func), a timer given a string (no-implied-eval), eval or Function reached through `window`, `globalThis` or
// `self` (no-restricted-properties), and a function's constructor called directly, such as
// `(() => 0).constructor(text)`. The page policy refuses all of these at run time on a page that has not declared code
// generation; this catches them first. no-eval and no-implied-eval only follow names that are declared globals, and
// this config declares none for TypeScript, so CODE_GEN_GLOBALS names the ones they need.
const CODE_GEN_GLOBALS = {
  window: 'readonly',
  globalThis: 'readonly',
  self: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
};
const codeGenRules = (message) => ({
  'no-eval': 'error',
  'no-new-func': 'error',
  'no-implied-eval': 'error',
  'no-restricted-properties': [
    'error',
    ...['window', 'globalThis', 'self'].flatMap((object) =>
      ['eval', 'Function'].map((property) => ({ object, property, message })),
    ),
  ],
});
const codeGenSyntax = (message) => [
  { selector: "CallExpression > MemberExpression.callee[property.name='constructor']", message },
  { selector: "NewExpression > MemberExpression.callee[property.name='constructor']", message },
];

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
    languageOptions: { globals: CODE_GEN_GLOBALS },
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
      'no-restricted-syntax': [
        'error',
        ...connectionSyntax('A tool must never open a peer connection, data channel or transport.'),
        ...codeGenSyntax('A tool must never build code from text at run time.'),
      ],
      ...codeGenRules('A tool must never build code from text at run time.'),
    },
  },
  {
    // Every in-site link must load a new document, so the content security
    // policy written in the page the visitor is on is the one in force
    // (a policy in markup belongs to one document). The shared link pair in
    // components/SiteLink.tsx is the only place allowed to touch the router's
    // link components (the block after this one lifts the import ban there and
    // nothing else). The WebRTC names below are not governed by the page
    // policy's connect-src in every browser; WebTransport is governed by it,
    // and is banned as well so no app code opens a connection of that kind.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: CODE_GEN_GLOBALS },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['react-router-dom', 'react-router'].map((name) => ({
            name,
            // useLinkClickHandler, Form and useSubmit each move to another route inside the same document.
            importNames: [
              'Link',
              'NavLink',
              'useNavigate',
              'Navigate',
              'redirect',
              'useLinkClickHandler',
              'Form',
              'useSubmit',
            ],
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
      'no-restricted-syntax': [
        'error',
        ...connectionSyntax('App code must never open a peer connection, data channel or transport.'),
        {
          // A dynamic import of the router would reach its link components without the import ban above seeing them.
          selector: 'ImportExpression[source.value=/^react-router(-dom)?$/]',
          message:
            'Import the router statically: a dynamic import would reach its link components past the ban, and every in-site link must load a new document.',
        },
        ...codeGenSyntax('App code must never build code from text at run time.'),
      ],
      ...codeGenRules('App code must never build code from text at run time.'),
    },
  },
  {
    // The shared link pair is the one file that may import the router's link components. Only that ban is lifted;
    // every other app rule above still applies to it.
    files: ['apps/web/src/components/SiteLink.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.mjs', 'scripts/**/*.js'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
);
