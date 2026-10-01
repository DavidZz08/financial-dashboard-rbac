import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**'] },
  js.configs.recommended,
  {
    // Backend: CommonJS on Node
    files: ['backend/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    // Frontend: ES modules + React in the browser
    files: ['frontend/src/**/*.{js,jsx}', 'frontend/vite.config.js'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: { sourceType: 'module', ecmaVersion: 'latest', globals: { ...globals.browser, ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off', // small app, no TypeScript: prop shapes are covered by usage + tests
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^React$' }],
    },
  },
];
