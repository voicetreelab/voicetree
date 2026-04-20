import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import cytoscape, { type Core } from 'cytoscape'

import { createLayoutStore, type LayoutStore } from '@vt/graph-state'

import { mountLayoutProjection } from './layoutProjection'

describe('layoutProjection', () => {
    let cy: Core
    let container: HTMLElement
    let store: LayoutStore
    let unmount: () => void = () => {}

    beforeEach(() => {
        container = document.createElement('div')
        container.style.width = '800px'
        container.style.height = '600px'
        document.body.appendChild(container)

        cy = cytoscape({
            container,
            elements: [],
            userZoomingEnabled: false,
            minZoom: 0.1,
            maxZoom: 10,
            layout: { name: 'preset' },
        })

        store = createLayoutStore({ scheduler: () => {} })
        unmount = mountLayoutProjection(cy, store).unmount
    })

    afterEach(() => {
        unmount()
        cy.destroy()
        container.remove()
        store.dispose()
    })

    it('mirrors direct cy viewport writes back into layoutStore', () => {
        cy.zoom(2.5)
        cy.pan({ x: 120, y: -40 })

        store.flush()

        expect(store.getLayout().zoom).toBe(2.5)
        expect(store.getLayout().pan).toEqual({ x: 120, y: -40 })
    })
})
