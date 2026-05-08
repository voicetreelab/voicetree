import { writeFile, rename, unlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export const PORT_FILENAME = 'graphd.port'

function portPathFor(vaultDir: string): string {
  return join(vaultDir, '.voicetree', PORT_FILENAME)
}

function tmpPathFor(vaultDir: string): string {
  const suffix = `${process.pid}.${randomBytes(4).toString('hex')}`
  return join(vaultDir, '.voicetree', `${PORT_FILENAME}.tmp.${suffix}`)
}

export async function writePortFile(
  vaultDir: string,
  port: number,
): Promise<void> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid port: ${port}`)
  }
  const final = portPathFor(vaultDir)
  const tmp = tmpPathFor(vaultDir)
  await writeFile(tmp, `${port}\n`, 'utf8')
  try {
    await rename(tmp, final)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

export async function readPortFile(vaultDir: string): Promise<number | null> {
  try {
    const raw = await readFile(portPathFor(vaultDir), 'utf8')
    const n = Number(raw.trim())
    if (!Number.isInteger(n) || n < 0 || n > 65535) return null
    return n
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function deletePortFile(vaultDir: string): Promise<void> {
  try {
    await unlink(portPathFor(vaultDir))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}
