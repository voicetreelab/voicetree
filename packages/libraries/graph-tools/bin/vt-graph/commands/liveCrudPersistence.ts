import fs from 'node:fs'
import path from 'node:path'
import {type Delta} from '@vt/graph-state'
import {linkMatchScore} from '@vt/graph-model'
import {removePositionForFile, writePositionForFile} from '../../livePositionPersist'
import {liveStateDump} from '../../../src/live/live'
import type {ParsedLiveCrudCommand} from './liveCrudParse'

export interface LiveGraphNodeSnapshot {
  readonly outgoingEdges?: readonly {readonly targetId?: string; readonly label?: string}[]
  readonly nodeUIMetadata?: {
    readonly position?: {
      readonly _tag?: string
      readonly value?: {readonly x?: number; readonly y?: number}
    }
  }
}

export type LiveGraphNodesSnapshot = Record<string, LiveGraphNodeSnapshot | undefined>

function withTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

function markdownLinkTarget(sourceFile: string, targetFile: string): string {
  const relativePath = path.relative(path.dirname(sourceFile), targetFile).replaceAll(path.sep, '/')
  return relativePath.replace(/\.md$/, '')
}

function edgeLine(sourceFile: string, targetFile: string, label: string): string {
  const link = `[[${markdownLinkTarget(sourceFile, targetFile)}]]`
  return label ? `${label} ${link}` : link
}

function appendLineIfMissing(content: string, line: string): string {
  const lines = content.split(/\r?\n/)
  if (lines.includes(line)) return content
  return `${withTrailingNewline(content)}${line}\n`
}

const WIKILINK_PATTERN = /\[\[([^\]\r\n]+)\]\]/g

function wikilinkTargetText(linkText: string): string {
  return (linkText.split('|')[0] ?? '').split('#')[0]?.trim() ?? ''
}

function resolveWikilinkPath(sourceFile: string, linkText: string): string {
  const targetText = wikilinkTargetText(linkText)
  const relativeWithExtension = targetText.endsWith('.md') ? targetText : `${targetText}.md`
  return path.resolve(path.dirname(sourceFile), relativeWithExtension)
}

function linkReferencesTarget(
  linkText: string,
  sourceFile: string,
  targetFile: string,
  candidateTargetIds: readonly string[],
): boolean {
  const linkTargetText = wikilinkTargetText(linkText)
  if (linkTargetText === '') return false

  if (pathIdentitiesOverlap(resolveWikilinkPath(sourceFile, linkText), targetFile)) {
    return true
  }

  const scoredTargets = candidateTargetIds
    .map((targetId) => ({targetId, score: linkMatchScore(linkTargetText, targetId)}))
    .filter(({score}) => score > 0)
  const bestScore = Math.max(0, ...scoredTargets.map(({score}) => score))
  const bestTargets = scoredTargets.filter(({score}) => score === bestScore)
  const bestTarget = bestTargets[0]?.targetId

  return bestTargets.length === 1 && bestTarget !== undefined && pathIdentitiesOverlap(bestTarget, targetFile)
}

function removeWikilinkMatchesFromLine(
  line: string,
  sourceFile: string,
  targetFile: string,
  candidateTargetIds: readonly string[],
  removableLabels: readonly string[],
): string | undefined {
  const matches = [...line.matchAll(WIKILINK_PATTERN)]
  const matchingSpans = matches
    .filter((match) => linkReferencesTarget(match[1] ?? '', sourceFile, targetFile, candidateTargetIds))
    .map((match) => ({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }))

  if (matchingSpans.length === 0) return line
  if (matchingSpans.length !== matches.length) return line

  const nextLine = matchingSpans
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, span) => `${current.slice(0, span.start)}${current.slice(span.end)}`,
      line,
    )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/g, '')

  const nextLineText = nextLine.trim()
  if (matchingSpans.length === matches.length
    && (nextLineText === '' || removableLabels.includes(nextLineText))
  ) {
    return undefined
  }

  return line
}

function removeEdgeLine(
  content: string,
  sourceFile: string,
  targetFile: string,
  candidateTargetIds: readonly string[],
  removableLabels: readonly string[],
): string {
  const nextLines = content.split(/\r?\n/)
    .map((line) => removeWikilinkMatchesFromLine(
      line,
      sourceFile,
      targetFile,
      candidateTargetIds,
      removableLabels,
    ))
    .filter((line): line is string => line !== undefined)
  return withTrailingNewline(nextLines.join('\n').replace(/\n+$/, ''))
}

function pathIdentityCandidates(filePath: string): readonly string[] {
  const candidates = new Set<string>([path.resolve(filePath)])

  try {
    candidates.add(fs.realpathSync.native(filePath))
  } catch {
    // The path may not exist yet or may have just been deleted.
  }

  try {
    candidates.add(path.join(fs.realpathSync.native(path.dirname(filePath)), path.basename(filePath)))
  } catch {
    // Parent may not exist yet; the resolved path above is still useful.
  }

  return [...candidates]
}

function isPathWithinRoot(filePath: string, root: string): boolean {
  return filePath === root || filePath.startsWith(`${root}${path.sep}`)
}

function findLoadedRootForFile(loadedRoots: readonly string[], filePath: string): string | undefined {
  const fileCandidates = pathIdentityCandidates(filePath)
  return [...loadedRoots]
    .map((root) => ({
      root,
      rootCandidates: pathIdentityCandidates(root),
    }))
    .filter(({rootCandidates}) => rootCandidates
      .some((rootCandidate) => fileCandidates
        .some((fileCandidate) => isPathWithinRoot(fileCandidate, rootCandidate))))
    .sort((left, right) => Math.max(...right.rootCandidates.map((candidate) => candidate.length))
      - Math.max(...left.rootCandidates.map((candidate) => candidate.length)))[0]?.root
}

export async function getLiveGraphNodes(projectPath?: string): Promise<LiveGraphNodesSnapshot> {
  const result = await liveStateDump({pretty: false, ...(projectPath !== undefined ? {projectPath} : {})})
  const parsed = JSON.parse(result.json) as {
    graph?: {nodes?: Record<string, LiveGraphNodeSnapshot | undefined>}
  }
  return parsed.graph?.nodes ?? {}
}

function hasLiveNode(nodes: LiveGraphNodesSnapshot, nodeId: string): boolean {
  return nodes[nodeId] !== undefined
}

function pathIdentitiesOverlap(leftPath: string, rightPath: string): boolean {
  const rightCandidates = new Set(pathIdentityCandidates(rightPath))
  return pathIdentityCandidates(leftPath).some((candidate) => rightCandidates.has(candidate))
}

function resolveLiveNodeId(nodes: LiveGraphNodesSnapshot, filePath: string): string {
  return Object.keys(nodes)
    .find((nodeId) => pathIdentitiesOverlap(nodeId, filePath)) ?? filePath
}

function hasLiveEdge(
  nodes: LiveGraphNodesSnapshot,
  source: string,
  targetId: string,
  label?: string,
): boolean {
  return (nodes[source]?.outgoingEdges ?? [])
    .some((edge) => edge.targetId === targetId && (label === undefined || edge.label === label))
}

function nodeHasLivePosition(
  nodes: LiveGraphNodesSnapshot,
  nodeId: string,
  position: {readonly x: number; readonly y: number},
): boolean {
  const livePosition = nodes[nodeId]?.nodeUIMetadata?.position
  return livePosition?._tag === 'Some'
    && livePosition.value?.x === position.x
    && livePosition.value?.y === position.y
}

export function resolveCommandNodeIds(
  parsed: ParsedLiveCrudCommand,
  nodes: LiveGraphNodesSnapshot,
): ParsedLiveCrudCommand {
  const command = parsed.command

  switch (command.type) {
    case 'AddNode': {
      const file = resolveLiveNodeId(nodes, command.node.absoluteFilePathIsID)
      return {
        ...parsed,
        command: {
          ...command,
          node: {
            ...command.node,
            absoluteFilePathIsID: file,
          },
        },
      }
    }
    case 'RemoveNode':
      return {...parsed, command: {...command, id: resolveLiveNodeId(nodes, command.id)}}
    case 'AddEdge':
      return {
        ...parsed,
        command: {
          ...command,
          source: resolveLiveNodeId(nodes, command.source),
          edge: {
            ...command.edge,
            targetId: resolveLiveNodeId(nodes, command.edge.targetId),
          },
        },
      }
    case 'RemoveEdge':
      return {
        ...parsed,
        command: {
          ...command,
          source: resolveLiveNodeId(nodes, command.source),
          targetId: resolveLiveNodeId(nodes, command.targetId),
        },
      }
    case 'Move':
      return {...parsed, command: {...command, id: resolveLiveNodeId(nodes, command.id)}}
    default:
      return parsed
  }
}

function deltaMovedPosition(delta: Delta, nodeId: string): boolean {
  return delta.positionsMoved instanceof Map && delta.positionsMoved.has(nodeId)
}

export async function persistLiveCrudCommand(
  parsed: ParsedLiveCrudCommand,
  delta: Delta,
  beforeNodes: LiveGraphNodesSnapshot,
  afterNodes: LiveGraphNodesSnapshot,
): Promise<void> {
  const command = parsed.command

  switch (command.type) {
    case 'AddNode': {
      const file = command.node.absoluteFilePathIsID
      if (!hasLiveNode(afterNodes, file)) return
      fs.mkdirSync(path.dirname(file), {recursive: true})
      fs.writeFileSync(file, withTrailingNewline(command.node.contentWithoutYamlOrLinks), 'utf8')
      if (command.node.nodeUIMetadata.position._tag === 'Some') {
        await writePositionForFile(file, command.node.nodeUIMetadata.position.value, parsed.projectPath)
      }
      return
    }
    case 'RemoveNode': {
      if (!hasLiveNode(beforeNodes, command.id) || hasLiveNode(afterNodes, command.id)) return
      if (fs.existsSync(command.id)) fs.rmSync(command.id, {force: true})
      await removePositionForFile(command.id, parsed.projectPath)
      return
    }
    case 'AddEdge': {
      if (!hasLiveNode(beforeNodes, command.source)
        || !hasLiveEdge(afterNodes, command.source, command.edge.targetId, command.edge.label)
      ) return
      const sourceContent = fs.existsSync(command.source) ? fs.readFileSync(command.source, 'utf8') : ''
      const nextContent = appendLineIfMissing(
        sourceContent,
        edgeLine(command.source, command.edge.targetId, command.edge.label),
      )
      fs.mkdirSync(path.dirname(command.source), {recursive: true})
      fs.writeFileSync(command.source, nextContent, 'utf8')
      return
    }
    case 'RemoveEdge': {
      if (!hasLiveEdge(beforeNodes, command.source, command.targetId)) return
      if (!fs.existsSync(command.source)) return
      const sourceEdges = beforeNodes[command.source]?.outgoingEdges ?? []
      const afterTargetLabels = new Set((afterNodes[command.source]?.outgoingEdges ?? [])
        .filter((edge) => edge.targetId === command.targetId)
        .map((edge) => edge.label ?? ''))
      const sourceEdgeTargetIds = [...new Set(sourceEdges
        .map((edge) => edge.targetId)
        .filter((targetId): targetId is string => typeof targetId === 'string'))]
      const removedEdgeLabels = sourceEdges
        .filter((edge) => edge.targetId === command.targetId)
        .map((edge) => edge.label ?? '')
        .filter((label) => !afterTargetLabels.has(label))
      if (removedEdgeLabels.length === 0) return
      fs.writeFileSync(
        command.source,
        removeEdgeLine(
          fs.readFileSync(command.source, 'utf8'),
          command.source,
          command.targetId,
          sourceEdgeTargetIds,
          removedEdgeLabels,
        ),
        'utf8',
      )
      return
    }
    case 'Move': {
      if (!deltaMovedPosition(delta, command.id) && !nodeHasLivePosition(afterNodes, command.id, command.to)) return
      await writePositionForFile(command.id, command.to, parsed.projectPath)
      return
    }
    default:
      return
  }
}
