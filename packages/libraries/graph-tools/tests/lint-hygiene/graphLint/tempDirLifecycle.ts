import { beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

export type TempDirHandle = {
    readonly get: () => string
}

export const createTempDirLifecycle = (): TempDirHandle => {
    let tempDir: string

    beforeEach(() => {
        tempDir = mkdtempSync(path.join(tmpdir(), 'graph-lint-test-'))
    })

    afterEach(() => {
        rmSync(tempDir, { recursive: true })
    })

    return {
        get: () => tempDir,
    }
}
