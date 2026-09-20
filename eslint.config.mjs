// @ts-check
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Two layers of rules:
 *  1. typescript-eslint "strict + stylistic, type-checked": the type-aware rules
 *     (floating promises, unsafe any, exhaustive switches) are what protects a money-handling
 *     service from silent mistakes.
 *  2. eslint-plugin-boundaries: the DDD layering is enforced, not just documented.
 *     domain -> nothing; application -> domain; infrastructure/presentation -> application, domain.
 */

// Selector helpers for the policies below. `same(type)` restricts a dependency to the same
// bounded context (src/<context>/...) as the importing file.
const same = (type) => ({ type, captured: { context: '{{from.element.captured.context}}' } });
// Node built-ins and npm packages, as opposed to files of this repository.
const EXTERNAL_MODULES = [{ module: { origin: 'external' } }, { module: { origin: 'core' } }];
const layers = (...targets) =>
  targets.map((target) => ({ element: typeof target === 'string' ? { type: target } : target }));

export default tseslint.config(
  { ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      sourceType: 'commonjs',
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'no-public' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      // Nest modules are legitimately empty, decorated classes.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true, project: './tsconfig.json' } },
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/ignore': ['src/**/*.spec.ts'],
      // Evaluated in order; the first matching descriptor wins. Cross-cutting folders come
      // first so that e.g. src/auth/auth.module.ts is "auth", not a bounded-context module.
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/**', partialMatch: false },
        { type: 'config', pattern: 'src/config/**', partialMatch: false },
        { type: 'auth', pattern: 'src/auth/**', partialMatch: false },
        { type: 'common', pattern: 'src/common/**', partialMatch: false },
        { type: 'health', pattern: 'src/health/**', partialMatch: false },
        { type: 'docs', pattern: 'src/docs/**', partialMatch: false },
        { type: 'domain', pattern: 'src/*/domain/**', partialMatch: false, capture: ['context'] },
        {
          type: 'application',
          pattern: 'src/*/application/**',
          partialMatch: false,
          capture: ['context'],
        },
        {
          type: 'infrastructure',
          pattern: 'src/*/infrastructure/**',
          partialMatch: false,
          capture: ['context'],
        },
        {
          type: 'presentation',
          pattern: 'src/*/presentation/**',
          partialMatch: false,
          capture: ['context'],
        },
        // Anything else directly under src/<context>/ is the context's own wiring (its Nest module).
        { type: 'context-root', pattern: 'src/*', partialMatch: false, capture: ['context'] },
      ],
      // Top-level files (AppModule, bootstrap) are the composition root.
      'boundaries/files': [{ category: 'app', pattern: 'src/*.ts', partialMatch: false }],
    },
    rules: {
      'boundaries/no-unknown-files': 'error',
      'boundaries/no-unknown-dependencies': 'error',
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          checkAllOrigins: true,
          message:
            '{{from.element.types.[0]}} must not depend on {{to.element.types.[0]}} ({{to.module.source}})',
          policies: [
            // The domain (and the shared kernel) is plain TypeScript: no framework, no libraries.
            { from: { element: { type: 'shared' } }, allow: { to: layers('shared') } },
            { from: { element: { type: 'domain' } }, allow: { to: layers('shared', same('domain')) } },
            // Every other layer may use packages and Node built-ins.
            {
              from: [{ element: { type: '!(domain|shared)' } }, { file: { categories: 'app' } }],
              allow: { to: EXTERNAL_MODULES },
            },
            {
              from: { element: { type: 'application' } },
              allow: { to: layers('shared', same('domain'), same('application')) },
            },
            {
              from: { element: { type: 'infrastructure' } },
              allow: {
                to: layers(
                  'shared',
                  'config',
                  same('domain'),
                  same('application'),
                  same('infrastructure'),
                ),
              },
            },
            {
              from: { element: { type: 'presentation' } },
              allow: {
                to: layers(
                  'shared',
                  'common',
                  'auth',
                  'config',
                  same('domain'),
                  same('application'),
                  same('presentation'),
                ),
              },
            },
            {
              from: { element: { type: 'context-root' } },
              allow: {
                to: layers(same('application'), same('infrastructure'), same('presentation')),
              },
            },
            { from: { element: { type: 'config' } }, allow: { to: layers('config') } },
            { from: { element: { type: 'auth' } }, allow: { to: layers('auth', 'config') } },
            { from: { element: { type: 'common' } }, allow: { to: layers('common', 'shared') } },
            { from: { element: { type: 'health' } }, allow: { to: layers('health', 'auth', 'config') } },
            { from: { element: { type: 'docs' } }, allow: { to: layers('docs', 'auth') } },
            {
              from: { file: { categories: 'app' } },
              allow: {
                to: [
                  { file: { categories: 'app' } },
                  ...layers('auth', 'common', 'config', 'docs', 'health', 'context-root', 'presentation'),
                ],
              },
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // supertest response bodies are untyped by design; assertions on them are the point.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
