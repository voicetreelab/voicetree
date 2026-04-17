import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'
import functional from 'eslint-plugin-functional'
import { fileURLToPath } from 'node:url'

const repoRootDir = fileURLToPath(new URL('../', import.meta.url))
const webappDir = fileURLToPath(new URL('./', import.meta.url))

const purePackageCytoscapeMessage =
  'Cytoscape must stay out of @vt/graph-model and @vt/graph-tools. Keep UI projection code in webapp.'

const businessLayerCytoscapeMessage =
  'Business-layer files must not reach into Cytoscape via cy.*. Keep this in a projection-layer adapter. Seed scope is src/**/business/** and will expand once BF-139 lands.'

export default tseslint.config([
  globalIgnores([
    '**/dist',
    '**/node_modules',
    'webapp/dist-electron',
    'webapp/.worktrees/**',
    'webapp/workers/**',
  ]),
  {
    basePath: repoRootDir,
    files: ['webapp/*.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.node.json',
        tsconfigRootDir: webappDir,
      },
    },
  },
  {
    basePath: repoRootDir,
    files: ['webapp/src/**/*.{ts,tsx}', 'webapp/e2e-tests/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: './tsconfig.app.json',
        tsconfigRootDir: webappDir,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../*', '../**'],
          message: 'Use absolute imports for cross-directory imports. Use @/* for src imports.'
        }, {
          group: ['/Users/*', '/Users/**', '/home/*', '/home/**', '/opt/*', '/opt/**'],
          message: 'Do not use absolute filesystem paths in imports. Use relative or alias imports.'
        }]
      }],
      'no-restricted-syntax': ['error', {
        selector: 'TSImportType[argument.literal.value=/^.(Users|home|opt)/]',
        message: 'Do not use absolute filesystem paths in inline import types. Use relative or alias imports.'
      }],
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
  {
    basePath: repoRootDir,
    files: ['packages/graph-model/**/*.{ts,tsx}', 'packages/graph-tools/**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      functional
    },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2020,
      sourceType: 'module',
    },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'cytoscape',
          message: purePackageCytoscapeMessage,
        }]
      }],
    },
  },
  {
    basePath: repoRootDir,
    files: ['webapp/src/**/business/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "MemberExpression[object.type='Identifier'][object.name='cy']",
        message: businessLayerCytoscapeMessage,
      }],
    },
  },
  {
    basePath: repoRootDir,
    files: [
      'webapp/**/pure/**/*.ts',
      'webapp/**/functional/**/*.ts',
      'webapp/**/functional/shell/edge/**/*.ts',
    ],
    plugins: {
      functional
    },
    rules: {
      'functional/no-let': 'error',
      'functional/prefer-readonly-type': ['error', {
        allowLocalMutation: false,
        allowMutableReturnType: false,
        ignoreClass: false,
        ignoreInterface: false
      }],
      'functional/immutable-data': 'off',
      'functional/no-classes': 'error',
      'functional/no-this-expressions': 'error',
      'functional/no-throw-statements': 'warn',
      'functional/no-try-statements': 'warn',
      'no-param-reassign': ['error', { props: true }],
      'prefer-const': 'error',
      'functional/no-loop-statements': 'warn',
      'functional/functional-parameters': ['error', {
        allowRestParameter: true,
        allowArgumentsKeyword: false,
        enforceParameterCount: false
      }]
    }
  },
  {
    basePath: repoRootDir,
    files: ['webapp/e2e-tests/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './e2e-tests/tsconfig.json',
        tsconfigRootDir: webappDir,
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'no-empty-pattern': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/typedef': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      'functional/no-let': 'off',
      'functional/immutable-data': 'off',
      'functional/no-loop-statements': 'off'
    }
  },
  {
    basePath: repoRootDir,
    files: ['webapp/src/**/integration-tests/**/*.test.{ts,tsx}'],
    plugins: {
      functional
    },
    rules: {
      'functional/no-let': 'off',
      'functional/immutable-data': 'off',
      'functional/no-loop-statements': 'off',
      'functional/prefer-readonly-type': 'off',
      'no-param-reassign': 'off'
    }
  }
])
