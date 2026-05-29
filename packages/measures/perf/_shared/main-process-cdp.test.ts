import { describe, expect, it } from 'vitest'
import { selectInspectablePageTarget } from './main-process-cdp.ts'

describe('selectInspectablePageTarget', () => {
    it('selects the first inspectable renderer page target', () => {
        const selected = selectInspectablePageTarget([
            {
                type: 'browser',
                webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser',
            },
            {
                type: 'page',
                url: 'file:///app/index.html',
                webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/1',
            },
        ])

        expect(selected?.webSocketDebuggerUrl).toBe('ws://127.0.0.1:1/devtools/page/1')
    })

    it('ignores DevTools frontend and non-inspectable targets', () => {
        const selected = selectInspectablePageTarget([
            {
                type: 'page',
                url: 'devtools://devtools/bundled/inspector.html',
                webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/devtools',
            },
            {
                type: 'page',
                url: 'file:///app/index.html',
            },
            {
                type: 'page',
                url: 'file:///app/real.html',
                webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/real',
            },
        ])

        expect(selected?.url).toBe('file:///app/real.html')
    })
})
