import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'src/pure/graph/graph-operations/indexes/linkResolutionIndexes.test.ts',
      'src/pure/graph/nodes/folderCollapse.test.ts',
      'src/pure/graph/nodes/folderCollapse.redteam.test.ts',
      'src/pure/graph/positioning/placement/coordinate-conversions.test.ts',
    ],
  },
})
