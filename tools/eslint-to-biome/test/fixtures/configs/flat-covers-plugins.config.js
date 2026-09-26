// A flat eslint.config.js written for this tool's own tests, covering core
// rules, one rule from each of the six bundled plugins, one rule outside
// the bundled set, languageOptions.globals, files, ignores and plugins.
export default [
  {
    ignores: ['dist/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: { myGlobal: 'readonly' },
      parserOptions: { ecmaVersion: 2022 },
    },
    plugins: { react: {} },
    rules: {
      'no-debugger': 'error',
      '@typescript-eslint/no-unused-vars': 'warn',
      'react/jsx-key': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'jsx-a11y/alt-text': 'warn',
      'import/no-cycle': 'error',
      'unicorn/error-message': 'error',
      'vue/no-unused-vars': 'warn',
    },
  },
];
