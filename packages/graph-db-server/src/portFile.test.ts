import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writePortFile,
  readPortFile,
  deletePortFile,
  PORT_FILENAME,
} from './portFile.ts'

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'vt-graphd-port-test-'))
  await mkdir(join(vault, '.voicetree'), { recursive: true })
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

describe('portFile', () => {
  test('write + read roundtrip returns the same port', async () => {
    await writePortFile(vault, 49152)
    expect(await readPortFile(vault)).toBe(49152)
  })

  test('readPortFile returns null when missing', async () => {
    expect(await readPortFile(vault)).toBeNull()
  })

  test('readPortFile returns null on garbled contents', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(vault, '.voicetree', PORT_FILENAME), 'not-a-port')
    expect(await readPortFile(vault)).toBeNull()
  })

  test('deletePortFile is idempotent', async () => {
    await expect(deletePortFile(vault)).resolves.toBeUndefined()
    await writePortFile(vault, 50000)
    await expect(deletePortFile(vault)).resolves.toBeUndefined()
    expect(await readPortFile(vault)).toBeNull()
    await expect(deletePortFile(vault)).resolves.toBeUndefined()
  })

  test('overwrite replaces previous port atomically', async () => {
    await writePortFile(vault, 40000)
    await writePortFile(vault, 41000)
    expect(await readPortFile(vault)).toBe(41000)
  })

  test('concurrent writers never expose a partial/invalid file', async () => {
    const N = 20
    const ports = Array.from({ length: N }, (_, i) => 50000 + i)

    let keepReading = true
    const reads: Array<Promise<number | null>> = []
    const reader = (async () => {
      while (keepReading) {
        reads.push(readPortFile(vault))
        await new Promise((r) => setImmediate(r))
      }
    })()

    await Promise.all(ports.map((p) => writePortFile(vault, p)))
    keepReading = false
    await reader

    const results = await Promise.all(reads)
    for (const r of results) {
      expect(r === null || (Number.isInteger(r) && ports.includes(r))).toBe(
        true,
      )
    }

    const final = await readPortFile(vault)
    expect(ports.includes(final!)).toBe(true)
  })

  test('no temp files leak in .voicetree/ after writes settle', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => writePortFile(vault, 51000 + i)),
    )
    const entries = await readdir(join(vault, '.voicetree'))
    const leaked = entries.filter(
      (n) => n !== PORT_FILENAME && n.includes('graphd.port'),
    )
    expect(leaked).toEqual([])
  })

  test('written file content is exactly the port integer as UTF-8 text', async () => {
    await writePortFile(vault, 52345)
    const raw = await readFile(join(vault, '.voicetree', PORT_FILENAME), 'utf8')
    expect(raw.trim()).toBe('52345')
  })
})
