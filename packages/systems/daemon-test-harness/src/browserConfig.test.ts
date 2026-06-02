// Black-box test for buildBrowserConfig: pure mapping of a ServeReady + token +
// project into the 3-field browser daemon config. Call the function, assert the
// exact output — no mocks.

import {describe, expect, it} from 'vitest'
import {buildBrowserConfig, type BrowserDaemonConfig} from './browserConfig.ts'
import type {ServeReady} from './serveHarness.ts'

function makeReady(overrides: Partial<ServeReady> = {}): ServeReady {
    return {
        graphdVerb: 'launched',
        graphdPort: 51001,
        graphdPid: 1234,
        vtdVerb: 'launched',
        vtdUrl: 'http://127.0.0.1:52002',
        vtdPid: 5678,
        ...overrides,
    }
}

describe('buildBrowserConfig', () => {
    it('maps vtdUrl/token/project into the exact 3-field config (no graphd URL)', () => {
        const cfg: BrowserDaemonConfig = buildBrowserConfig(
            makeReady({vtdUrl: 'http://127.0.0.1:52002'}),
            'deadbeefcafef00d',
            '/tmp/vt-project',
        )
        expect(cfg).toEqual({
            vtdUrl: 'http://127.0.0.1:52002',
            vtdToken: 'deadbeefcafef00d',
            projectPath: '/tmp/vt-project',
        })
    })

    it('takes vtdUrl verbatim from the ready line and never leaks graphd', () => {
        const cfg: BrowserDaemonConfig = buildBrowserConfig(
            makeReady({vtdUrl: 'http://127.0.0.1:60000', graphdPort: 49999}),
            'tok',
            '/p',
        )
        expect(cfg.vtdUrl).toBe('http://127.0.0.1:60000')
        expect(Object.keys(cfg).sort()).toEqual(['projectPath', 'vtdToken', 'vtdUrl'])
        expect(JSON.stringify(cfg)).not.toContain('49999')
    })
})
