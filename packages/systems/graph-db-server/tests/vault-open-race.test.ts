import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { startDaemon, type DaemonHandle } from '@vt/graph-db-server'
import { GraphDbClient } from '../../graph-db-client/src/index.ts'

const LEGACY_VAULT_RACE_ERROR = /no vault.*open|watched directory not initialized/i

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function diagnosticText(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...Object.fromEntries(Object.entries(value)),
    })
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function hasErrorCode(value: unknown, code: string): boolean {
  if (!isRecord(value)) {
    return false
  }
  if (value.code === code) {
    return true
  }
  return Object.values(value).some((entry) => hasErrorCode(entry, code))
}

async function createVault(root: string, name: string): Promise<string> {
  const vault = path.join(root, name)
  await mkdir(vault, { recursive: true })
  await writeFile(path.join(vault, 'alpha.md'), `# ${name} alpha\n`, 'utf8')
  await writeFile(path.join(vault, 'beta.md'), `# ${name} beta\n`, 'utf8')
  return vault
}

async function collectProjectedGraphReads(
  client: GraphDbClient,
  sessionId: string,
  durationMs: number,
): Promise<unknown[]> {
  const observed: unknown[] = []
  const deadline = Date.now() + durationMs

  while (Date.now() < deadline) {
    try {
      observed.push(await client.getProjectedGraph(sessionId))
    } catch (error) {
      observed.push(error)
    }
    await delay(10)
  }

  return observed
}

describe('vault open race regression', () => {
  let root: string
  let vaultA: string
  let vaultB: string
  let handle: DaemonHandle | null

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-graphd-vault-open-race-'))
    vaultA = await createVault(root, 'vault-a')
    vaultB = await createVault(root, 'vault-b')
    handle = await startDaemon({
      vault: vaultA,
      voicetreeHomePath: path.join(root, 'app-support'),
      createStarterIfEmpty: false,
    })
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    handle = null
    await rm(root, { recursive: true, force: true })
  })

  it('does not expose transient vault-not-open errors while switching vaults', async () => {
    const client = new GraphDbClient({ baseUrl: `http://127.0.0.1:${handle!.port}` })

    const openedA = await client.openVault(vaultA)
    const reader = collectProjectedGraphReads(client, openedA.sessionId, 2000)

    await delay(50)
    await client.openVault(vaultB)

    const observed = await reader
    const legacyFailures = observed
      .map(diagnosticText)
      .filter((text) => LEGACY_VAULT_RACE_ERROR.test(text))
    const vaultNotOpenFailures = observed.filter((value) => hasErrorCode(value, 'vault_not_open'))

    expect(legacyFailures).toEqual([])
    expect(vaultNotOpenFailures).toEqual([])
  })
})
