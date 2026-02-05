/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
  env: { node: true, es2021: true },
  plugins: ['prettier'],
  extends: ['eslint:recommended', 'prettier'],
  rules: { 'prettier/prettier': 'error' },
};
