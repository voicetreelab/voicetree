import * as TE from 'fp-ts/lib/TaskEither.js'
import * as E from 'fp-ts/lib/Either.js'
import { pipe } from 'fp-ts/lib/function.js'
import type { RelativePath, ShareId, ShareManifest, UploadError } from '@vt/graph-model/pure/web-share/types'
import { validateUpload } from '@vt/graph-model/pure/web-share/validateUpload'
import { buildManifest } from '@vt/graph-model/pure/web-share/buildManifest'
import { uploadToR2 } from './r2Client'

/**
 * Read a browser FileList into a Map of relative paths → content.
 * Uses webkitRelativePath for directory uploads, falls back to file.name.
 */
function readDroppedFiles(files: FileList): TE.TaskEither<UploadError, ReadonlyMap<RelativePath, string>> {
    return TE.tryCatch(
        async () => {
            const entries: [RelativePath, string][] = []
            for (let i: number = 0; i < files.length; i++) {
                const file: File = files[i]
                const path: RelativePath = file.webkitRelativePath || file.name
                const content: string = await file.text()
                entries.push([path, content])
            }
            return new Map(entries) as ReadonlyMap<RelativePath, string>
        },
        (err: unknown): UploadError => ({ tag: 'InvalidPath', path: '', reason: String(err) })
    )
}

/**
 * Extract the folder name from a FileList.
 * Uses the first path segment of webkitRelativePath, or 'shared' as fallback.
 */
function extractFolderName(files: FileList): string {
    const first: File | undefined = files[0]
    if (!first?.webkitRelativePath) return 'shared'
    return first.webkitRelativePath.split('/')[0] || 'shared'
}

/**
 * Upload pipeline: read dropped files → validate → build manifest → upload to R2.
 * (baseUrl) => (droppedFiles) => TaskEither<UploadError, ShareId>
 */
export const uploadPipeline: (baseUrl: string) => (droppedFiles: FileList) => TE.TaskEither<UploadError, ShareId> = (baseUrl: string) => (droppedFiles: FileList): TE.TaskEither<UploadError, ShareId> =>
    pipe(
        readDroppedFiles(droppedFiles),
        TE.chainEitherK((files: ReadonlyMap<RelativePath, string>) =>
            pipe(
                validateUpload(files),
                E.map((paths: readonly RelativePath[]) => ({ files, paths }))
            )
        ),
        TE.chain(({ files, paths }) => {
            const manifest: ShareManifest = buildManifest(paths, extractFolderName(droppedFiles))
            return TE.tryCatch(
                () => uploadToR2(baseUrl, files, manifest),
                (err: unknown): UploadError => ({ tag: 'UploadFailed', error: String(err) })
            )
        })
    )
