import { promises as fs } from 'fs'
import path from 'path'
import type { FSUpdate, GraphDelta, Graph, GraphNode, NodeIdAndFilePath } from '@vt/graph-model/graph'
import { getAppendedSuffix, isAppendOnly, mapFSEventsToGraphDelta } from '@vt/graph-model/graph'
import { fromNodeToContentWithWikilinks } from '@vt/graph-model/markdown'

import { applyGraphDeltaToMemState, refreshGraphChangeSideEffects } from './applyGraphDelta.ts'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { markRecentDelta } from '@vt/graph-db-server/state/recent-deltas-store'
import { publish } from '@vt/graph-db-server/state/events/deltaEventBus'
import { markPendingWrite } from '@vt/graph-db-server/watch-folder/pending-writes'

export type WriteMarkdownFileRequest = {
  readonly absolutePath: string
  readonly body: string
  readonly editorId: string
}

export type WriteMarkdownFileResult = {
  readonly absolutePath: string
  readonly preservedSuffix: string | null
}

export type WriteMarkdownFileDeps = {
  readonly readFile: (filePath: string, encoding: 'utf8') => Promise<string>
  readonly writeFile: (filePath: string, content: string, encoding: 'utf8') => Promise<void>
}

const defaultWriteMarkdownFileDeps: WriteMarkdownFileDeps = {
  readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
  writeFile: (filePath, content, encoding) => fs.writeFile(filePath, content, encoding),
}

const lastEditorBodyByTargetAndEditor: Map<string, string> = new Map()

function editorBodyKey(targetPath: string, editorId: string): string {
  return `${targetPath}\0${editorId}`
}

function lineEndAt(content: string, from: number): number {
  const newlineIndex = content.indexOf('\n', from)
  return newlineIndex === -1 ? content.length : newlineIndex + 1
}

function lineText(content: string, start: number, end: number): string {
  return content.slice(start, end).replace(/\r?\n$/, '')
}

function detectLineEnding(content: string): string {
  return content.startsWith('---\r\n') ? '\r\n' : '\n'
}

function extractFrontmatterBlock(existingContent: string): string | null {
  const firstLineEnd = lineEndAt(existingContent, 0)
  if (lineText(existingContent, 0, firstLineEnd) !== '---') {
    return null
  }

  let cursor = firstLineEnd
  while (cursor < existingContent.length) {
    const nextLineEnd = lineEndAt(existingContent, cursor)
    if (lineText(existingContent, cursor, nextLineEnd) === '---') {
      const block = existingContent.slice(0, nextLineEnd)
      return block.endsWith('\n') ? block : `${block}${detectLineEnding(existingContent)}`
    }
    cursor = nextLineEnd
  }

  return null
}

export function composeMarkdownFileContent(
  existingContent: string | null,
  newBody: string,
): string {
  if (existingContent === null) {
    return newBody
  }

  const frontmatterBlock = extractFrontmatterBlock(existingContent)
  if (frontmatterBlock === null) {
    return newBody
  }

  return `${frontmatterBlock}${newBody}`
}

function stripFrontmatterBlock(existingContent: string): string {
  const frontmatterBlock = extractFrontmatterBlock(existingContent)
  return frontmatterBlock === null
    ? existingContent
    : existingContent.slice(frontmatterBlock.length)
}

function getGraphBodyForTarget(graph: Graph, targetPath: string): string | null {
  const node: GraphNode | undefined = graph.nodes[targetPath as NodeIdAndFilePath]
  return node ? fromNodeToContentWithWikilinks(node) : null
}

export function preservePendingExternalAppend(
  existingContent: string | null,
  newBody: string,
  currentGraphBody: string | null,
  lastEditorBody: string | null = null,
): string {
  return preservePendingExternalAppendWithSuffix(
    existingContent,
    newBody,
    currentGraphBody,
    lastEditorBody,
  ).body
}

function preservePendingExternalAppendWithSuffix(
  existingContent: string | null,
  newBody: string,
  currentGraphBody: string | null,
  lastEditorBody: string | null,
): { readonly body: string; readonly preservedSuffix: string | null } {
  if (existingContent === null) {
    return { body: newBody, preservedSuffix: null }
  }

  const existingBody = stripFrontmatterBlock(existingContent)
  const baselines: readonly (string | null)[] = [lastEditorBody, currentGraphBody]
  for (const baseline of baselines) {
    if (baseline === null || !isAppendOnly(baseline, existingBody)) {
      continue
    }

    const suffix = getAppendedSuffix(baseline, existingBody)
    return {
      body: newBody.endsWith(suffix) ? newBody : `${newBody}${suffix}`,
      preservedSuffix: newBody.endsWith(suffix) ? null : suffix,
    }
  }

  return { body: newBody, preservedSuffix: null }
}

export function resolveFolderMarkdownTarget(absolutePath: string): string {
  return absolutePath.endsWith(path.sep) || absolutePath.endsWith('/')
    ? path.join(absolutePath, 'index.md')
    : absolutePath
}

function buildWriteMarkdownFileDelta(
  targetPath: string,
  nextContent: string,
  eventType: FSUpdate['eventType'],
  graph: Graph,
): GraphDelta {
  return mapFSEventsToGraphDelta({
    absolutePath: targetPath,
    content: nextContent,
    eventType,
  }, graph)
}

export async function writeMarkdownFile(
  request: WriteMarkdownFileRequest,
  deps: WriteMarkdownFileDeps = defaultWriteMarkdownFileDeps,
): Promise<WriteMarkdownFileResult> {
  const targetPath = resolveFolderMarkdownTarget(request.absolutePath)
  let existingContent: string | null = null
  try {
    existingContent = await deps.readFile(targetPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const currentGraph = getGraph()
  const key = editorBodyKey(targetPath, request.editorId)
  const currentGraphBody = getGraphBodyForTarget(currentGraph, targetPath)
  const lastEditorBody = lastEditorBodyByTargetAndEditor.get(key) ?? null
  const preserved = preservePendingExternalAppendWithSuffix(
    existingContent,
    request.body,
    currentGraphBody,
    lastEditorBody,
  )
  const body = preserved.body
  const nextContent = composeMarkdownFileContent(existingContent, body)
  const suppressForSubscribers: readonly string[] = preserved.preservedSuffix === null
    ? [request.editorId]
    : []
  const delta = buildWriteMarkdownFileDelta(
    targetPath,
    nextContent,
    existingContent === null ? 'Added' : 'Changed',
    currentGraph,
  )
  markPendingWrite(targetPath, preserved.preservedSuffix === null
    ? { suppressBroadcastTo: request.editorId }
    : {})
  await deps.writeFile(targetPath, nextContent, 'utf8')
  lastEditorBodyByTargetAndEditor.set(key, body)
  const appliedDelta = await applyGraphDeltaToMemState(delta)
  for (const nodeDelta of delta) {
    markRecentDelta(nodeDelta)
  }
  refreshGraphChangeSideEffects()
  publish({
    delta: appliedDelta,
    source: 'write-markdown-file',
    suppressForSubscribers,
  })
  return {
    absolutePath: targetPath,
    preservedSuffix: preserved.preservedSuffix,
  }
}
