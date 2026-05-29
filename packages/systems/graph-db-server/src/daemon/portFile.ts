import { writeFile, rename, unlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {getProjectDotVoicetreePath} from '@vt/paths'

export const PORT_FILENAME = 'graphd.port'

type WritePortFileOptions = {
  readonly tempSuffix?: string
}

function portPathFor(projectDir: string): string {
  return join(getProjectDotVoicetreePath(projectDir), PORT_FILENAME)
}

function createDefaultTempSuffix(): string {
  return `${process.pid}.${randomBytes(4).toString('hex')}`
}

function tmpPathFor(projectDir: string, suffix: string): string {
  return join(getProjectDotVoicetreePath(projectDir), `${PORT_FILENAME}.tmp.${suffix}`)
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 0 && port <= 65535
}

function serializePort(port: number): string {
  return `${port}\n`
}

export async function writePortFile(
  projectDir: string,
  port: number,
  options: WritePortFileOptions = {},
): Promise<void> {
  if (!isValidPort(port)) {
    throw new Error(`invalid port: ${port}`)
  }
  const final = portPathFor(projectDir)
  const tmp = tmpPathFor(projectDir, options.tempSuffix ?? createDefaultTempSuffix())
  await writeFile(tmp, serializePort(port), 'utf8')
  try {
    await rename(tmp, final)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

export async function readPortFile(projectDir: string): Promise<number | null> {
  try {
    const raw = await readFile(portPathFor(projectDir), 'utf8')
    const n = Number(raw.trim())
    if (!Number.isInteger(n) || n < 0 || n > 65535) return null
    return n
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function deletePortFile(projectDir: string): Promise<void> {
  try {
    await unlink(portPathFor(projectDir))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}
