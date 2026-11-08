// Lint: a few mechanical checks reviews kept catching by hand. Run: npx eslint .
import globals from 'globals';

const rules = {
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  'prefer-const': 'error',
  'no-unreachable': 'error',
};

export default [
  // test/t*.js are snippets run inside the app (top-level return/await, shared helpers from test/lib.js).
  { ignores: ['node_modules/', 'out/', 'dist/', 'build/', 'test/out/', 'test/t*.js', 'test/lib.js'] },
  { files: ['src/**/*.js'], languageOptions: { sourceType: 'module', globals: globals.browser }, rules },
  { files: ['electron/**/*.js', 'scripts/**/*.js'], languageOptions: { sourceType: 'commonjs', globals: globals.node }, rules },
  { files: ['test/**/*.mjs'], languageOptions: { sourceType: 'module', globals: globals.node }, rules },
];
