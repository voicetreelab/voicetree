import type { FolderTreeNode, FileTreeNode } from '@vt/graph-model'
import type { State } from '@vt/graph-state'
import type { StepSpec } from '../stepShape'

export const DEFAULT_STRESS_SEED = 17
export const DEFAULT_STRESS_SEQUENCE_LENGTH = 4

export const RECORDED_STATE_FIXTURE_IDS = [
  '001-empty',
  '002-single-node',
  '003-flat-three-nodes',
  '004-flat-five-nodes',
  '005-with-selection',
  '006-with-layout-positions',
  '007-with-layout-positions-moved',
  '008-add-node-result',
  '009-add-edge-result',
  '010-flat-folder',
  '011-flat-folder-collapsed',
  '012-f6-external-into-folder',
  '013-f6-external-into-folder-collapsed',
  '014-f6-folder-to-external',
  '015-f6-folder-to-external-collapsed',
  '020-two-sibling-folders',
  '021-nested-folder',
  '022-nested-folder-inner-collapsed',
  '023-all-collapsed',
  '040-mixed-collapse',
  '041-context-node-unresolved-link',
  '050-two-roots-root-a-only',
  '051-two-roots-loaded',
  '054-multi-command-final',
  '080-folder-nodes-real-vault',
] as const

export interface StressRuntimeContext {
  readonly rootPath: string
  readonly primaryNodeId: string
  readonly secondaryNodeId: string
  readonly primaryFolderId: string
}

type RandomSource = () => number
type StressTemplate = (rng: RandomSource) => readonly StepSpec[]

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z0-9_]+)\}\}/g

function isFolderTreeNode(node: FolderTreeNode | FileTreeNode): node is FolderTreeNode {
  return 'children' in node
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function collectFolderIds(folderTree: readonly FolderTreeNode[]): string[] {
  const folders: string[] = []

  const visit = (node: FolderTreeNode): void => {
    folders.push(withTrailingSlash(node.absolutePath))
    for (const child of node.children) {
      if (isFolderTreeNode(child)) {
        visit(child)
      }
    }
  }

  for (const root of folderTree) {
    for (const child of root.children) {
      if (isFolderTreeNode(child)) {
        visit(child)
      }
    }
  }

  return folders.sort((left, right) => left.localeCompare(right))
}

function createMulberry32(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function randomInt(rng: RandomSource, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

function randomZoom(rng: RandomSource): number {
  const raw = 0.7 + (rng() * 0.9)
  return Number(raw.toFixed(2))
}

function randomPan(rng: RandomSource): { x: number; y: number } {
  return {
    x: randomInt(rng, -240, 240),
    y: randomInt(rng, -180, 180),
  }
}

function randomWait(rng: RandomSource, min: number, max: number): number {
  return randomInt(rng, min, max)
}

const STRESS_TEMPLATES: readonly StressTemplate[] = [
  (rng) => [
    { dispatch: { type: 'SetPan', pan: randomPan(rng) } },
    { wait: randomWait(rng, 90, 160) },
    { dispatch: { type: 'SetPan', pan: randomPan(rng) } },
    { wait: randomWait(rng, 90, 160) },
  ],
  (rng) => [
    { dispatch: { type: 'SetZoom', zoom: randomZoom(rng) } },
    { wait: randomWait(rng, 80, 150) },
    { dispatch: { type: 'RequestFit', paddingPx: randomInt(rng, 20, 40) } },
    { wait: randomWait(rng, 90, 170) },
  ],
  (rng) => [
    { dispatch: { type: 'Collapse', folder: '{{primaryFolderId}}' } },
    { wait: randomWait(rng, 120, 220) },
    { dispatch: { type: 'Expand', folder: '{{primaryFolderId}}' } },
    { wait: randomWait(rng, 120, 220) },
  ],
  (rng) => [
    { dispatch: { type: 'Select', ids: ['{{primaryNodeId}}'] } },
    { wait: randomWait(rng, 80, 160) },
    { dispatch: { type: 'Select', ids: ['{{secondaryNodeId}}'], additive: true } },
    { wait: randomWait(rng, 80, 160) },
    { dispatch: { type: 'Deselect', ids: ['{{primaryNodeId}}'] } },
    { wait: randomWait(rng, 80, 160) },
  ],
  (rng) => [
    { dispatch: { type: 'UnloadRoot', root: '{{rootPath}}' } },
    { wait: randomWait(rng, 110, 220) },
    { dispatch: { type: 'LoadRoot', root: '{{rootPath}}' } },
    { wait: randomWait(rng, 150, 260) },
    { dispatch: { type: 'RequestFit', paddingPx: randomInt(rng, 20, 36) } },
    { wait: randomWait(rng, 90, 180) },
  ],
] as const

function resolveTemplateValue<T>(value: T, context: StressRuntimeContext): T {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER_PATTERN, (_match, key) => {
      if (!(key in context)) {
        throw new Error(`unknown stress placeholder: ${key}`)
      }
      return context[key as keyof StressRuntimeContext]
    }) as T
  }

  if (Array.isArray(value)) {
    return value.map(item => resolveTemplateValue(item, context)) as T
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([key, item]) => [key, resolveTemplateValue(item, context)])
    return Object.fromEntries(entries) as T
  }

  return value
}

export function deriveStressRuntimeContext(state: State): StressRuntimeContext {
  const loadedRoots = [...state.roots.loaded].sort((left, right) => left.localeCompare(right))
  if (loadedRoots.length === 0) {
    throw new Error('live state has no loaded roots')
  }

  const graphNodeIds = Object.keys(state.graph.nodes).sort((left, right) => left.localeCompare(right))
  if (graphNodeIds.length === 0) {
    throw new Error('live state graph has no nodes')
  }

  const folderIds = collectFolderIds(state.roots.folderTree)

  return {
    rootPath: loadedRoots[0],
    primaryNodeId: graphNodeIds[0],
    secondaryNodeId: graphNodeIds[1] ?? graphNodeIds[0],
    primaryFolderId: folderIds[0] ?? withTrailingSlash(loadedRoots[0]),
  }
}

export function generateStressSequence(length: number, seed = DEFAULT_STRESS_SEED): StepSpec[] {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('stress sequence length must be a positive integer')
  }

  const rng = createMulberry32(seed)
  const steps: StepSpec[] = []
  let lastTemplateIndex = -1

  for (let index = 0; index < length; index += 1) {
    let templateIndex = randomInt(rng, 0, STRESS_TEMPLATES.length - 1)
    if (STRESS_TEMPLATES.length > 1 && templateIndex === lastTemplateIndex) {
      templateIndex = (templateIndex + 1) % STRESS_TEMPLATES.length
    }
    lastTemplateIndex = templateIndex
    steps.push(...STRESS_TEMPLATES[templateIndex](rng))
  }

  return steps
}

export function resolveStressSequence(
  steps: readonly StepSpec[],
  context: StressRuntimeContext,
): StepSpec[] {
  return resolveTemplateValue(steps, context)
}
