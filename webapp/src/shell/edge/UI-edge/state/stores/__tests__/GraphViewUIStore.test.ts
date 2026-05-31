// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import {
    disposeGraphViewOverlays,
    initGraphViewOverlays,
    setEmptyStateVisible,
    setLoadingState,
} from '@/shell/edge/UI-edge/state/stores/GraphViewUIStore'

function setupOverlays(): {
    readonly empty: HTMLDivElement
    readonly loading: HTMLDivElement
    readonly message: HTMLParagraphElement
} {
    const loading: HTMLDivElement = document.createElement('div')
    const message: HTMLParagraphElement = document.createElement('p')
    const empty: HTMLDivElement = document.createElement('div')
    loading.appendChild(message)
    document.body.append(loading, empty)
    initGraphViewOverlays(loading, message, empty)
    return { empty, loading, message }
}

describe('GraphViewUIStore', () => {
    afterEach(() => {
        disposeGraphViewOverlays()
        document.body.replaceChildren()
    })

    it('removes hidden loading text from document body readiness checks', () => {
        const { loading, message } = setupOverlays()

        setLoadingState(true, 'Loading Voicetree...')

        expect(loading.style.display).toBe('flex')
        expect(message.textContent).toBe('Loading Voicetree...')
        expect(document.body.textContent).toContain('Loading Voicetree...')

        setLoadingState(false)

        expect(loading.style.display).toBe('none')
        expect(message.textContent).toBe('')
        expect(document.body.textContent).not.toContain('Loading Voicetree...')
    })

    it('toggles empty-state visibility', () => {
        const { empty } = setupOverlays()

        setEmptyStateVisible(true)
        expect(empty.style.display).toBe('flex')

        setEmptyStateVisible(false)
        expect(empty.style.display).toBe('none')
    })

    it('dispose removes every registered overlay from the DOM so a remount does not orphan them', () => {
        const loading: HTMLDivElement = document.createElement('div')
        const message: HTMLParagraphElement = document.createElement('p')
        const empty: HTMLDivElement = document.createElement('div')
        const error: HTMLDivElement = document.createElement('div')
        const stats: HTMLDivElement = document.createElement('div')
        loading.appendChild(message)
        document.body.append(loading, empty, error, stats)
        initGraphViewOverlays(loading, message, empty, error, stats)

        expect(loading.isConnected).toBe(true)
        expect(error.isConnected).toBe(true)
        expect(stats.isConnected).toBe(true)

        disposeGraphViewOverlays()

        expect(loading.isConnected).toBe(false)
        expect(empty.isConnected).toBe(false)
        expect(error.isConnected).toBe(false)
        expect(stats.isConnected).toBe(false)

        // After dispose the store no longer drives a detached element.
        setLoadingState(true, 'Loading Voicetree...')
        expect(loading.style.display).toBe('')
    })
})
