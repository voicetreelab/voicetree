import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DaemonUnreachableError } from './errors.ts'

const PORT_FILENAME = 'graphd.port'

export type PortDiscoveryDeps = {
  now: () => number
  readPortFile: (vault: string) => Promise<number | null>
  sleep: (ms: number) => Promise<void>
}

function portFilePath(vault: string): string {
  return join(vault, '.voicetree', PORT_FILENAME)
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
    sleep,
  },
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const deadline = deps.now() + timeoutMs
  let backoffMs = 50

  while (deps.now() <= deadline) {
    const port = await deps.readPortFile(vault)
    if (port !== null) {
      return port
    }

    const remainingMs = deadline - deps.now()
    if (remainingMs <= 0) {
      break
    }

    await deps.sleep(pollDelayMs(backoffMs, remainingMs))
    backoffMs = nextBackoffMs(backoffMs)
  }

  throw new DaemonUnreachableError(
    `Timed out waiting for vt-graphd port file for vault ${vault}`,
  )
}
