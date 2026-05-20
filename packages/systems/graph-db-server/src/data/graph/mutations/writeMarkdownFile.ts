import { promises as fs } from 'fs'
import path from 'path'

import { markPendingWrite } from '@vt/graph-db-server/watch-folder/pending-writes'

export type WriteMarkdownFileRequest = {
  readonly absolutePath: string
  readonly body: string
  readonly editorId: string
}

export type WriteMarkdownFileDeps = {
  readonly readFile: (filePath: string, encoding: 'utf8') => Promise<string>
  readonly writeFile: (filePath: string, content: string, encoding: 'utf8') => Promise<void>
}

const defaultWriteMarkdownFileDeps: WriteMarkdownFileDeps = {
  readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
  writeFile: (filePath, content, encoding) => fs.writeFile(filePath, content, encoding),
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

export function resolveFolderMarkdownTarget(absolutePath: string): string {
  return absolutePath.endsWith(path.sep) || absolutePath.endsWith('/')
    ? path.join(absolutePath, 'index.md')
    : absolutePath
}

export async function writeMarkdownFile(
  request: WriteMarkdownFileRequest,
  deps: WriteMarkdownFileDeps = defaultWriteMarkdownFileDeps,
): Promise<string> {
  const targetPath = resolveFolderMarkdownTarget(request.absolutePath)
  let existingContent: string | null = null
  try {
    existingContent = await deps.readFile(targetPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const nextContent = composeMarkdownFileContent(existingContent, request.body)
  markPendingWrite(targetPath, { suppressBroadcastTo: request.editorId })
  await deps.writeFile(targetPath, nextContent, 'utf8')
  return targetPath
}
