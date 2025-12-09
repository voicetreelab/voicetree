import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/loadGraphFromDisk'
import { mapNewGraphToDelta } from '@/pure/graph/graphDelta/mapNewGraphtoDelta'
import cytoscape from 'cytoscape'
import type { Core } from 'cytoscape'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/applyGraphDeltaToUI'
import type { Graph, GraphNode, GraphDelta, NodeDelta } from '@/pure/graph'
import type { FileLimitExceededError } from '@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/fileLimitEnforce'

/**
 * Integration test for edge labels through the full pipeline:
 * Disk → loadGraphFromDisk → Graph → mapNewGraphToDelta → GraphDelta → applyGraphDeltaToUI → Cytoscape
 *
 * This test reproduces the real user scenario where labels appear empty in production
 * despite unit tests passing.
 */
describe('Edge Labels - Full Pipeline Integration Test', () => {
  let tempDir: string
  let cy: Core

  beforeEach(async () => {
    // Create temp vault directory
    tempDir = path.join(process.cwd(), 'test-fixtures', `temp-vault-${Date.now()}`)
    await fs.mkdir(tempDir, { recursive: true })

    // Initialize Cytoscape instance
    cy = cytoscape({
      headless: true,
      styleEnabled: false
    })
  })

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('should preserve relationship labels from markdown file through full pipeline to Cytoscape UI', async () => {
    console.log('\n=== FULL PIPELINE TEST: Edge Labels ===\n')

    // STEP 1: Create markdown files on disk with relationship labels
    const node5Content: "---\nnode_id: 5\ntitle: Understand Google Cloud Lambda Creation (5)\n---\n### Understand the process of creating a Google Cloud Lambda function.\n\nA bit of background on how I can actually create the lambda itself.\n\n-----------------\n_Links:_\nParent:\n- is_a_prerequisite_for [[3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation.md]]" = `---
node_id: 5
title: Understand Google Cloud Lambda Creation (5)
---
### Understand the process of creating a Google Cloud Lambda function.

A bit of background on how I can actually create the lambda itself.

-----------------
_Links:_
Parent:
- is_a_prerequisite_for [[3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation.md]]`

    const node3Content: "---\nnode_id: 3\ntitle: Setup G Cloud CLI and Understand Lambda Creation (3)\n---\nSetup instructions." = `---
node_id: 3
title: Setup G Cloud CLI and Understand Lambda Creation (3)
---
Setup instructions.`

    await fs.writeFile(path.join(tempDir, '5_Understand_G_Cloud_Lambda.md'), node5Content, 'utf-8')
    await fs.writeFile(path.join(tempDir, '3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation.md'), node3Content, 'utf-8')

    console.log('✓ Step 1: Created markdown files on disk')

    // STEP 2: Load graph from disk
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(tempDir), O.some(tempDir))
    if (E.isLeft(loadResult)) throw new Error('Expected Right')
    const graph: Graph = loadResult.right

    console.log('✓ Step 2: Loaded graph from disk')
    console.log('  Graph nodes:', Object.keys(graph.nodes))
    console.log('  All node IDs in graph:', JSON.stringify(Object.keys(graph.nodes), null, 2))

    // VERIFY: Graph should have edges with labels
    const node5: GraphNode = graph.nodes['5_Understand_G_Cloud_Lambda.md']
    expect(node5).toBeDefined()
    expect(node5.outgoingEdges).toHaveLength(1)

    console.log('  Node 5 outgoingEdges:', JSON.stringify(node5.outgoingEdges, null, 2))

    expect(node5.outgoingEdges[0]).toEqual({
      targetId: '3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation.md',
      label: 'is_a_prerequisite_for'
    })

    console.log('✓ Step 3: Verified edge has label in Graph')

    // STEP 3: Convert graph to GraphDelta
    const delta: GraphDelta = mapNewGraphToDelta(graph)

    console.log('✓ Step 4: Converted graph to GraphDelta')
    console.log('  Delta length:', delta.length)

    // Find node 5 in delta
    const node5Delta: NodeDelta | undefined = delta.find(d => d.type === 'UpsertNode' && d.nodeToUpsert.relativeFilePathIsID === '5_Understand_G_Cloud_Lambda.md')
    expect(node5Delta).toBeDefined()

    if (node5Delta?.type === 'UpsertNode') {
      console.log('  Node 5 in delta - outgoingEdges:', JSON.stringify(node5Delta.nodeToUpsert.outgoingEdges, null, 2))

      expect(node5Delta.nodeToUpsert.outgoingEdges).toHaveLength(1)
      expect(node5Delta.nodeToUpsert.outgoingEdges[0]).toEqual({
        targetId: '3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation.md',
        label: 'is_a_prerequisite_for'
      })
    }

    console.log('✓ Step 5: Verified edge has label in GraphDelta')

    // STEP 4: Apply delta to Cytoscape UI
    applyGraphDeltaToUI(cy, delta)

    console.log('✓ Step 6: Applied GraphDelta to Cytoscape UI')
    console.log('  Cytoscape nodes:', cy.nodes().length)
    console.log('  Cytoscape edges:', cy.edges().length)

    // VERIFY: Cytoscape should have edge with label
    const cytoscapeEdge: cytoscape.EdgeCollection = cy.edges('[source="5_Understand_G_Cloud_Lambda.md"][target="3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation.md"]')

    expect(cytoscapeEdge.length).toBe(1)

    const edgeLabel: string = cytoscapeEdge.data('label')
    console.log('  Edge label in Cytoscape:', JSON.stringify(edgeLabel))

    // Note: Underscores are intentionally replaced with spaces in UI (see applyGraphDeltaToUI.test.ts)
    expect(edgeLabel).toBe('is a prerequisite for')

    console.log('✓ Step 7: Verified edge label in Cytoscape UI')
    console.log('\n=== TEST PASSED ===\n')
  })

  it('should handle multiple edges with different labels', async () => {
    const nodeWithMultipleEdges: "---\ntitle: Main Node\n---\nContent here.\n\n_Links:_\n- references [[node-a]]\n- extends [[node-b]]\n- implements [[node-c]]" = `---
title: Main Node
---
Content here.

_Links:_
- references [[node-a]]
- extends [[node-b]]
- implements [[node-c]]`

    await fs.writeFile(path.join(tempDir, 'main.md'), nodeWithMultipleEdges, 'utf-8')
    await fs.writeFile(path.join(tempDir, 'node-a.md'), '# Node A', 'utf-8')
    await fs.writeFile(path.join(tempDir, 'node-b.md'), '# Node B', 'utf-8')
    await fs.writeFile(path.join(tempDir, 'node-c.md'), '# Node C', 'utf-8')

    const loadResult2: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(tempDir), O.some(tempDir))
    if (E.isLeft(loadResult2)) throw new Error('Expected Right')
    const graph: Graph = loadResult2.right
    const delta: GraphDelta = mapNewGraphToDelta(graph)
    applyGraphDeltaToUI(cy, delta)

    const mainNode: GraphNode = graph.nodes['main.md']
    expect(mainNode.outgoingEdges).toHaveLength(3)
    expect(mainNode.outgoingEdges).toEqual([
      { targetId: 'node-a.md', label: 'references' },
      { targetId: 'node-b.md', label: 'extends' },
      { targetId: 'node-c.md', label: 'implements' }
    ])

    // Verify in Cytoscape
    const edgeA: cytoscape.EdgeCollection = cy.edges('[source="main.md"][target="node-a.md"]')
    const edgeB: cytoscape.EdgeCollection = cy.edges('[source="main.md"][target="node-b.md"]')
    const edgeC: cytoscape.EdgeCollection = cy.edges('[source="main.md"][target="node-c.md"]')

    expect(edgeA.data('label')).toBe('references')
    expect(edgeB.data('label')).toBe('extends')
    expect(edgeC.data('label')).toBe('implements')
  })
})
