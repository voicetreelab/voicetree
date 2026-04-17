/**
 * BF-162 · renderer-side listener for `uiAPI.applyLiveCommand`.
 *
 * Receives a `SerializedCommand` pushed from main (after main applied it to
 * the live store) and mirrors the mutation onto cytoscape + folder/selection
 * stores so the UI reflects MCP-originated commands in real time.
 *
 * Scope: Collapse / Expand / Select / Deselect (the 4 wired commands in L1).
 * Other commands are ignored here — main already returned `not-yet-wired`.
 */
import { getCyInstance } from '@/shell/edge/UI-edge/state/cytoscape-state'
import { collapseFolder, expandFolder } from '@/shell/edge/UI-edge/graph/folderCollapse'

interface SerializedCommandShape {
    readonly type: string
    readonly folder?: string
    readonly ids?: readonly string[]
    readonly additive?: boolean
}

export function applyLiveCommandToRenderer(command: unknown): void {
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
                    void expandFolder(getCyInstance(), cmd.folder)
                }
                return
            case 'Select': {
                if (!Array.isArray(cmd.ids)) return
                const cy: ReturnType<typeof getCyInstance> = getCyInstance()
                if (cmd.additive !== true) {
                    cy.$(':selected').unselect()
                }
                for (const id of cmd.ids) {
                    const el: ReturnType<typeof cy.getElementById> = cy.getElementById(id)
                    if (el.length > 0) el.select()
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
            default:
                return
        }
    } catch (error) {
        console.warn('[applyLiveCommandToRenderer] failed:', cmd.type, error)
    }
}
