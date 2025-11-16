/**
 * Integration test for loadGraphFromDisk edge extraction
 *
 * BEHAVIOR TESTED:
 * - INPUT: Load a directory containing markdown files with wikilinks
 * - OUTPUT: Graph with correct edges extracted from wikilinks
 * - SIDE EFFECTS: None (pure loading test)
 *
 * This e2e-tests the integration of:
 * - Loading markdown files from disk
 * - Parsing markdown content to extract wikilinks
 * - Resolving wikilinks to node IDs
 * - Building graph edges from resolved links
 * - Reversing edges (converting outgoing to incoming edges)
 */

import { describe, it, expect } from 'vitest'
import { loadGraphFromDisk } from '@/functional/shell/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts'
import * as O from 'fp-ts/lib/Option.js'

describe('loadGraphFromDisk - Edge Extraction', () => {
  describe('BEHAVIOR: Extract edges from wikilinks in markdown files', () => {
    it('should create edge from node 181 to node _179 based on wikilink [[./_179.md]]', async () => {
      // GIVEN: vscode_spike folder with node 181 linking to _179
      const vaultPath = '/Users/bobbobby/repos/vaults/vscode_spike'

      // WHEN: Load graph from disk
      const graph = await loadGraphFromDisk(O.some(vaultPath))

      // THEN: Graph should contain both nodes
      expect(graph.nodes['181_Xavier_VS_Code_Integration_Summary_Path_C_Implementation_Analysis']).toBeDefined()
      expect(graph.nodes['_179']).toBeDefined()

      // AND: loadGraphFromDisk applies reverseGraphEdges twice (before and after applyPositions)
      // This means edges are back in their original form: 181 -> _179
      // So node 181 should have _179 in its outgoing edges
      const node181 = graph.nodes['181_Xavier_VS_Code_Integration_Summary_Path_C_Implementation_Analysis']

      expect(node181.outgoingEdges).toContain('_179')
    })
  })
})
