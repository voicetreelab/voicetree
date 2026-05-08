import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: [
      'tests/applyCommand.loadRoot.test.ts',
      'tests/state/folderVisibilityStore.set.test.ts',
      'tests/state/loadedRootsStore.test.ts',
      'tests/invariants.fuzz.test.ts',
    ],
  },
})
