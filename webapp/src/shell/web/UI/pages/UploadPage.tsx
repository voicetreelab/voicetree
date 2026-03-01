import { useState, useRef, useCallback } from 'react'
import type { JSX, ChangeEvent, DragEvent, RefObject } from 'react'
import { isRight } from 'fp-ts/lib/Either.js'
import type { Either } from 'fp-ts/lib/Either.js'
import type { TaskEither } from 'fp-ts/lib/TaskEither.js'
import { uploadPipeline } from '@/shell/web/uploadPipeline'
import type { ShareId, UploadError } from '@/pure/web-share/types'

type UploadState =
    | { readonly phase: 'idle' }
    | { readonly phase: 'uploading' }
    | { readonly phase: 'success'; readonly shareId: ShareId }
    | { readonly phase: 'error'; readonly error: UploadError }

function formatError(error: UploadError): string {
    switch (error.tag) {
        case 'NoMarkdownFiles':
            return 'No markdown files found in the selected folder.'
        case 'TooLarge':
            return `Upload too large: ${(error.bytes / 1_000_000).toFixed(1)}MB exceeds the 20MB limit.`
        case 'TooManyFiles':
            return `${error.count} files exceeds the ${error.maxCount} file limit.`
        case 'InvalidPath':
            return `Invalid path "${error.path}": ${error.reason}`
        case 'UploadFailed':
            return `Upload failed: ${error.error}`
    }
}

export default function UploadPage(): JSX.Element {
    const [state, setState] = useState<UploadState>({ phase: 'idle' })
    const inputRef: RefObject<HTMLInputElement | null> = useRef<HTMLInputElement>(null)
    const [isDragOver, setIsDragOver] = useState<boolean>(false)

    const baseUrl: string = import.meta.env.VITE_WORKER_URL ?? window.location.origin

    const handleFiles: (files: FileList) => Promise<void> = useCallback(async (files: FileList): Promise<void> => {
        if (files.length === 0) return
        setState({ phase: 'uploading' })

        const run: TaskEither<UploadError, ShareId> = uploadPipeline(baseUrl)(files)
        const result: Either<UploadError, ShareId> = await run()

        if (isRight(result)) {
            setState({ phase: 'success', shareId: result.right })
        } else {
            setState({ phase: 'error', error: result.left })
        }
    }, [baseUrl])

    const handleInputChange: (e: ChangeEvent<HTMLInputElement>) => void = useCallback((e: ChangeEvent<HTMLInputElement>): void => {
        const files: FileList | null = e.target.files
        if (files) void handleFiles(files)
    }, [handleFiles])

    const handleDragOver: (e: DragEvent<HTMLDivElement>) => void = useCallback((e: DragEvent<HTMLDivElement>): void => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(true)
    }, [])

    const handleDragLeave: (e: DragEvent<HTMLDivElement>) => void = useCallback((e: DragEvent<HTMLDivElement>): void => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)
    }, [])

    const handleDrop: (e: DragEvent<HTMLDivElement>) => Promise<void> = useCallback(async (e: DragEvent<HTMLDivElement>): Promise<void> => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)

        const items: DataTransferItem[] = Array.from(e.dataTransfer.items)
        const entry: FileSystemEntry | null = items[0]?.webkitGetAsEntry?.() ?? null

        if (entry?.isDirectory) {
            // Read directory recursively and build a synthetic FileList-like structure
            const fileList: File[] = []
            const readEntries = (dirEntry: FileSystemDirectoryEntry): Promise<void> =>
                new Promise((resolve, reject) => {
                    const reader: FileSystemDirectoryReader = dirEntry.createReader()
                    const readBatch = (): void => {
                        reader.readEntries((entries: FileSystemEntry[]) => {
                            if (entries.length === 0) { resolve(); return }
                            const promises: Promise<void>[] = entries.map((child: FileSystemEntry) => {
                                if (child.isDirectory) return readEntries(child as FileSystemDirectoryEntry)
                                return new Promise<void>((res, rej) => {
                                    ;(child as FileSystemFileEntry).file((f: File) => {
                                        // Preserve relative path using fullPath (strip leading /)
                                        const relativePath: string = child.fullPath.replace(/^\//, '')
                                        const fileWithPath: File = new File([f], f.name, { type: f.type })
                                        Object.defineProperty(fileWithPath, 'webkitRelativePath', { value: relativePath })
                                        fileList.push(fileWithPath)
                                        res()
                                    }, rej)
                                })
                            })
                            void Promise.all(promises).then(readBatch, reject)
                        }, reject)
                    }
                    readBatch()
                })

            try {
                await readEntries(entry as FileSystemDirectoryEntry)
                if (fileList.length > 0) {
                    // Create a DataTransfer to build a proper FileList
                    const dt: DataTransfer = new DataTransfer()
                    fileList.forEach((f: File) => dt.items.add(f))
                    void handleFiles(dt.files)
                }
            } catch {
                setState({ phase: 'error', error: { tag: 'UploadFailed', error: 'Failed to read dropped directory' } })
            }
        } else {
            // Fallback: use files directly (flat file drop)
            const files: FileList = e.dataTransfer.files
            if (files.length > 0) void handleFiles(files)
        }
    }, [handleFiles])

    const handleClick: () => void = useCallback((): void => {
        if (inputRef.current) inputRef.current.click()
    }, [])

    if (state.phase === 'success') {
        const shareUrl: string = `${window.location.origin}/share/${state.shareId}`
        return (
            <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-8">
                <div className="w-full max-w-lg text-center">
                    <div className="mb-6 text-4xl">&#10003;</div>
                    <h2 className="mb-4 text-xl font-semibold text-neutral-100">
                        Vault shared successfully
                    </h2>
                    <div className="mb-6 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
                        <a
                            href={shareUrl}
                            className="break-all text-blue-400 underline hover:text-blue-300"
                        >
                            {shareUrl}
                        </a>
                    </div>
                    <button
                        onClick={() => void navigator.clipboard.writeText(shareUrl)}
                        className="mr-3 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
                    >
                        Copy link
                    </button>
                    <button
                        onClick={() => setState({ phase: 'idle' })}
                        className="rounded-md border border-neutral-600 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
                    >
                        Upload another
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-8">
            <div className="w-full max-w-lg">
                <h1 className="mb-8 text-center text-2xl font-bold text-neutral-100">
                    Share a VoiceTree vault
                </h1>

                <input
                    ref={inputRef}
                    type="file"
                    // @ts-expect-error webkitdirectory is not in React's input type definitions
                    webkitdirectory=""
                    className="hidden"
                    onChange={handleInputChange}
                />

                <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={handleClick}
                    className={`cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
                        isDragOver
                            ? 'border-blue-400 bg-blue-400/10'
                            : 'border-neutral-600 bg-neutral-900 hover:border-neutral-400'
                    }`}
                >
                    {state.phase === 'uploading' ? (
                        <div>
                            <div className="mb-3 text-3xl animate-pulse">&#8635;</div>
                            <p className="text-neutral-300">Uploading...</p>
                        </div>
                    ) : (
                        <div>
                            <div className="mb-3 text-3xl text-neutral-500">&#128193;</div>
                            <p className="mb-2 text-neutral-200">
                                Drop a folder here or click to browse
                            </p>
                            <p className="text-sm text-neutral-500">
                                Markdown vault with .voicetree/ folder
                            </p>
                        </div>
                    )}
                </div>

                {state.phase === 'error' && (
                    <div className="mt-4 rounded-lg border border-red-800 bg-red-950 p-4 text-sm text-red-300">
                        {formatError(state.error)}
                    </div>
                )}
            </div>
        </div>
    )
}
