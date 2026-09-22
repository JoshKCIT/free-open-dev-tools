import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'test-results/**', 'playwright-report/**'],
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
      ],
    },
  },
  {
    files: ['**/*.mjs', 'scripts/**/*.js'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
);
