import { describe, expect, test } from 'vitest'

import { resolveDaemonRuntimeCommand, resolveDaemonRuntimeEnv } from './autoLaunch.ts'

describe('resolveDaemonRuntimeCommand', () => {
    test('uses the current Node executable outside Electron', () => {
        expect(
            resolveDaemonRuntimeCommand({
                env: {},
                execPath: '/usr/local/bin/node',
                versions: { node: '24.0.0' },
            }),
        ).toBe('/usr/local/bin/node')
    })

    test("inside Electron defaults to Electron's binary so native module ABI matches", () => {
        // Previously this returned npm_node_execpath, which caused the
        // better-sqlite3 NODE_MODULE_VERSION mismatch when the system Node
        // and Electron's bundled Node disagreed on ABI.
        expect(
            resolveDaemonRuntimeCommand({
                env: { npm_node_execpath: '/opt/homebrew/bin/node' },
                execPath: '/Applications/Electron.app/Contents/MacOS/Electron',
                versions: { node: '24.0.0', electron: '38.1.2' },
            }),
        ).toBe('/Applications/Electron.app/Contents/MacOS/Electron')
    })

    test('allows an explicit daemon Node binary override from Electron', () => {
        expect(
            resolveDaemonRuntimeCommand({
                env: {
                    npm_node_execpath: '/opt/homebrew/bin/node',
                    VT_GRAPHD_NODE_BIN: '/custom/node',
                },
                execPath: '/Applications/Electron.app/Contents/MacOS/Electron',
                versions: { node: '24.0.0', electron: '38.1.2' },
            }),
        ).toBe('/custom/node')
    })
})

describe('resolveDaemonRuntimeEnv', () => {
    test('outside Electron, returns empty env', () => {
        expect(
            resolveDaemonRuntimeEnv({
                env: {},
                execPath: '/usr/local/bin/node',
                versions: { node: '24.0.0' },
            }),
        ).toEqual({})
    })

    test('inside Electron, sets ELECTRON_RUN_AS_NODE so Electron binary acts as Node', () => {
        expect(
            resolveDaemonRuntimeEnv({
                env: {},
                execPath: '/Applications/Electron.app/Contents/MacOS/Electron',
                versions: { node: '24.0.0', electron: '38.1.2' },
            }),
        ).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    })

    test('inside Electron with VT_GRAPHD_NODE_BIN override, env is left empty (override is real Node)', () => {
        expect(
            resolveDaemonRuntimeEnv({
                env: { VT_GRAPHD_NODE_BIN: '/custom/node' },
                execPath: '/Applications/Electron.app/Contents/MacOS/Electron',
                versions: { node: '24.0.0', electron: '38.1.2' },
            }),
        ).toEqual({})
    })
})
