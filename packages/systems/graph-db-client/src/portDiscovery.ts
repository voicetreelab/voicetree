import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import { DaemonUnreachableError } from './errors.ts'

const PORT_FILENAME = 'graphd.port'
const LOCK_FILENAME = 'graphd.lock'

export type PortDiscoveryDeps = {
  now: () => number
  readPortFile: (project: string) => Promise<number | null>
  lockFileExists: (project: string) => boolean
  sleep: (ms: number) => Promise<void>
}

function portFilePath(project: string): string {
  return join(getProjectDotVoicetreePath(project), PORT_FILENAME)
}

function lockFilePath(project: string): string {
  return join(getProjectDotVoicetreePath(project), LOCK_FILENAME)
}

function lockFileExists(project: string): boolean {
  return existsSync(lockFilePath(project))
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

export async function readPortFile(project: string): Promise<number | null> {
  try {
    const raw = await readFile(portFilePath(project), 'utf8')
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
  project: string,
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

  const initialPort = await deps.readPortFile(project)
  if (initialPort !== null) {
    return initialPort
  }

  if (!deps.lockFileExists(project)) {
    throw new DaemonUnreachableError(
      `No vt-graphd port or lock file for project ${project}`,
    )
  }

  while (deps.now() <= deadline) {
    const remainingMs = deadline - deps.now()
    if (remainingMs <= 0) {
      break
    }

    await deps.sleep(pollDelayMs(backoffMs, remainingMs))
    backoffMs = nextBackoffMs(backoffMs)

    const port = await deps.readPortFile(project)
    if (port !== null) {
      return port
    }
  }

  throw new DaemonUnreachableError(
    `Timed out waiting for vt-graphd port file for project ${project}`,
  )
}
