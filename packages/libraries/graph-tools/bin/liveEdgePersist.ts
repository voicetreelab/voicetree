// Wikilink + path-identity helpers used by live-CRUD command persistence.
// Pure string / path operations + a single filesystem-symlink probe for path
// identity. Extracted from vt-graph.ts/liveCrudOps.ts to keep both files
// under the 500-line size budget.
import fs from 'node:fs'
import path from 'node:path'

import {linkMatchScore} from '@vt/graph-model'

const WIKILINK_PATTERN = /\[\[([^\]\r\n]+)\]\]/g

export function withTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

function markdownLinkTarget(sourceFile: string, targetFile: string): string {
  const relativePath = path.relative(path.dirname(sourceFile), targetFile).replaceAll(path.sep, '/')
  return relativePath.replace(/\.md$/, '')
}

export function edgeLine(sourceFile: string, targetFile: string, label: string): string {
  const link = `[[${markdownLinkTarget(sourceFile, targetFile)}]]`
  return label ? `${label} ${link}` : link
}

export function appendLineIfMissing(content: string, line: string): string {
  const lines = content.split(/\r?\n/)
  if (lines.includes(line)) return content
  return `${withTrailingNewline(content)}${line}\n`
}

function wikilinkTargetText(linkText: string): string {
  return (linkText.split('|')[0] ?? '').split('#')[0]?.trim() ?? ''
}

function resolveWikilinkPath(sourceFile: string, linkText: string): string {
  const targetText = wikilinkTargetText(linkText)
  const relativeWithExtension = targetText.endsWith('.md') ? targetText : `${targetText}.md`
  return path.resolve(path.dirname(sourceFile), relativeWithExtension)
}

export function pathIdentityCandidates(filePath: string): readonly string[] {
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

export function pathIdentitiesOverlap(leftPath: string, rightPath: string): boolean {
  const rightCandidates = new Set(pathIdentityCandidates(rightPath))
  return pathIdentityCandidates(leftPath).some((candidate) => rightCandidates.has(candidate))
}

export function isPathWithinRoot(filePath: string, root: string): boolean {
  return filePath === root || filePath.startsWith(`${root}${path.sep}`)
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

export function removeEdgeLine(
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

export function findLoadedRootForFile(loadedRoots: readonly string[], filePath: string): string | undefined {
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
