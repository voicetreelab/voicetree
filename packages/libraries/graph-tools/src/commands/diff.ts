import fs from 'fs/promises'
import path from 'path'
import { registerCommand } from './index'
import { diffCaptures, type Snapshot } from '../debug/captureDiff'
import { err, ok } from '../debug/Response'
import type { Response } from '../debug/Response'

const CAPTURES_DIR = '/tmp/vt-debug/captures'

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate)
    return true
  } catch {
    return false
  }
}

async function resolveSnapshotPath(input: string): Promise<string> {
  const directPath = path.resolve(input)
  if (await fileExists(directPath)) return directPath

  const taggedPath = path.join(
    CAPTURES_DIR,
    input.endsWith('.json') ? input : `${input}.json`,
  )
  if (await fileExists(taggedPath)) return taggedPath

  throw new Error(`snapshot not found: ${input}`)
}

async function readSnapshot(input: string): Promise<Snapshot> {
  const snapshotPath = await resolveSnapshotPath(input)
  const raw = await fs.readFile(snapshotPath, 'utf8')
  return JSON.parse(raw) as Snapshot
}

async function diffHandler(argv: string[]): Promise<Response<unknown>> {
  if (argv.length < 2) {
    return err('diff', 'usage: diff <snapshot-a> <snapshot-b>')
  }

  try {
    const [a, b] = await Promise.all([readSnapshot(argv[0]), readSnapshot(argv[1])])
    return ok('diff', diffCaptures(a, b))
  } catch (e) {
    return err('diff', String(e))
  }
}

registerCommand('diff', diffHandler)
