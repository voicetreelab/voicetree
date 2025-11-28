/**
 * Integration Test: Node Positioning Spacing
 *
 * BEHAVIOR TESTED:
 * - INPUT: Load example_real_large folder and apply positions
 * - OUTPUT: Nodes are properly spaced apart (> 5px)
 * - FAILURE CONDITION: More than 10% of node pairs are within 5px of each other
 *
 * This test catches positioning bugs where nodes overlap or are too close together.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Core, Position, NodeCollection, CollectionReturnValue, NodeSingular } from 'cytoscape'
import cytoscape from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk'
import type { FileLimitExceededError } from '@/shell/edge/main/graph/readAndDBEventsPath/fileLimitEnforce'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/applyGraphDeltaToUI'
import type { Graph, GraphDelta, GraphNode, UpsertNodeAction } from '@/pure/graph'
import { mapNewGraphToDelta } from '@/pure/graph'
import { fromCreateChildToUpsertNode } from '@/pure/graph/graphDelta/uiInteractionsToGraphDeltas'
import path from 'path'

describe('Node Positioning Spacing - Integration', () => {
  let cy: Core

  beforeEach(() => {
    // Initialize headless cytoscape
    cy = cytoscape({
      headless: true,
      elements: []
    })
  })

  afterEach(() => {
    cy.destroy()
  })

  it('should position nodes from example_real_large folder with proper spacing (< 10% overlap)', async () => {
    // GIVEN: Path to example_real_large folder
    const exampleFolderPath: string = path.resolve(process.cwd(), 'example_folder_fixtures', 'example_real_large')

    // WHEN: Load graph from disk (this applies positions)
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(exampleFolderPath))
    if (E.isLeft(loadResult)) throw new Error('Expected Right')
    const graph: Graph = loadResult.right

    // AND: Convert graph to delta and apply to UI
    const delta: GraphDelta = mapNewGraphToDelta(graph)
    applyGraphDeltaToUI(cy, delta)

    // THEN: All nodes should have positions
    const nodes: NodeCollection = cy.nodes()
    expect(nodes.length).toBeGreaterThan(0)

    // Log node positions for debugging
    console.log(`\n📍 Loaded ${nodes.length} nodes from example_real_large folder`)

    const nodesWithPositions: CollectionReturnValue = nodes.filter(node => {
      const position: Position = node.position()
      return position.x !== undefined && position.y !== undefined &&
             !isNaN(position.x) && !isNaN(position.y)
    })

    console.log(`✅ Nodes with valid positions: ${nodesWithPositions.length}/${nodes.length}`)

    // This will fail if positioning is broken
    expect(nodesWithPositions.length).toBe(nodes.length)

    // AND: Check that nodes are properly spaced
    const nodePairs: Array<{ node1: string; node2: string; distance: number }> = []
    const MIN_SPACING: 5 = 5 as const; // pixels

    for (let i: number = 0; i < nodes.length; i++) {
      for (let j: number = i + 1; j < nodes.length; j++) {
        const node1: NodeSingular = nodes[i]
        const node2: NodeSingular = nodes[j]
        const pos1: Position = node1.position()
        const pos2: Position = node2.position()

        const distance: number = Math.sqrt(
          Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.y - pos1.y, 2)
        )

        nodePairs.push({
          node1: node1.id(),
          node2: node2.id(),
          distance
        })
      }
    }

    // Count pairs that are too close together
    const tooClosePairs: { node1: string; node2: string; distance: number; }[] = nodePairs.filter(pair => pair.distance < MIN_SPACING)
    const overlapPercentage: number = (tooClosePairs.length / nodePairs.length) * 100

    // Log diagnostic info
    if (tooClosePairs.length > 0) {
      console.log(`\n⚠️  Found ${tooClosePairs.length} node pairs too close together (< ${MIN_SPACING}px):`)
      tooClosePairs.forEach(pair => {
        console.log(`  - ${pair.node1} <-> ${pair.node2}: ${pair.distance.toFixed(2)}px`)
      })
      console.log(`📊 Overlap percentage: ${overlapPercentage.toFixed(2)}%`)
    }

    // FAIL if more than 10% of pairs are too close
    expect(overlapPercentage).toBeLessThan(10)
  })

  it('should investigate child node position: simulates bug where cytoscape position diverges from graph model', async () => {
    // GIVEN: Load example_real_large folder
    const exampleFolderPath: string = path.resolve(process.cwd(), 'example_folder_fixtures', 'example_real_large')
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(exampleFolderPath))
    if (E.isLeft(loadResult)) throw new Error('Expected Right')
    const graph: Graph = loadResult.right

    // AND: Apply graph to cytoscape UI
    const delta: GraphDelta = mapNewGraphToDelta(graph)
    applyGraphDeltaToUI(cy, delta)

    // WHEN: Pick a parent node that has children (to ensure it has a position)
    const parentNodeId: string | undefined = Object.keys(graph.nodes).find(nodeId => {
      const node: GraphNode = graph.nodes[nodeId]
      return node.outgoingEdges.length > 0 && O.isSome(node.nodeUIMetadata.position)
    })

    if (!parentNodeId) throw new Error('No parent node with children found')

    const parentNode: GraphNode = graph.nodes[parentNodeId]
    const cyParentNode: NodeSingular = cy.getElementById(parentNodeId) as NodeSingular

    // SIMULATE THE BUG: Move node in Cytoscape (like user drag or layout would)
    // This diverges cytoscape position from the graph model
    const SIMULATED_DRAG_OFFSET: Position = { x: 500, y: 300 }
    const originalCyPosition: Position = { ...cyParentNode.position() }
    cyParentNode.position({
      x: originalCyPosition.x + SIMULATED_DRAG_OFFSET.x,
      y: originalCyPosition.y + SIMULATED_DRAG_OFFSET.y
    })
    const newCyPosition: Position = cyParentNode.position()

    // Graph model still has OLD position (this is the bug scenario)
    const graphModelPosition: Position | undefined = O.isSome(parentNode.nodeUIMetadata.position)
      ? parentNode.nodeUIMetadata.position.value
      : undefined

    // Create a child node using the STALE graph model's parent position
    const childDelta: GraphDelta = fromCreateChildToUpsertNode(graph, parentNode)
    const childNode: GraphNode = (childDelta[0] as UpsertNodeAction).nodeToUpsert
    const childPosition: Position | undefined = O.isSome(childNode.nodeUIMetadata.position)
      ? childNode.nodeUIMetadata.position.value
      : undefined

    // Calculate where child SHOULD be (relative to Cytoscape's current position)
    const childOffset: Position | undefined = childPosition && graphModelPosition
      ? { x: childPosition.x - graphModelPosition.x, y: childPosition.y - graphModelPosition.y }
      : undefined
    const expectedChildPosition: Position | undefined = childOffset
      ? { x: newCyPosition.x + childOffset.x, y: newCyPosition.y + childOffset.y }
      : undefined

    // The distance between where child IS vs where it SHOULD BE
    const childPositionError: number = childPosition && expectedChildPosition
      ? Math.sqrt(
          Math.pow(childPosition.x - expectedChildPosition.x, 2) +
          Math.pow(childPosition.y - expectedChildPosition.y, 2)
        )
      : 0

    // THIS TEST DOCUMENTS THE BUG:
    // Child should spawn near the parent's CURRENT Cytoscape position,
    // but instead spawns near the STALE graph model position.
    // Once fixed, child should spawn within SPAWN_RADIUS (200px) of Cytoscape position.
    const ACCEPTABLE_ERROR: number = 10 // px tolerance
    expect(
      childPositionError,
      `Child position error is ${childPositionError.toFixed(2)}px.
      Child spawned at ${JSON.stringify(childPosition)} but should be near ${JSON.stringify(expectedChildPosition)}.
      This bug occurs because fromCreateChildToUpsertNode uses parentNode.nodeUIMetadata.position
      (Graph model = ${JSON.stringify(graphModelPosition)}) instead of Cytoscape position (${JSON.stringify(newCyPosition)}).`
    ).toBeLessThan(ACCEPTABLE_ERROR)
  })
})
