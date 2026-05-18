import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: [
      'tests/state/folderVisibilityStore.set.test.ts',
      'tests/invariants.fuzz.test.ts',
    ],
  },
})
