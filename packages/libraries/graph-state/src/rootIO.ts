import type { Either } from 'fp-ts/lib/Either.js'
import type { DirectoryEntry, Graph } from '@vt/graph-model'

export interface RootIO {
    readonly getDirectoryTree: (rootPath: string, maxDepth?: number) => Promise<DirectoryEntry>
    readonly loadGraphFromDisk: (projectPaths: readonly string[]) => Promise<Either<unknown, Graph>>
}

let rootIO: RootIO | undefined

export function configureRootIO(io: RootIO): void {
    rootIO = io
}

export function clearRootIOForTests(): void {
    rootIO = undefined
}

export function getRootIO(): RootIO {
    if (!rootIO) {
        throw new Error('Root I/O is not configured. Call configureRootIO before using project fixture loading.')
    }

    return rootIO
}
