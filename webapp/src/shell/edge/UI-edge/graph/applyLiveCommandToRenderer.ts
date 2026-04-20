/**
 * BF-162 · renderer-side listener for `uiAPI.applyLiveCommand`.
 *
 * Receives a `SerializedCommand` pushed from main (after main applied it to
 * the live store) and mirrors the mutation onto cytoscape + folder/selection
 * stores so the UI reflects MCP-originated commands in real time.
 *
 * Scope: renderer-owned selection/collapse commands plus viewport layout
 * commands that must be mirrored into the layoutStore so layoutProjection can
 * drive cy synchronously before the harness snapshots the step.
 */
import { getCyInstance } from '@/shell/edge/UI-edge/state/cytoscape-state'
import { collapseFolder, expandFolder } from '@/shell/edge/UI-edge/graph/folderCollapse'
import { applyNodeSelectionSideEffects } from '@/shell/edge/UI-edge/graph/applyNodeSelectionSideEffects'
import {
    dispatchRequestFit,
    dispatchSetPan,
    dispatchSetZoom,
    flushLayout,
} from '@vt/graph-state/state/layoutStore'
import type { Position } from '@vt/graph-model/pure/graph'

interface SerializedCommandShape {
    readonly type: string
    readonly folder?: string
    readonly ids?: readonly string[]
    readonly additive?: boolean
    readonly zoom?: number
    readonly pan?: Position
    readonly paddingPx?: number
}

export async function applyLiveCommandToRenderer(command: unknown): Promise<void> {
    const cmd: SerializedCommandShape = command as SerializedCommandShape
    try {
        switch (cmd.type) {
            case 'Collapse':
                if (typeof cmd.folder === 'string') {
                    collapseFolder(getCyInstance(), cmd.folder)
                }
                return
            case 'Expand':
                if (typeof cmd.folder === 'string') {
                    await expandFolder(getCyInstance(), cmd.folder)
                }
                return
            case 'Select': {
                if (!Array.isArray(cmd.ids)) return
                const cy: ReturnType<typeof getCyInstance> = getCyInstance()
                const selectedIds: string[] = []
                if (cmd.additive !== true) {
                    cy.$(':selected').unselect()
                }
                for (const id of cmd.ids) {
                    const el: ReturnType<typeof cy.getElementById> = cy.getElementById(id)
                    if (el.length > 0) {
                        el.select()
                        selectedIds.push(id)
                    }
                }
                if (cmd.additive !== true && selectedIds.length === 1) {
                    await applyNodeSelectionSideEffects({
                        cy,
                        nodeId: selectedIds[0],
                    })
                }
                return
            }
            case 'Deselect': {
                if (!Array.isArray(cmd.ids)) return
                const cy: ReturnType<typeof getCyInstance> = getCyInstance()
                for (const id of cmd.ids) {
                    const el: ReturnType<typeof cy.getElementById> = cy.getElementById(id)
                    if (el.length > 0) el.unselect()
                }
                return
            }
            case 'SetZoom':
                if (typeof cmd.zoom !== 'number') return
                dispatchSetZoom(cmd.zoom)
                flushLayout()
                return
            case 'SetPan':
                if (!cmd.pan) return
                dispatchSetPan({ x: cmd.pan.x, y: cmd.pan.y })
                flushLayout()
                return
            case 'RequestFit':
                dispatchRequestFit(cmd.paddingPx)
                flushLayout()
                return
            default:
                return
        }
    } catch (error) {
        console.warn('[applyLiveCommandToRenderer] failed:', cmd.type, error)
    }
}
