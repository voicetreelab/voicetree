import { describe, expect, test } from 'vitest'

import { resolveDaemonRuntimeCommand } from './autoLaunch.ts'

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

  test('uses real Node from npm when called by an Electron source run', () => {
    expect(
      resolveDaemonRuntimeCommand({
        env: { npm_node_execpath: '/opt/homebrew/bin/node' },
        execPath: '/Applications/Electron.app/Contents/MacOS/Electron',
        versions: { node: '24.0.0', electron: '38.1.2' },
      }),
    ).toBe('/opt/homebrew/bin/node')
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
