module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules', '*.cjs', 'docs', 'scripts', 'services/promptTester.js'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  settings: { react: { version: 'detect' } },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'off',
    'no-console': 'off',
    // Tech-debt scoping (tracked in #p2-strict): the six @ts-nocheck services
    // predate strict typing; removing the directives fails tsc (44 errors).
    '@typescript-eslint/ban-ts-comment': 'off',
  },
  overrides: [
    {
      // Legacy prompt-engineering scripts use CommonJS require().
      files: ['services/promptTester.ts', 'services/modelEvalService.ts'],
      rules: { '@typescript-eslint/no-var-requires': 'off' },
    },
  ],
};
