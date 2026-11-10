import base from '@digecom/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  ...base,
  {
    ignores: [
      '.next/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'public/app/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
];
