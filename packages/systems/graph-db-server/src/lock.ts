import { writeFile, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export const LOCK_FILENAME = 'graphd.lock'

export type LockHandle = {
  release(): Promise<void>
}

export type AlreadyRunning = {
  kind: 'already-running'
  pid: number
}

export type AcquireResult = LockHandle | AlreadyRunning

function lockPathFor(vaultDir: string): string {
  return join(vaultDir, '.voicetree', LOCK_FILENAME)
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    return false
  }
}

async function tryCreateLock(path: string): Promise<boolean> {
  try {
    await writeFile(path, String(process.pid), { flag: 'wx' })
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
}

async function readRecordedPid(path: string): Promise<number | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const n = Number(raw.trim())
    return Number.isInteger(n) && n > 0 ? n : null
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function acquireLock(vaultDir: string): Promise<AcquireResult> {
  const path = lockPathFor(vaultDir)

  if (await tryCreateLock(path)) return makeHandle(path)

  const pid = await readRecordedPid(path)

  if (pid !== null && isProcessAlive(pid)) {
    return { kind: 'already-running', pid }
  }

  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  if (await tryCreateLock(path)) return makeHandle(path)

  const racePid = await readRecordedPid(path)
  return { kind: 'already-running', pid: racePid ?? -1 }
}

function makeHandle(path: string): LockHandle {
  let released = false
  return {
    async release() {
      if (released) return
      released = true
      try {
        await unlink(path)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    },
  }
}
