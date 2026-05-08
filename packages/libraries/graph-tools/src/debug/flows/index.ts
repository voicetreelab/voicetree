import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { FolderTreeNode, FileTreeNode } from '@vt/graph-model'
import type { State } from '@vt/graph-state'

import { validateStepSpec, type StepSpec } from '../stepShape'

export const FLOW_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'] as const

export type FlowId = (typeof FLOW_IDS)[number]

export interface FlowDefinition {
  readonly flow: FlowId
  readonly title: string
  readonly intent: string
  readonly exercises: readonly string[]
  readonly likelyStatusToday: string
  readonly judgeFocus: readonly string[]
  readonly steps: readonly StepSpec[]
}

export interface FlowRuntimeContext {
  readonly rootPath: string
  readonly primaryNodeId: string
  readonly secondaryNodeId: string
  readonly primaryFolderId: string
}

interface RawFlowDefinition {
  readonly flow: string
  readonly title: string
  readonly intent: string
  readonly exercises: readonly string[]
  readonly likelyStatusToday: string
  readonly judgeFocus: readonly string[]
  readonly steps: readonly unknown[]
}

const FLOWS_DIR = path.dirname(fileURLToPath(import.meta.url))
const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z0-9_]+)\}\}/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFolderTreeNode(node: FolderTreeNode | FileTreeNode): node is FolderTreeNode {
  return 'children' in node
}

function withTrailingSlash(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`
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

function validateRawFlowDefinition(flowId: FlowId, value: unknown): FlowDefinition {
  if (!isRecord(value)) {
    throw new Error(`${flowId}.json must be an object`)
  }

  const raw = value as RawFlowDefinition

  if (raw.flow !== flowId) {
    throw new Error(`${flowId}.json flow field must equal "${flowId}"`)
  }

  if (typeof raw.title !== 'string' || raw.title.trim() === '') {
    throw new Error(`${flowId}.json title must be a non-empty string`)
  }

  if (typeof raw.intent !== 'string' || raw.intent.trim() === '') {
    throw new Error(`${flowId}.json intent must be a non-empty string`)
  }

  if (!Array.isArray(raw.exercises) || raw.exercises.some(item => typeof item !== 'string')) {
    throw new Error(`${flowId}.json exercises must be an array of strings`)
  }

  if (typeof raw.likelyStatusToday !== 'string' || raw.likelyStatusToday.trim() === '') {
    throw new Error(`${flowId}.json likelyStatusToday must be a non-empty string`)
  }

  if (!Array.isArray(raw.judgeFocus) || raw.judgeFocus.some(item => typeof item !== 'string')) {
    throw new Error(`${flowId}.json judgeFocus must be an array of strings`)
  }

  if (!Array.isArray(raw.steps)) {
    throw new Error(`${flowId}.json steps must be an array`)
  }

  const steps: StepSpec[] = raw.steps.map((step, index) => {
    const validation = validateStepSpec(step)
    if (!validation.ok) {
      throw new Error(`${flowId}.json step ${index + 1}: ${validation.error}`)
    }
    return validation.step
  })

  return {
    flow: flowId,
    title: raw.title.trim(),
    intent: raw.intent.trim(),
    exercises: raw.exercises.map(item => item.trim()),
    likelyStatusToday: raw.likelyStatusToday.trim(),
    judgeFocus: raw.judgeFocus.map(item => item.trim()),
    steps,
  }
}

function substituteString(template: string, context: FlowRuntimeContext): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key) => {
    if (!(key in context)) {
      throw new Error(`unknown flow placeholder: ${key}`)
    }
    return context[key as keyof FlowRuntimeContext]
  })
}

function resolveValue<T>(value: T, context: FlowRuntimeContext): T {
  if (typeof value === 'string') {
    return substituteString(value, context) as T
  }

  if (Array.isArray(value)) {
    return value.map(item => resolveValue(item, context)) as T
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, item]) => [key, resolveValue(item, context)])
    return Object.fromEntries(entries) as T
  }

  return value
}

export function deriveFlowRuntimeContext(state: State): FlowRuntimeContext {
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

export function resolveFlowDefinition(
  definition: FlowDefinition,
  context: FlowRuntimeContext,
): FlowDefinition {
  return resolveValue(definition, context)
}

export function flowFilePath(flowId: FlowId): string {
  return path.join(FLOWS_DIR, `${flowId}.json`)
}

export async function loadFlowDefinition(flowId: FlowId): Promise<FlowDefinition> {
  const raw = await fs.readFile(flowFilePath(flowId), 'utf8')
  return validateRawFlowDefinition(flowId, JSON.parse(raw))
}

export async function loadAllFlowDefinitions(): Promise<FlowDefinition[]> {
  return Promise.all(FLOW_IDS.map(flowId => loadFlowDefinition(flowId)))
}
