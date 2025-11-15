import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'
import functional from 'eslint-plugin-functional'

export default tseslint.config([
  globalIgnores(['dist']),
  // Config files use tsconfig.node.json
  {
    files: ['*.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.node.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['*.config.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: './tsconfig.app.json',
      },
    },
    rules: {
      // Unused variables detection
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_'
      }],
      // Promise handling - prevent unhandled async bugs
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Nullish coalescing - prevent || bugs with falsy values
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      // Ban parent directory imports (allow same-directory imports)
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../*', '../**'],
          message: 'Use absolute imports for cross-directory imports. Use @/* for src imports.'
        }]
      }]
    },
  },
  // Functional programming rules for functional architecture files
  {
    files: [
      'src/functional/**/*.ts',
      'src/graph-core/functional/**/*.ts',
        '**/functional/**/*.ts',
    ],
    plugins: {
      functional
    },
    rules: {
      // Immutability - no let, use const
      'functional/no-let': 'error',
      'functional/prefer-readonly-type': ['error', {
        allowLocalMutation: false,
        allowMutableReturnType: false,
        ignoreClass: false,
        ignoreInterface: false
      }],
      // Note: functional/immutable-data requires type info, disabled
      'functional/immutable-data': 'off',

      // No classes or OOP
      'functional/no-classes': 'error',
      'functional/no-this-expressions': 'error',

      // No exceptions (prefer Either/Option)
      'functional/no-throw-statements': 'warn',
      'functional/no-try-statements': 'warn',

      // No mutations - use native ESLint rules instead
      'no-param-reassign': ['error', { props: true }],
      'prefer-const': 'error',

      // Disallow imperative loops (prefer map/filter/reduce)
      'functional/no-loop-statements': 'warn',

      // Functional style
      'functional/functional-parameters': ['error', {
        allowRestParameter: true,
        allowArgumentsKeyword: false,
        enforceParameterCount: false
      }]
    }
  },
  // Special rules for e2e test files
  {
    files: ['e2e-tests/**/*.test.{ts,tsx}', 'e2e-tests/**/*.spec.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './e2e-tests/tsconfig.json',
      },
    },
    rules: {
      // Disable react-hooks rules in test files (Playwright's 'use' is not a React hook)
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      // Allow empty pattern for Playwright fixture args
      'no-empty-pattern': 'off',
      // Allow require imports in test files
      '@typescript-eslint/no-require-imports': 'off',
      // Allow any in test files for mock types
      '@typescript-eslint/no-explicit-any': 'warn',
      // Relax functional rules in e2e-tests
      'functional/no-let': 'off',
      'functional/immutable-data': 'off',
      'functional/no-loop-statements': 'off'
    }
  },
  // Special rules for integration test files in src
  {
    files: ['src/**/integration-tests/**/*.test.{ts,tsx}'],
    rules: {
      // Relax functional rules in integration tests (they need mutable state for test setup)
      'functional/no-let': 'off',
      'functional/immutable-data': 'off',
      'functional/no-loop-statements': 'off',
      'functional/prefer-readonly-type': 'off',
      'no-param-reassign': 'off'
    }
  }
])