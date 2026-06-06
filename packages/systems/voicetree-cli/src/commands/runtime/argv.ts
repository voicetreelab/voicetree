import {error} from '../output'

/**
 * Read the value that follows a flag at `argv[index]`, treating a missing value
 * or a value that itself looks like a flag (`--…`) as a usage error. The
 * `usage` text is appended to the error so each command surfaces its own help.
 *
 * Shared by the `vt serve` / `vt webapp` arg parsers, which previously each
 * carried an identical copy of this guard.
 */
export function readRequiredFlagValue(
    argv: readonly string[],
    index: number,
    flag: string,
    usage: string,
): string {
    const value: string | undefined = argv[index + 1]
    if (!value || value.startsWith('--')) {
        error(`${flag} requires a value\n\n${usage}`)
    }
    return value
}
