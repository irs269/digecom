import base from '@digecom/config/eslint';
import globals from 'globals';

export default [
  ...base,
  {
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      // L'injection de dépendances NestJS a besoin des imports « valeur » (emitDecoratorMetadata).
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  { files: ['**/*.js'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
];
