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
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts'
import { mapNewGraphToDelta } from '@/pure/graph'
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
    const exampleFolderPath = path.resolve(process.cwd(), 'example_folder_fixtures', 'example_real_large')

    // WHEN: Load graph from disk (this applies positions)
    const graph = await loadGraphFromDisk(O.some(exampleFolderPath))

    // AND: Convert graph to delta and apply to UI
    const delta = mapNewGraphToDelta(graph)
    applyGraphDeltaToUI(cy, delta)

    // THEN: All nodes should have positions
    const nodes = cy.nodes()
    expect(nodes.length).toBeGreaterThan(0)

    // Log node positions for debugging
    console.log(`\n📍 Loaded ${nodes.length} nodes from example_real_large folder`)

    const nodesWithPositions = nodes.filter(node => {
      const position = node.position()
      return position.x !== undefined && position.y !== undefined &&
             !isNaN(position.x) && !isNaN(position.y)
    })

    console.log(`✅ Nodes with valid positions: ${nodesWithPositions.length}/${nodes.length}`)

    // This will fail if positioning is broken
    expect(nodesWithPositions.length).toBe(nodes.length)

    // AND: Check that nodes are properly spaced
    const nodePairs: Array<{ node1: string; node2: string; distance: number }> = []
    const MIN_SPACING = 5 // pixels

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const node1 = nodes[i]
        const node2 = nodes[j]
        const pos1 = node1.position()
        const pos2 = node2.position()

        const distance = Math.sqrt(
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
    const tooClosePairs = nodePairs.filter(pair => pair.distance < MIN_SPACING)
    const overlapPercentage = (tooClosePairs.length / nodePairs.length) * 100

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
})
