import * as E from 'fp-ts/lib/Either.js'
import { pipe } from 'fp-ts/lib/function.js'
import * as RA from 'fp-ts/lib/ReadonlyArray.js'
import type { RelativePath, UploadError } from './types'
import { MAX_TOTAL_SIZE, MAX_FILE_SIZE, MAX_FILE_COUNT } from './types'

/**
 * Normalize a raw path to RelativePath format:
 * - Replace backslash → forward slash
 * - Strip leading ./
 * - Strip leading /
 * - Collapse consecutive //
 * - Reject paths containing .. or null bytes
 */
function normalizePath(raw: string): E.Either<UploadError, RelativePath> {
  const p: string = raw
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .replace(/\/\/+/g, '/')

  if (p.includes('..')) {
    return E.left({ tag: 'InvalidPath', path: raw, reason: 'Path traversal (..) not allowed' })
  }
  if (p.includes('\0')) {
    return E.left({ tag: 'InvalidPath', path: raw, reason: 'Null bytes not allowed' })
  }

  return E.right(p)
}

function normalizeAll(
  entries: readonly (readonly [string, string])[]
): E.Either<UploadError, readonly (readonly [RelativePath, string])[]> {
  return pipe(
    entries,
    RA.reduce<readonly [string, string], E.Either<UploadError, readonly (readonly [RelativePath, string])[]>>(
      E.right([]),
      (acc, [rawPath, content]) =>
        pipe(
          acc,
          E.chain((normalized) =>
            pipe(
              normalizePath(rawPath),
              E.map((p: RelativePath): readonly (readonly [RelativePath, string])[] => [...normalized, [p, content]])
            )
          )
        )
    )
  )
}

function byteSize(content: string): number {
  return new TextEncoder().encode(content).byteLength
}

/**
 * Validate files for upload.
 * Rules applied in order:
 * 1. All paths are safe (no traversal)
 * 2. Has at least one .md file
 * 3. File count within limit
 * 4. Per-file size within limit
 * 5. Total size within limit
 */
export function validateUpload(
  files: ReadonlyMap<RelativePath, string>
): E.Either<UploadError, readonly RelativePath[]> {
  const entries: readonly (readonly [string, string])[] = Array.from(files.entries())

  return pipe(
    normalizeAll(entries),
    E.chain((normalized: readonly (readonly [RelativePath, string])[]) => {
      // Check has markdown files
      const mdPaths: readonly RelativePath[] = normalized
        .filter(([p]: readonly [RelativePath, string]) => p.endsWith('.md'))
        .map(([p]: readonly [RelativePath, string]) => p)

      if (mdPaths.length === 0) {
        return E.left<UploadError>({ tag: 'NoMarkdownFiles' })
      }

      // Check count
      if (normalized.length > MAX_FILE_COUNT) {
        return E.left<UploadError>({ tag: 'TooManyFiles', count: normalized.length, maxCount: MAX_FILE_COUNT })
      }

      // Check per-file size
      const oversized: readonly (readonly [RelativePath, string])[] = normalized.filter(
        ([, content]: readonly [RelativePath, string]) => byteSize(content) > MAX_FILE_SIZE
      )
      if (oversized.length > 0) {
        const [, content]: readonly [RelativePath, string] = oversized[0]
        return E.left<UploadError>({ tag: 'TooLarge', bytes: byteSize(content) })
      }

      // Check total size
      const totalSize: number = normalized.reduce(
        (sum: number, [, content]: readonly [RelativePath, string]) => sum + byteSize(content),
        0
      )
      if (totalSize > MAX_TOTAL_SIZE) {
        return E.left<UploadError>({ tag: 'TooLarge', bytes: totalSize })
      }

      return E.right(mdPaths)
    })
  )
}
