// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import type { GraphDelta, GraphNode } from '@vt/graph-model/graph'
import { syncVaultStateFromMain } from '@/shell/edge/UI-edge/state/stores/VaultPathStore'
import { resetTestProjectionState, setTestCollapseSet } from '@/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta'
import { O, upsert, applyDeltaToUI } from './applyGraphDeltaToUI.test-utils'

vi.mock('@/shell/edge/UI-edge/graph/popups/userEngagementPrompts', () => ({
    checkEngagementPrompts: vi.fn()
}))

describe('applyGraphDeltaToUI - Integration', () => {
    let cy: Core

    beforeEach(() => {
        resetTestProjectionState()
        cy = cytoscape({ headless: true, elements: [] })
    })

    afterEach(() => {
        cy.destroy()
        setTestCollapseSet(new Set())
        syncVaultStateFromMain({ readPaths: [], writeFolderPath: null, starredFolders: [] })
    })

    describe('Color validation', () => {
        it('should apply valid CSS colors to nodes', () => {
            expect(cy.nodes()).toHaveLength(0)

            const validColors: string[] = ['#ff0000', 'rgb(0, 255, 0)', 'blue', 'cyan', 'hsl(120, 100%, 50%)']

            const nodes: GraphNode[] = validColors.map((color, i) => ({
                absoluteFilePathIsID: `node-${i}`,
                contentWithoutYamlOrLinks: `# Node ${i}`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.some(color),
                    position: O.some({ x: i * 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }))

            const delta: GraphDelta = nodes.map(node => ({
                type: 'UpsertNode' as const,
                nodeToUpsert: node,
                previousNode: O.none
            }))

            applyDeltaToUI(cy, delta)

            validColors.forEach((color, i) => {
                const node: cytoscape.CollectionReturnValue = cy.getElementById(`node-${i}`)
                expect(node.data('color')).toBe(color)
            })
        })

        it.skipIf(typeof CSS === 'undefined' || typeof CSS.supports !== 'function')('should filter out invalid CSS colors', () => {
            expect(cy.nodes()).toHaveLength(0)

            const invalidColors: string[] = ['cyancyan', 'notacolor', '###', 'rgb(999,999,999)', '']

            const nodes: GraphNode[] = invalidColors.map((color, i) => ({
                absoluteFilePathIsID: `invalid-${i}`,
                contentWithoutYamlOrLinks: `# Invalid ${i}`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.some(color),
                    position: O.some({ x: i * 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }))

            const delta: GraphDelta = nodes.map(node => ({
                type: 'UpsertNode' as const,
                nodeToUpsert: node,
                previousNode: O.none
            }))

            applyDeltaToUI(cy, delta)

            invalidColors.forEach((_, i) => {
                const node: cytoscape.CollectionReturnValue = cy.getElementById(`invalid-${i}`)
                expect(node.data('color')).toBeUndefined()
            })
        })

        it.skipIf(typeof CSS === 'undefined' || typeof CSS.supports !== 'function')('should filter out invalid colors when updating existing nodes', () => {
            const originalNode: GraphNode = {
                absoluteFilePathIsID: 'color-update',
                contentWithoutYamlOrLinks: '# Original',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.some('#ff0000'),
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(originalNode)])
            expect(cy.getElementById('color-update').data('color')).toBe('#ff0000')

            const updatedNode: GraphNode = {
                absoluteFilePathIsID: 'color-update',
                contentWithoutYamlOrLinks: '# Updated',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.some('cyancyan'),
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(updatedNode)])

            expect(cy.getElementById('color-update').data('color')).toBeUndefined()
        })
    })

    describe('Scientific notation position parsing', () => {
        it('should correctly position node with scientific notation coordinates from real example file', () => {
            expect(cy.nodes()).toHaveLength(0)

            // Content modeled after: example_folder_fixtures/example_real_large/2025-09-30/14_1_Victor_Append_Agent_Extraction_Analysis_Complete.md
            const nodeWithScientificNotation: GraphNode = {
                absoluteFilePathIsID: '14_1_Victor_Append_Agent_Extraction_Analysis_Complete.md',
                contentWithoutYamlOrLinks: '# Victor Append Agent Extraction Analysis Complete',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.some('orange'),
                    position: O.some({ x: -9.184850993605149e-14, y: -500 }),
                    additionalYAMLProps: { agent_name: 'Victor', node_id: '141' },
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(nodeWithScientificNotation)])

            const node: cytoscape.CollectionReturnValue = cy.getElementById('14_1_Victor_Append_Agent_Extraction_Analysis_Complete.md')
            expect(node.length).toBe(1)

            const pos: cytoscape.Position = node.position()
            expect(pos.x).toBeCloseTo(0, 10) // -9.18e-14 is effectively 0
            expect(pos.y).toBe(-500)

            expect(node.data('color')).toBe('orange')
        })

        it('should correctly position node with small positive scientific notation', () => {
            // Content modeled after: example_folder_fixtures/example_small/5_Immediate_Test_Observation_No_Output.md
            const nodeWithSmallScientificNotation: GraphNode = {
                absoluteFilePathIsID: '5_Immediate_Test_Observation_No_Output.md',
                contentWithoutYamlOrLinks: '# Speaker observes no output',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 3.061616997868383e-14, y: 500 }),
                    additionalYAMLProps: { node_id: '5' },
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(nodeWithSmallScientificNotation)])

            const node: cytoscape.CollectionReturnValue = cy.getElementById('5_Immediate_Test_Observation_No_Output.md')
            const pos: cytoscape.Position = node.position()
            expect(pos.x).toBeCloseTo(0, 10) // 3.06e-14 is effectively 0
            expect(pos.y).toBe(500)
        })

        it('should handle very large scientific notation values', () => {
            const nodeWithLargeNotation: GraphNode = {
                absoluteFilePathIsID: 'large-notation.md',
                contentWithoutYamlOrLinks: '# Large Notation',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 1.5e6, y: -2.5e5 }), // 1,500,000 and -250,000
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(nodeWithLargeNotation)])

            const node: cytoscape.CollectionReturnValue = cy.getElementById('large-notation.md')
            const pos: cytoscape.Position = node.position()
            expect(pos.x).toBe(1500000)
            expect(pos.y).toBe(-250000)
        })
    })
})
