import {dialog} from 'electron';
import * as E from 'fp-ts/lib/Either.js';

const MAX_FILES: 300 = 300 as const;

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
 * Shows error dialog to user if limit exceeded
 *
 * @param fileCount - Number of files found in directory
 * @returns Either.Left with error if limit exceeded, Either.Right with void if ok
 */
export function enforceFileLimit(fileCount: number): E.Either<FileLimitExceededError, void> {
    if (fileCount > MAX_FILES) {
        console.error(`[FileLimitEnforce] File limit exceeded: ${fileCount} files (max: ${MAX_FILES})`);

        // Show dialog to user (side effect)
        dialog.showErrorBox(
            'Too Many Files',
            `Cannot load directory: found ${fileCount} markdown files.\n\n` +
            `VoiceTree can only handle directories with up to ${MAX_FILES} markdown files.\n\n` +
            `Please select a smaller directory.`
        );

        return E.left(createFileLimitExceededError(fileCount, MAX_FILES));
    }

    return E.right(undefined);
}
