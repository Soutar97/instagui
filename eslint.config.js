// @ts-check
import tseslint from 'typescript-eslint';

// AD-2 dependency rule (enforced here, verified by test/eslint-dep-rule.test.ts):
//   shared/ imports nothing internal.
//   core/   imports only shared/ (+ externals).
//   server/ + cli/ sit on top.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core/**', '**/server/**', '**/cli/**'],
              message:
                'AD-2: shared/ must not import internal modules (core/server/cli). It stays instagui-agnostic.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/server/**', '**/cli/**'],
              message: 'AD-2: core/ may import only shared/ and externals, never server/ or cli/.',
            },
          ],
        },
      ],
    },
  },
);
