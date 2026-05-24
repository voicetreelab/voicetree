import { describe, expect, test } from 'vitest'

import * as proxy from './daemon-ipc-proxy'

describe('daemon-ipc-proxy folder-state surface (post BF-245)', () => {
  test('exposes setFolderStateThroughDaemon as the canonical folder-state mutator', () => {
    expect(typeof (proxy as Record<string, unknown>).setFolderStateThroughDaemon).toBe('function')
  })

  test('collapse/expand wrappers exist and delegate to setFolderStateThroughDaemon (no stale client.collapse / client.expand)', async () => {
    expect(typeof (proxy as Record<string, unknown>).collapseFolderThroughDaemon).toBe('function')
    expect(typeof (proxy as Record<string, unknown>).expandFolderThroughDaemon).toBe('function')

    const collapseSrc: string = proxy.collapseFolderThroughDaemon.toString()
    const expandSrc: string = proxy.expandFolderThroughDaemon.toString()

    expect(collapseSrc).not.toMatch(/\bclient\s*\.\s*collapse\s*\(/)
    expect(expandSrc).not.toMatch(/\bclient\s*\.\s*expand\s*\(/)

    expect(collapseSrc).toContain('setFolderStateThroughDaemon')
    expect(expandSrc).toContain('setFolderStateThroughDaemon')
  })
})
