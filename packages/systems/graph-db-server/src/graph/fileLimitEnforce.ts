import * as E from 'fp-ts/lib/Either.js';

const MAX_FILES: 600 = 600 as const;

/**
 * Error type for file limit exceeded
 */
export type FileLimitExceededError = {
    readonly _tag: 'FileLimitExceededError';
    readonly fileCount: number;
    readonly maxFiles: number;
    readonly message: string;
};

function createFileLimitExceededError(fileCount: number, maxFiles: number): FileLimitExceededError {
    return {
        _tag: 'FileLimitExceededError',
        fileCount,
        maxFiles,
        message: `Directory contains ${fileCount} markdown files, which exceeds the limit of ${maxFiles}`
    };
}

/**
 * Enforces file limit on loaded directory
 * Returns error if limit exceeded - caller handles user notification
 *
 * @param fileCount - Number of files found in directory
 * @returns Either.Left with error if limit exceeded, Either.Right with void if ok
 */
export function enforceFileLimit(fileCount: number): E.Either<FileLimitExceededError, void> {
    if (fileCount > MAX_FILES) {
        console.error(`[FileLimitEnforce] File limit exceeded: ${fileCount} files (max: ${MAX_FILES})`);
        return E.left(createFileLimitExceededError(fileCount, MAX_FILES));
    }

    return E.right(undefined);
}
