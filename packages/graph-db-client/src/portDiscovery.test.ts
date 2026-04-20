import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { DaemonUnreachableError } from './errors.ts'
import { discoverPort, readPortFile } from './portDiscovery.ts'

async function makeVault(): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), 'graph-db-client-port-'))
  await mkdir(join(vault, '.voicetree'), { recursive: true })
  return vault
}

async function writePort(vault: string, value: string): Promise<void> {
  await writeFile(join(vault, '.voicetree', 'graphd.port'), value, 'utf8')
}

describe('port discovery', () => {
  const rootsToDelete: string[] = []

  afterEach(async () => {
    await Promise.all(
      rootsToDelete.splice(0).map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    )
  })

  test('readPortFile returns null when the port file is missing', async () => {
    const vault = await makeVault()
    rootsToDelete.push(vault)

    await expect(readPortFile(vault)).resolves.toBeNull()
  })

  test('readPortFile returns null when the port file is malformed', async () => {
    const vault = await makeVault()
    rootsToDelete.push(vault)
    await writePort(vault, 'not-a-port\n')

    await expect(readPortFile(vault)).resolves.toBeNull()
  })

  test('readPortFile parses a valid port file', async () => {
    const vault = await makeVault()
    rootsToDelete.push(vault)
    await writePort(vault, '43123\n')

    await expect(readPortFile(vault)).resolves.toBe(43123)
  })

  test('discoverPort resolves when the port file appears later', async () => {
    const vault = await makeVault()
    rootsToDelete.push(vault)

    setTimeout(() => {
      void writePort(vault, '51234\n')
    }, 60)

    await expect(discoverPort(vault, { timeoutMs: 1000 })).resolves.toBe(51234)
  })

  test('discoverPort times out when the port file never appears', async () => {
    const vault = await makeVault()
    rootsToDelete.push(vault)

    await expect(discoverPort(vault, { timeoutMs: 120 })).rejects.toBeInstanceOf(
      DaemonUnreachableError,
    )
  })
})
