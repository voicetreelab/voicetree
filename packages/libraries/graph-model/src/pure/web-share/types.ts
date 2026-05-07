// Plain type aliases (NOT branded types)
export type ShareId = string        // nanoid, 21 chars
export type RelativePath = string   // slash-normalized, e.g. 'subfolder/node.md'

export interface ShareManifest {
  readonly files: readonly RelativePath[]
  readonly folderName: string
  readonly createdAt: string   // ISO
}
// NOTE: No nodeCount field - callers use manifest.files.length

export type UploadError =
  | { readonly tag: 'NoMarkdownFiles' }
  | { readonly tag: 'TooLarge'; readonly bytes: number }
  | { readonly tag: 'TooManyFiles'; readonly count: number; readonly maxCount: number }
  | { readonly tag: 'InvalidPath'; readonly path: string; readonly reason: string }
  | { readonly tag: 'UploadFailed'; readonly error: string }

export type ViewError =
  | { readonly tag: 'NotFound'; readonly shareId: ShareId }
  | { readonly tag: 'FetchFailed'; readonly status: number }
  | { readonly tag: 'ParseFailed'; readonly file: string; readonly error: string }

// Constants
export const MAX_TOTAL_SIZE: number = 20_000_000   // 20MB
export const MAX_FILE_SIZE: number = 1_000_000     // 1MB per file
export const MAX_FILE_COUNT: number = 1000
