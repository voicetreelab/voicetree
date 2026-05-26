import path from 'path'

import normalizePath from 'normalize-path'

import type { Position } from '@vt/graph-model'

import type { Command } from '../../src/contract.ts'

export interface MarkdownFile {
    readonly relativePath: string
    readonly content: string
}

export interface SyntheticRootSpec {
    readonly rootPath: string
    readonly files: readonly MarkdownFile[]
    readonly extraDirs?: readonly string[]
}

export interface SyntheticStateSpec {
    readonly roots: readonly SyntheticRootSpec[]
    readonly loadedRoots?: readonly string[]
    readonly writeFolder?: string | null
    readonly collapseSet?: readonly string[]
    readonly selection?: readonly string[]
    readonly layout?: {
        readonly zoom?: number
        readonly pan?: Position
        readonly fit?: { readonly paddingPx: number } | null
    }
    readonly meta?: {
        readonly revision?: number
        readonly mutatedAt?: string
    }
}

export const ROOT_A = '/tmp/graph-state-fixtures/root-a'
export const ROOT_B = '/tmp/graph-state-fixtures/root-b'
export const ROOT_EMPTY = '/tmp/graph-state-fixtures/root-empty'

export function abs(rootPath: string, relativePath: string = ''): string {
    return normalizePath(relativePath === '' ? rootPath : path.posix.join(rootPath, relativePath))
}

export function folderId(rootPath: string, relativePath: string): string {
    return `${abs(rootPath, relativePath)}/`
}

function folderPath(folderId: string): string {
    return folderId.endsWith('/') ? folderId.slice(0, -1) : folderId
}

export function setFolderState(
    path: string,
    state: 'expanded' | 'collapsed' | 'hidden',
): Command {
    return {
        type: 'SetFolderState',
        viewId: 'main',
        path: folderPath(path),
        state,
    }
}
