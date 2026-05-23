/**
 * Pure transform: raw `vt` argv → privacy-redacted structural shape string for
 * telemetry. The verb identity is provided separately (canonicalised by the
 * dispatcher); this function emits a string that preserves which flags were
 * passed without leaking any positional or flag values.
 *
 * Rules:
 *   - Verb prefix (when not "(none)"/"(unknown)") is emitted literally.
 *   - The first `verbTokensInArgv` non-flag tokens in argv are treated as
 *     consumed by the verb prefix and dropped.
 *   - Any remaining positional token → `<arg>`. This includes tokens that
 *     start with `-` but are not recognised flag shapes (e.g. `-1`, `-secret`).
 *   - `--name=value` → `--name=<redacted>` (preserves flag identity, drops value).
 *   - Bare flag (`--json`, `--from-stdin`, `-h`, ...) → unchanged.
 *   - `--name <value>` (space-separated) is emitted as two tokens: the flag
 *     unchanged followed by `<arg>` (we don't know which flags take values).
 *   - `--` (end-of-options sentinel) is emitted literally; all tokens after it
 *     are positionals regardless of leading character.
 *
 * Output is deterministic and free of user content — safe to ship as telemetry.
 */

export interface ArgsShapeInput {
    readonly verb: string
    readonly verbTokensInArgv: number
    readonly argv: readonly string[]
}

export function argsShape(input: ArgsShapeInput): string {
    const tokens: string[] = []
    if (input.verb !== '(none)' && input.verb !== '(unknown)') {
        tokens.push(input.verb)
    }
    let positionalsConsumed: number = 0
    let pastDoubleDash: boolean = false
    for (const cur of input.argv) {
        if (pastDoubleDash) {
            tokens.push('<arg>')
            continue
        }
        if (cur === '--') {
            pastDoubleDash = true
            tokens.push('--')
            continue
        }
        if (isFlagToken(cur)) {
            tokens.push(shapeFlag(cur))
            continue
        }
        if (positionalsConsumed < input.verbTokensInArgv) {
            positionalsConsumed += 1
            continue
        }
        tokens.push('<arg>')
    }
    return tokens.join(' ')
}

/**
 * A token is a flag if it is a long flag (starts with `--`) or a single-letter
 * short flag (`-X` or `-X=value` where X is one alphabetic character).
 *
 * Tokens like `-1` (negative numeric) or `-secret-query` (multi-char) are NOT
 * recognised as flags and are therefore treated as positionals to be redacted.
 */
function isFlagToken(token: string): boolean {
    if (token.startsWith('--')) return true
    return (
        token.length >= 2 &&
        token[0] === '-' &&
        /[a-zA-Z]/.test(token[1]) &&
        (token.length === 2 || token[2] === '=')
    )
}

function shapeFlag(token: string): string {
    const eqIndex: number = token.indexOf('=')
    if (eqIndex <= 0) return token
    return `${token.slice(0, eqIndex)}=<redacted>`
}
