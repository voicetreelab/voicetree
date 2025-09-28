import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

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
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
])