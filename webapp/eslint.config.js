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

const daemonMutationAllowComment = 'vt-allow-direct-daemon-mutation-import'
const daemonMutationFixturePattern =
  /(^|[/\\])(?:__fixtures__|fixtures)[/\\]allowed-daemon-mutation-imports[/\\]/
const daemonMutationSpecifiersByModule = {
  '@vt/graph-model': new Set(['setWritePath', 'addReadPath', 'removeReadPath']),
  '@vt/graph-state': new Set(['dispatchCollapse', 'dispatchExpand']),
  '@vt/graph-state/state/collapseSetStore': new Set([
    'dispatchCollapse',
    'dispatchExpand',
  ]),
}

function normalizeFilePath(filename) {
  return filename.replaceAll('\\', '/')
}

function isDaemonPackageFile(filename) {
  return /(^|\/)packages\/graph-db-server\//.test(normalizeFilePath(filename))
}

function hasDaemonMutationAllowComment(sourceCode) {
  return sourceCode
    .getAllComments()
    .some(comment => comment.value.includes(daemonMutationAllowComment))
}

function getForbiddenDaemonMutationNames(node) {
  const source = node.source?.value
  if (typeof source !== 'string') {
    return []
  }

  const forbiddenSpecifiers = daemonMutationSpecifiersByModule[source]
  if (!forbiddenSpecifiers) {
    return []
  }

  return node.specifiers
    .filter(specifier =>
      specifier.type === 'ImportSpecifier' || specifier.type === 'ExportSpecifier')
    .map(specifier =>
      specifier.type === 'ImportSpecifier'
        ? specifier.imported.name
        : specifier.local.name)
    .filter(name => forbiddenSpecifiers.has(name))
}

const daemonBoundaryLintPlugin = {
  rules: {
    'no-direct-daemon-mutation-imports': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          forbidden:
            '{{name}} is daemon-owned. Route it through packages/graph-db-server or a daemon/session-backed main API path.',
        },
      },
      create(context) {
        const filename = context.filename ?? context.getFilename()
        const sourceCode = context.sourceCode ?? context.getSourceCode()
        if (
          isDaemonPackageFile(filename)
          || daemonMutationFixturePattern.test(filename)
          || hasDaemonMutationAllowComment(sourceCode)
        ) {
          return {}
        }

        return {
          ImportDeclaration(node) {
            if (node.importKind === 'type') {
              return
            }

            for (const name of getForbiddenDaemonMutationNames(node)) {
              context.report({
                node,
                messageId: 'forbidden',
                data: { name },
              })
            }
          },
          ExportNamedDeclaration(node) {
            if (!node.source) {
              return
            }

            for (const name of getForbiddenDaemonMutationNames(node)) {
              context.report({
                node,
                messageId: 'forbidden',
                data: { name },
              })
            }
          },
        }
      },
    },
  },
}

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
    files: [
      'packages/**/*.{ts,tsx}',
      'webapp/src/**/*.{ts,tsx}',
      'webapp/e2e-tests/**/*.{ts,tsx}',
    ],
    plugins: {
      'vt-boundary': daemonBoundaryLintPlugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2020,
      sourceType: 'module',
    },
    rules: {
      'vt-boundary/no-direct-daemon-mutation-imports': 'error',
    },
  },
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
