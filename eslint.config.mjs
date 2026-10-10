import { FlatCompat } from '@eslint/eslintrc';
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
export default [
  { ignores: ['.next/**', '.next-test/**', '.next-capture/**', 'node_modules/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  // i18n (§45.6): no hard-coded UI text in JSX – every visible string comes from messages/*.json.
  // Symbols/punctuation-only literals (icons, separators) are fine; attributes like aria-label are checked too.
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/app/[[]locale[]]/p/[[]id[]]/opengraph-image/**'],
    rules: {
      'react/jsx-no-literals': ['error', {
        noStrings: false, ignoreProps: false, noAttributeStrings: false,
        allowedStrings: ['✓', '✕', '( )', '✎', '★', '…', '–', '·', '▴', '▾', '›', '‹', '↗', '!', '?', '•', '●', '(', ')', ':', '/', ',', '.', '🔒', '🔗', '✉', '📅', '🗓️', 'ℹ'],
      }],
    },
  },
];
