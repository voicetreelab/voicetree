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
import { loadGraphFromDisk } from '@/functional_graph/shell/main/readAndDBEventsPath/loadGraphFromDisk.ts'
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

      // AND: After reverseGraphEdges, node 181 should have an incoming edge from _179
      // (Because the original link in 181 is [[./_179.md]], which means 181 -> _179,
      //  and after reversal it becomes _179 -> 181)
      const node179 = graph.nodes['_179']

      // After reverseGraphEdges: the original outgoing edge 181 -> _179 becomes _179 -> 181
      // So _179 should have 181 in its outgoing edges
      expect(node179.outgoingEdges).toContain('181_Xavier_VS_Code_Integration_Summary_Path_C_Implementation_Analysis')
    })
  })
})
