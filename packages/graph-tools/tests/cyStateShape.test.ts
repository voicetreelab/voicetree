import {describe, expect, it} from 'vitest'

import {parseCyDump} from '../src/debug/cyStateShape'

describe('parseCyDump', () => {
    it('accepts the normalized renderer __vtDebug__.cy() dump shape', () => {
        const parsed = parseCyDump({
            nodes: [
                {
                    id: 'node-a',
                    classes: ['selected', 'file'],
                    position: {x: 10, y: 20},
                    visible: true,
                },
            ],
            edges: [
                {
                    id: 'edge-a',
                    source: 'node-a',
                    target: 'node-b',
                    classes: ['link'],
                },
            ],
            viewport: {
                zoom: 1.25,
                pan: {x: 180, y: -90},
            },
            selection: ['node-a'],
        })

        expect(parsed.nodes).toEqual([
            {
                id: 'node-a',
                classes: ['selected', 'file'],
                position: {x: 10, y: 20},
                visible: true,
            },
        ])
        expect(parsed.edges).toEqual([
            {
                id: 'edge-a',
                source: 'node-a',
                target: 'node-b',
                classes: ['link'],
            },
        ])
        expect(parsed.viewport).toEqual({
            zoom: 1.25,
            pan: {x: 180, y: -90},
        })
        expect(parsed.selection).toEqual(['node-a'])
    })
})
