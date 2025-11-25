/**
 * Integration test for spawnTerminalWithNewContextNode
 *
 * BEHAVIOR TESTED:
 * - INPUT: A parent node ID and Cytoscape instance
 * - OUTPUT:
 *   - A new context node created on disk
 *   - A terminal spawned attached to the context node
 *   - Terminal has initialEnvVars.initial_content set to context node content
 * - SIDE EFFECTS:
 *   - New context node markdown file written to disk
 *   - Terminal added to state
 *
 * This tests the integration of:
 * - Creating context node from parent node
 * - Reading context node content
 * - Spawning terminal with environment variables
 * - Setting initial_content env var to context node content
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawnTerminalWithNewContextNode } from '@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI.ts'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts'
import { setGraph, setVaultPath, getVaultPath, getGraph } from '@/shell/edge/main/state/graph-store.ts'
import { EXAMPLE_SMALL_PATH } from '@/utils/test-utils/fixture-paths.ts'
import * as O from 'fp-ts/lib/Option.js'
import { promises as fs } from 'fs'
import path from 'path'
import type { NodeIdAndFilePath } from '@/pure/graph'
import cytoscape from 'cytoscape'
import type { Core } from 'cytoscape'
import { getTerminals } from '@/shell/edge/UI-edge/state/UIAppState.ts'
import { createContextNode } from '@/shell/edge/main/graph/createContextNode.ts'

describe('spawnTerminalWithNewContextNode - Integration Tests', () => {
  let createdContextNodeIds: NodeIdAndFilePath[] = []
  let parentNodeBackups: Map<NodeIdAndFilePath, string> = new Map()
  let cy: Core

  beforeEach(async () => {
    // Initialize vault path with example_small fixture
    setVaultPath(EXAMPLE_SMALL_PATH)

    // Load the graph from disk
    const graph = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH))
    setGraph(graph)

    // Create a minimal Cytoscape instance for testing
    cy = cytoscape({
      headless: true,
      elements: []
    })

    // Mock window.electronAPI for settings and graph
    // getGraph should return current graph state dynamically
    // createContextNode calls the real implementation to test integration
    global.window = {
      electronAPI: {
        main: {
          loadSettings: vi.fn().mockResolvedValue({
            agentCommand: 'claude --dangerously-skip-permissions --settings "$settings_file" "$initial_content"'
          }),
          getGraph: vi.fn().mockImplementation(async () => getGraph()),
          createContextNode: vi.fn().mockImplementation(async (parentNodeId: NodeIdAndFilePath) => {
            // Call the real createContextNode to create node on disk and update graph
            return await createContextNode(parentNodeId)
          })
        }
      }
    } as unknown as Window & typeof globalThis

    // Clear tracking arrays
    createdContextNodeIds = []
    parentNodeBackups = new Map()
  })

  afterEach(async () => {
    const vaultPath = getVaultPath()

    // Clean up created context node files
    if (O.isSome(vaultPath)) {
      for (const contextNodeId of createdContextNodeIds) {
        const contextFilePath = path.join(vaultPath.value, contextNodeId)
        await fs.unlink(contextFilePath).catch(() => {
          // File might not exist, that's ok
        })
      }
    }

    // Restore parent node files
    if (O.isSome(vaultPath)) {
      for (const [parentNodeId, originalContent] of parentNodeBackups.entries()) {
        const parentFilePath = path.join(vaultPath.value, parentNodeId)
        await fs.writeFile(parentFilePath, originalContent, 'utf-8').catch(() => {
          // File might not exist, that's ok
        })
      }
    }

    // Clean up
    createdContextNodeIds = []
    parentNodeBackups.clear()
    cy.destroy()
    vi.restoreAllMocks()
  })

  /**
   * Helper function to backup parent node before test
   */
  async function backupParentNode(parentNodeId: NodeIdAndFilePath): Promise<void> {
    const vaultPath = getVaultPath()
    if (O.isSome(vaultPath)) {
      const parentFilePath = path.join(vaultPath.value, parentNodeId)
      const originalContent = await fs.readFile(parentFilePath, 'utf-8')
      parentNodeBackups.set(parentNodeId, originalContent)
    }
  }

  describe('BEHAVIOR: Create context node and spawn terminal with env vars', () => {
    it('should create context node and spawn terminal with initial_content env var', async () => {
      // GIVEN: A parent node that exists in example_small graph
      const parentNodeId: NodeIdAndFilePath = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'
      await backupParentNode(parentNodeId)

      // Add parent node to cytoscape graph
      cy.add({
        group: 'nodes',
        data: { id: parentNodeId },
        position: { x: 100, y: 100 }
      })

      // WHEN: Spawn terminal with new context node
      await spawnTerminalWithNewContextNode(parentNodeId, cy)

      // Wait for terminal to be spawned (setTimeout in implementation)
      await new Promise(resolve => setTimeout(resolve, 1100))

      // THEN: A context node should be created
      const terminals = getTerminals()
      const terminalEntries = Array.from(terminals.values())
      expect(terminalEntries.length).toBeGreaterThan(0)

      // Find the terminal attached to a context node (ctx-nodes/)
      const contextTerminal = terminalEntries.find(t =>
        t.attachedToNodeId.includes('ctx-nodes/')
      )
      expect(contextTerminal).toBeDefined()

      if (contextTerminal) {
        // AND: Context node ID should be tracked
        const contextNodeId = contextTerminal.attachedToNodeId
        createdContextNodeIds.push(contextNodeId)

        // AND: Context node should exist on disk
        const vaultPath = getVaultPath()
        expect(O.isSome(vaultPath)).toBe(true)

        if (O.isSome(vaultPath)) {
          const contextFilePath = path.join(vaultPath.value, contextNodeId)
          const fileExists = await fs.access(contextFilePath)
            .then(() => true)
            .catch(() => false)
          expect(fileExists).toBe(true)

          // AND: Terminal should have initialEnvVars with initial_content
          expect(contextTerminal.initialEnvVars).toBeDefined()
          expect(contextTerminal.initialEnvVars?.initial_content).toBeDefined()

          // The initial_content should match the context node content (possibly with frontmatter differences)
          // Just verify it contains the key sections
          const initialContent = contextTerminal.initialEnvVars?.initial_content
          expect(initialContent).toContain('title: CONTEXT for')
          expect(initialContent).toContain('## CONTEXT for:')
          expect(initialContent).toContain('## Node Details')

          // AND: Terminal should have agentCommand set
          expect(contextTerminal.initialCommand).toBe(
            'claude --dangerously-skip-permissions --settings "$settings_file" "$initial_content"'
          )

          // AND: Terminal should be set to execute automatically
          expect(contextTerminal.executeCommand).toBe(true)
        }
      }
    })

    it('should attach terminal to context node (not parent node)', async () => {
      // GIVEN: A parent node
      const parentNodeId: NodeIdAndFilePath = '2_VoiceTree_Node_ID_Duplication_Bug.md'
      await backupParentNode(parentNodeId)

      // Add parent node to cytoscape
      cy.add({
        group: 'nodes',
        data: { id: parentNodeId },
        position: { x: 200, y: 200 }
      })

      // WHEN: Spawn terminal with new context node
      await spawnTerminalWithNewContextNode(parentNodeId, cy)

      // Wait for terminal to be spawned (setTimeout in implementation)
      await new Promise(resolve => setTimeout(resolve, 1100))

      // THEN: Terminal should be attached to context node, not parent
      const terminals = getTerminals()
      const terminalEntries = Array.from(terminals.values())
      const contextTerminal = terminalEntries.find(t =>
        t.attachedToNodeId.includes('ctx-nodes/') &&
        t.attachedToNodeId.includes(parentNodeId)
      )

      expect(contextTerminal).toBeDefined()
      if (contextTerminal) {
        createdContextNodeIds.push(contextTerminal.attachedToNodeId)

        // Verify it's attached to context node, not parent
        expect(contextTerminal.attachedToNodeId).toContain('ctx-nodes/')
        expect(contextTerminal.attachedToNodeId).not.toBe(parentNodeId)
      }
    })

    it('should set correct terminal count for context node', async () => {
      // GIVEN: A parent node
      const parentNodeId: NodeIdAndFilePath = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'
      await backupParentNode(parentNodeId)

      cy.add({
        group: 'nodes',
        data: { id: parentNodeId },
        position: { x: 100, y: 100 }
      })

      // WHEN: Spawn first terminal with context node
      await spawnTerminalWithNewContextNode(parentNodeId, cy)

      // Wait for terminal to be spawned (setTimeout in implementation)
      await new Promise(resolve => setTimeout(resolve, 1100))

      // THEN: First terminal for the context node should have terminalCount = 0 (0-indexed)
      const terminals = getTerminals()
      const contextTerminal = Array.from(terminals.values()).find(t =>
        t.attachedToNodeId.includes('ctx-nodes/')
      )

      expect(contextTerminal).toBeDefined()
      if (contextTerminal) {
        createdContextNodeIds.push(contextTerminal.attachedToNodeId)
        expect(contextTerminal.terminalCount).toBe(0)
      }
    })
  })

  describe('BEHAVIOR: Context node content in env var', () => {
    it('should include context graph ASCII visualization in initial_content', async () => {
      // GIVEN: A parent node with connections
      const parentNodeId: NodeIdAndFilePath = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'
      await backupParentNode(parentNodeId)

      cy.add({
        group: 'nodes',
        data: { id: parentNodeId },
        position: { x: 100, y: 100 }
      })

      // WHEN: Spawn terminal with context node
      await spawnTerminalWithNewContextNode(parentNodeId, cy)

      // Wait for terminal to be spawned (setTimeout in implementation)
      await new Promise(resolve => setTimeout(resolve, 1100))

      // THEN: initial_content should contain ASCII tree
      const terminals = getTerminals()
      const contextTerminal = Array.from(terminals.values()).find(t =>
        t.attachedToNodeId.includes('ctx-nodes/')
      )

      expect(contextTerminal).toBeDefined()
      if (contextTerminal) {
        createdContextNodeIds.push(contextTerminal.attachedToNodeId)

        const initialContent = contextTerminal.initialEnvVars?.initial_content
        expect(initialContent).toBeDefined()

        if (initialContent) {
          // Should contain frontmatter
          expect(initialContent).toContain('---')
          expect(initialContent).toContain('title: CONTEXT for')

          // Should contain ASCII visualization
          expect(initialContent).toContain('## CONTEXT for:')
          expect(initialContent).toContain('```')

          // Should contain node details
          expect(initialContent).toContain('## Node Details')
        }
      }
    })
  })
})
