import { afterEach, expect, test } from 'vitest'
import { performance } from 'node:perf_hooks'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import normalizePath from 'normalize-path'

import {
  buildStateFromProject,
  clearRootIOForTests,
  configureRootIO,
  project,
} from '@vt/graph-state'
import type { ProjectedGraph, State } from '@vt/graph-state/contract'

import { loadGraphFromDisk } from './loadGraphFromDisk'
import { getDirectoryTree } from './folderScanner'
import { MAX_MARKDOWN_FILES_PER_PROJECT_PATH } from './fileLimitEnforce'

const TOP_FOLDER_COUNT = 5
const SUBFOLDER_COUNT = 5
const PROFILE_FILE_COUNTS = [600, MAX_MARKDOWN_FILES_PER_PROJECT_PATH] as const
const CROSS_FOLDER_LINK_STRIDE = 5
// Full pre-push runs execute this profile under suite-wide CPU/IO contention; isolated runs remain well under 1s.
const LOCAL_LOAD_AND_PROJECT_BUDGET_MS = 6000

interface ProfileResult {
  readonly fileCount: number
  readonly elapsedMs: number
  readonly heapUsedMiB: number
  readonly projectedNodeCount: number
  readonly projectedEdgeCount: number
}

let tempRoot: string | null = null

function noteBasename(index: number): string {
  return `note-${index.toString().padStart(4, '0')}`
}

function folderIdForPath(folderPath: string): string {
  return `${normalizePath(folderPath)}/`
}

function createNoteContent(index: number, fileCount: number, filesPerTopFolder: number): string {
  if (index % CROSS_FOLDER_LINK_STRIDE !== 0) {
    return `# ${noteBasename(index)}\n\nScale fixture node ${index}.\n`
  }

  const topIndex = Math.floor(index / filesPerTopFolder)
  const localOffset = index % filesPerTopFolder
  const targetTopIndex = (topIndex + 1) % TOP_FOLDER_COUNT
  const targetIndex = Math.min((targetTopIndex * filesPerTopFolder) + localOffset, fileCount - 1)

  return `# ${noteBasename(index)}\n\nScale fixture node ${index}. Links to [[${noteBasename(targetIndex)}]].\n`
}

async function seedNestedProject(root: string, fileCount: number): Promise<void> {
  const filesPerSubfolder = fileCount / (TOP_FOLDER_COUNT * SUBFOLDER_COUNT)
  expect(Number.isInteger(filesPerSubfolder)).toBe(true)

  const writes: Promise<void>[] = []
  const filesPerTopFolder = SUBFOLDER_COUNT * filesPerSubfolder
  for (let topIndex = 0; topIndex < TOP_FOLDER_COUNT; topIndex += 1) {
    for (let subIndex = 0; subIndex < SUBFOLDER_COUNT; subIndex += 1) {
      const subfolderPath = path.join(root, `folder-${topIndex}`, `sub-${subIndex}`)
      await fs.mkdir(subfolderPath, { recursive: true })

      for (let leafIndex = 0; leafIndex < filesPerSubfolder; leafIndex += 1) {
        const index = (topIndex * filesPerTopFolder) + (subIndex * filesPerSubfolder) + leafIndex
        writes.push(fs.writeFile(
          path.join(subfolderPath, `${noteBasename(index)}.md`),
          createNoteContent(index, fileCount, filesPerTopFolder),
        ))
      }
    }
  }

  await Promise.all(writes)
}

async function profileProject(projectRoot: string): Promise<ProfileResult> {
  const startedAt = performance.now()
  const state: State = await buildStateFromProject(projectRoot)
  const collapsedFolderId = folderIdForPath(path.join(projectRoot, 'folder-0'))
  const projected: ProjectedGraph = project({
    ...state,
    collapseSet: new Set([collapsedFolderId]),
  })
  const elapsedMs = performance.now() - startedAt
  const heapUsedMiB = process.memoryUsage().heapUsed / 1024 / 1024

  expect(Object.keys(state.graph.nodes)).toHaveLength(
    Number(path.basename(projectRoot).replace('project-', '')),
  )
  expect(projected.nodes).toContainEqual(expect.objectContaining({
    id: collapsedFolderId,
    kind: 'folder-collapsed',
  }))
  expect(projected.edges.length).toBeGreaterThan(0)

  return {
    fileCount: Object.keys(state.graph.nodes).length,
    elapsedMs,
    heapUsedMiB,
    projectedNodeCount: projected.nodes.length,
    projectedEdgeCount: projected.edges.length,
  }
}

afterEach(async () => {
  clearRootIOForTests()
  if (tempRoot !== null) {
    await fs.rm(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

test('loadGraphFromDisk plus project handles nested projects through the configured file cap within the local budget', async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bf112-load-project-scale-'))
  configureRootIO({ loadGraphFromDisk, getDirectoryTree })

  const results: ProfileResult[] = []
  for (const fileCount of PROFILE_FILE_COUNTS) {
    const projectRoot = path.join(tempRoot, `project-${fileCount}`)
    await seedNestedProject(projectRoot, fileCount)
    results.push(await profileProject(projectRoot))
  }

  const capResult = results.find((result) => result.fileCount === MAX_MARKDOWN_FILES_PER_PROJECT_PATH)
  console.info([
    'BF-112 load+project profile:',
    ...results.map((result) =>
      `${result.fileCount} files: ${result.elapsedMs.toFixed(2)}ms, ${result.projectedNodeCount} projected nodes, ${result.projectedEdgeCount} projected edges, ${result.heapUsedMiB.toFixed(1)} MiB heap`,
    ),
  ].join('\n'))

  expect(capResult).toBeDefined()
  if (process.env.CI !== 'true') {
    expect(capResult!.elapsedMs).toBeLessThanOrEqual(LOCAL_LOAD_AND_PROJECT_BUDGET_MS)
  }
  expect(capResult!.elapsedMs).toBeGreaterThanOrEqual(0)
}, 30000)
