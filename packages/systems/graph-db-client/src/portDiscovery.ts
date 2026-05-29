import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import { DaemonUnreachableError } from './errors.ts'

const PORT_FILENAME = 'graphd.port'
const LOCK_FILENAME = 'graphd.lock'

export type PortDiscoveryDeps = {
  now: () => number
  readPortFile: (vault: string) => Promise<number | null>
  lockFileExists: (vault: string) => boolean
  sleep: (ms: number) => Promise<void>
}

function portFilePath(vault: string): string {
  return join(getProjectDotVoicetreePath(vault), PORT_FILENAME)
}

function lockFilePath(vault: string): string {
  return join(getProjectDotVoicetreePath(vault), LOCK_FILENAME)
}

function lockFileExists(vault: string): boolean {
  return existsSync(lockFilePath(vault))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nowMs(): number {
  return Date.now()
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 0 && port <= 65535
}

function nextBackoffMs(backoffMs: number): number {
  return Math.min(backoffMs * 2, 800)
}

function pollDelayMs(backoffMs: number, remainingMs: number): number {
  return Math.min(backoffMs, remainingMs)
}

export async function readPortFile(vault: string): Promise<number | null> {
  try {
    const raw = await readFile(portFilePath(vault), 'utf8')
    const port = Number(raw.trim())
    if (!isValidPort(port)) {
      return null
    }
    return port
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function discoverPort(
  vault: string,
  opts: { timeoutMs?: number } = {},
  deps: PortDiscoveryDeps = {
    now: nowMs,
    readPortFile,
    lockFileExists,
    sleep,
  },
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const deadline = deps.now() + timeoutMs
  let backoffMs = 50

  const initialPort = await deps.readPortFile(vault)
  if (initialPort !== null) {
    return initialPort
  }

  if (!deps.lockFileExists(vault)) {
    throw new DaemonUnreachableError(
      `No vt-graphd port or lock file for vault ${vault}`,
    )
  }

  while (deps.now() <= deadline) {
    const remainingMs = deadline - deps.now()
    if (remainingMs <= 0) {
      break
    }

    await deps.sleep(pollDelayMs(backoffMs, remainingMs))
    backoffMs = nextBackoffMs(backoffMs)

    const port = await deps.readPortFile(vault)
    if (port !== null) {
      return port
    }
  }

  throw new DaemonUnreachableError(
    `Timed out waiting for vt-graphd port file for vault ${vault}`,
  )
}
