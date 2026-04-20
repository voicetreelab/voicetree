import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import cytoscape from 'cytoscape'
import type {Core} from 'cytoscape'

vi.mock('@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD', () => ({
    createAnchoredFloatingEditor: vi.fn(async (_cy: Core, nodeId: string) => {
        const editor: HTMLDivElement = document.createElement('div')
        editor.className = 'floating-editor'
        editor.id = `window-${nodeId}-editor`
        document.body.appendChild(editor)
    }),
}))

import {applyLiveCommandToRenderer} from '@/shell/edge/UI-edge/graph/applyLiveCommandToRenderer'

describe('applyLiveCommandToRenderer editor mount', () => {
    let cy: Core

    beforeEach(() => {
        document.body.innerHTML = ''
        cy = cytoscape({
            headless: true,
            elements: [
                {
                    group: 'nodes' as const,
                    data: {id: 'parent.md'},
                },
                {
                    group: 'nodes' as const,
                    data: {id: 'sibling.md'},
                },
            ],
        })

        ;(window as unknown as {cytoscapeInstance?: Core}).cytoscapeInstance = cy
    })

    afterEach(() => {
        cy.destroy()
        delete (window as unknown as {cytoscapeInstance?: Core}).cytoscapeInstance
        vi.clearAllMocks()
        document.body.innerHTML = ''
    })

    it('mounts a floating editor when a single node is selected via live command', async () => {
        await applyLiveCommandToRenderer({type: 'Select', ids: ['parent.md']})

        expect(cy.getElementById('parent.md').selected()).toBe(true)
        expect(document.querySelector('.floating-editor')).not.toBeNull()
        expect(document.getElementById('window-parent.md-editor')).not.toBeNull()
    })

    it('does not mount a new floating editor for additive multi-select', async () => {
        await applyLiveCommandToRenderer({type: 'Select', ids: ['parent.md']})
        document.body.innerHTML = ''

        await applyLiveCommandToRenderer({
            type: 'Select',
            ids: ['sibling.md'],
            additive: true,
        })

        expect(cy.$(':selected').map(node => node.id()).sort()).toEqual(['parent.md', 'sibling.md'])
        expect(document.querySelector('.floating-editor')).toBeNull()
    })
})
