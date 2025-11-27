import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'
import functional from 'eslint-plugin-functional'

export default tseslint.config([
  globalIgnores(['dist', 'node_modules', 'dist-electron', '*.config.ts']),
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
      // Ban absolute filesystem paths (e.g., /Users/...)
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../*', '../**'],
          message: 'Use absolute imports for cross-directory imports. Use @/* for src imports.'
        }, {
          group: ['/Users/*', '/Users/**', '/home/*', '/home/**', '/opt/*', '/opt/**'],
          message: 'Do not use absolute filesystem paths in imports. Use relative or alias imports.'
        }]
      }],
      // Ban absolute filesystem paths in inline import types (matches /Users, /home, /opt)
      'no-restricted-syntax': ['error', {
        selector: 'TSImportType[argument.literal.value=/^.(Users|home|opt)/]',
        message: 'Do not use absolute filesystem paths in inline import types. Use relative or alias imports.'
      }],
      // Require explicit type annotations on variables and function returns
      '@typescript-eslint/typedef': ['error', {
        variableDeclaration: true,
        variableDeclarationIgnoreFunction: false,
      }],
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
      }],
    },
  },
  // Functional programming rules for functional architecture files
  {
    files: [
      '**/pure/**/*.ts',
      '**/functional/**/*.ts',
      '**/functional/shell/edge/**/*.ts',
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
  // Special rules for e2e test files and helpers
  {
    files: ['e2e-tests/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './e2e-tests/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
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
      // Relax type annotation requirements in tests
      '@typescript-eslint/typedef': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
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