import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

type ValidatePathOptions = {
  requireExists?: boolean
}

type ValidatePathSuccess = {
  ok: true
  path: string
}

type ValidatePathFailure = {
  ok: false
  error: string
  code: string
}

export async function validateAbsolutePath(
  input: string,
  opts: ValidatePathOptions = {},
): Promise<ValidatePathSuccess | ValidatePathFailure> {
  const trimmed = input.trim()
  if (!trimmed) {
    return { ok: false, error: 'Path is required', code: 'PATH_EMPTY' }
  }

  if (!isAbsolute(trimmed)) {
    return {
      ok: false,
      error: 'Path must be absolute',
      code: 'PATH_NOT_ABSOLUTE',
    }
  }

  if (trimmed.split(/[\\/]+/).includes('..')) {
    return {
      ok: false,
      error: 'Path traversal is not allowed',
      code: 'PATH_TRAVERSAL',
    }
  }

  const normalizedPath = resolve(trimmed)
  if (!opts.requireExists) {
    return { ok: true, path: normalizedPath }
  }

  try {
    await stat(normalizedPath)
    return { ok: true, path: normalizedPath }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        ok: false,
        error: 'Path does not exist',
        code: 'PATH_NOT_FOUND',
      }
    }
    return {
      ok: false,
      error: 'Path is not accessible',
      code: 'PATH_NOT_ACCESSIBLE',
    }
  }
}
