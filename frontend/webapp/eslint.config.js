import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'
import functional from 'eslint-plugin-functional'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Ban relative parent directory imports
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../*', '../**'],
          message: 'Use absolute imports from project root instead of relative parent paths. Use @/* for src imports.'
        }]
      }]
    },
  },
  // Functional programming rules for functional architecture files
  {
    files: [
      'src/functional_graph/**/*.ts',
      'src/graph-core/functional/**/*.ts',
      'electron/graph/**/*.ts',
      'electron/handlers/**/*.ts'
    ],
    // Exclude imperative shells (GraphStateManager is allowed to use classes)
    ignores: [
      'src/functional_graph/shell/renderer/GraphStateManager.ts',
      'src/graph-core/functional/GraphStateManager.ts'
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
  // Special rules for test files
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
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
  }
])