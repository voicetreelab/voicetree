import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@vt\/graph-model$/, replacement: path.resolve(__dirname, '../../libraries/graph-model/src/index.ts') },
      { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(__dirname, '../../libraries/graph-model/src/$1') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
