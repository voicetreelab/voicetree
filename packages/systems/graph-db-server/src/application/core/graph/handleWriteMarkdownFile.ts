import path from 'path'
import { z } from 'zod'

import { validateAbsolutePath } from '../validatePath.ts'
import {
  resolveFolderMarkdownTarget,
  writeMarkdownFile,
  type WriteMarkdownFileResult,
} from '@vt/graph-db-server/graph/writeMarkdownFile'

const WriteMarkdownFileRequestSchema = z.object({
  absolutePath: z.string(),
  body: z.string(),
  editorId: z.string().min(1),
})

export type ParsedWriteMarkdownFileRequest =
  | {
      readonly ok: true
      readonly absolutePath: string
      readonly body: string
      readonly editorId: string
    }
  | {
      readonly ok: false
      readonly error: string
      readonly code: string
      readonly status?: number
    }

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath)
  return relativePath === ''
    || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export async function parseWriteMarkdownFileRequest(
  rawBody: unknown,
  projectRoot: string,
): Promise<ParsedWriteMarkdownFileRequest> {
  const parsed = WriteMarkdownFileRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid write markdown file request body',
      code: 'INVALID_WRITE_MARKDOWN_FILE_REQUEST',
    }
  }

  const targetPath = resolveFolderMarkdownTarget(parsed.data.absolutePath)
  const pathResult = await validateAbsolutePath(targetPath)
  if (!pathResult.ok) {
    return {
      ok: false,
      error: pathResult.error,
      code: pathResult.code,
    }
  }

  if (!isPathInside(path.resolve(projectRoot), pathResult.path)) {
    return {
      ok: false,
      error: 'Path must be inside the open project',
      code: 'PATH_OUTSIDE_PROJECT',
    }
  }

  return {
    ok: true,
    absolutePath: pathResult.path,
    body: parsed.data.body,
    editorId: parsed.data.editorId,
  }
}

export async function writeMarkdownFileFromRequest(request: {
  readonly absolutePath: string
  readonly body: string
  readonly editorId: string
}): Promise<{ readonly ok: true; readonly absolutePath: string; readonly preservedSuffix: string | null }> {
  const result: WriteMarkdownFileResult = await writeMarkdownFile(request)
  return {
    ok: true,
    absolutePath: result.absolutePath,
    preservedSuffix: result.preservedSuffix,
  }
}
