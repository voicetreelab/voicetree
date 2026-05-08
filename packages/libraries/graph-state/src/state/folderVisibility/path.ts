import type { AbsolutePath } from './types'

/** Strip a trailing '/' from a path, preserving the filesystem root '/'. */
export function stripTrailingSlash(p: string): AbsolutePath {
    if (p === '' || p === '/') return p
    return p.endsWith('/') ? p.slice(0, -1) : p
}

/** Add a trailing '/' to a path, idempotent. */
export function ensureTrailingSlash(p: string): string {
    return p.endsWith('/') ? p : `${p}/`
}
