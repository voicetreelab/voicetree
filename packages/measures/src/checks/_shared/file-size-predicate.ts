// Pure predicate: does a file's content exceed the line-count budget?
// Consumed by tier_0_post_edit/ (per-edit agent hook). No I/O — caller
// supplies both the content and the maxLines limit, which the impure edge
// reads from budgets/shape/file-size.json.

const SOURCE_EXT_PATTERN = /\.(ts|tsx|js|jsx|css|scss|less)$/

type FileSizeResult =
    | {readonly kind: 'ok'}
    | {readonly kind: 'violation'; readonly actualLines: number; readonly maxLines: number}

function isSourceFile(filePath: string): boolean {
    return SOURCE_EXT_PATTERN.test(filePath)
}

function fileSizeCheck(content: string, maxLines: number): FileSizeResult {
    const lines = content.split('\n').length
    if (lines <= maxLines) return {kind: 'ok'}
    return {kind: 'violation', actualLines: lines, maxLines}
}

export const fileSizePredicate = {
    isSourceFile,
    fileSizeCheck,
} as const
