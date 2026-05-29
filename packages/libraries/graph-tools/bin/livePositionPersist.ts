import fs from 'node:fs'
import path from 'node:path'

import {hydrateState, type SerializedState} from '@vt/graph-state'
import {getProjectDotVoicetreePath} from '@vt/paths'

import {liveStateDump} from '../src/live/live'
import {findLoadedRootForFile} from './liveEdgePersist'

async function getLoadedRoots(vaultPath?: string): Promise<readonly string[]> {
  // BF-266a: derive loaded roots via hydrateState. Post-UFV the wire shape no longer
  // includes `roots.loaded`; hydrateState derives it from folderState rows.
  const result = await liveStateDump({pretty: false, ...(vaultPath !== undefined ? {vaultPath} : {})})
  const serialized = JSON.parse(result.json) as SerializedState
  const state = hydrateState(serialized)
  return [...state.roots.loaded]
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function writePositionRecord(filePath: string, update: (positions: Record<string, unknown>) => void): void {
  const positions = readJsonRecord(filePath)
  update(positions)
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, `${JSON.stringify(positions, null, 2)}\n`, 'utf8')
}

async function positionsPathForFile(filePath: string, vaultPath?: string): Promise<string | undefined> {
  const root = findLoadedRootForFile(await getLoadedRoots(vaultPath), filePath)
  return root === undefined
    ? undefined
    : path.join(getProjectDotVoicetreePath(root), 'positions.json')
}

export async function writePositionForFile(
  filePath: string,
  position: {readonly x: number; readonly y: number},
  vaultPath?: string,
): Promise<void> {
  const positionsPath = await positionsPathForFile(filePath, vaultPath)
  if (positionsPath === undefined) return

  writePositionRecord(positionsPath, (positions) => {
    positions[filePath] = {x: position.x, y: position.y}
  })
}

export async function removePositionForFile(filePath: string, vaultPath?: string): Promise<void> {
  const positionsPath = await positionsPathForFile(filePath, vaultPath)
  if (positionsPath === undefined) return

  writePositionRecord(positionsPath, (positions) => {
    delete positions[filePath]
  })
}
