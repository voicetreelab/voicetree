import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DaemonUnreachableError } from './errors.ts'

const PORT_FILENAME = 'graphd.port'

function portFilePath(vault: string): string {
  return join(vault, '.voicetree', PORT_FILENAME)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function readPortFile(vault: string): Promise<number | null> {
  try {
    const raw = await readFile(portFilePath(vault), 'utf8')
    const port = Number(raw.trim())
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
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
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const deadline = Date.now() + timeoutMs
  let backoffMs = 50

  while (Date.now() <= deadline) {
    const port = await readPortFile(vault)
    if (port !== null) {
      return port
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      break
    }

    await sleep(Math.min(backoffMs, remainingMs))
    backoffMs = Math.min(backoffMs * 2, 800)
  }

  throw new DaemonUnreachableError(
    `Timed out waiting for vt-graphd port file for vault ${vault}`,
  )
}
