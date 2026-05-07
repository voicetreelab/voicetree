import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, stat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLock, LOCK_FILENAME } from './lock.ts'

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'vt-graphd-lock-test-'))
  await mkdir(join(vault, '.voicetree'), { recursive: true })
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

describe('acquireLock', () => {
  test('returns releasable lock on fresh vault', async () => {
    const result = await acquireLock(vault)
    expect('release' in result).toBe(true)
    const lockPath = join(vault, '.voicetree', LOCK_FILENAME)
    const contents = await readFile(lockPath, 'utf8')
    expect(Number(contents.trim())).toBe(process.pid)
    if ('release' in result) await result.release()
  })

  test('second acquireLock while first held returns already-running with pid', async () => {
    const first = await acquireLock(vault)
    expect('release' in first).toBe(true)
    const second = await acquireLock(vault)
    expect('release' in second).toBe(false)
    if (!('release' in second)) {
      expect(second.kind).toBe('already-running')
      expect(second.pid).toBe(process.pid)
    }
    if ('release' in first) await first.release()
  })

  test('stale recovery: reclaims lock when recorded PID is dead', async () => {
    const lockPath = join(vault, '.voicetree', LOCK_FILENAME)
    await writeFile(lockPath, '999999', { flag: 'wx' })
    const result = await acquireLock(vault)
    expect('release' in result).toBe(true)
    const contents = await readFile(lockPath, 'utf8')
    expect(Number(contents.trim())).toBe(process.pid)
    if ('release' in result) await result.release()
  })

  test('stale recovery: empty/garbled lock file is reclaimed', async () => {
    const lockPath = join(vault, '.voicetree', LOCK_FILENAME)
    await writeFile(lockPath, 'not-a-pid', { flag: 'wx' })
    const result = await acquireLock(vault)
    expect('release' in result).toBe(true)
    if ('release' in result) await result.release()
  })

  test('release() deletes the lock file', async () => {
    const result = await acquireLock(vault)
    expect('release' in result).toBe(true)
    if (!('release' in result)) return
    const lockPath = join(vault, '.voicetree', LOCK_FILENAME)
    await stat(lockPath)
    await result.release()
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('release() is idempotent (no throw on double release)', async () => {
    const result = await acquireLock(vault)
    if (!('release' in result)) throw new Error('expected lock')
    await result.release()
    await expect(result.release()).resolves.toBeUndefined()
  })

  test('after release, lock can be reacquired', async () => {
    const first = await acquireLock(vault)
    if (!('release' in first)) throw new Error('expected lock')
    await first.release()
    const second = await acquireLock(vault)
    expect('release' in second).toBe(true)
    if ('release' in second) await second.release()
  })
})
