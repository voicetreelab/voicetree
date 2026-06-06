// Single-source-of-truth policy for agent identity.
//
// An agent has exactly ONE stored identity: its terminal id (`terminalId`,
// e.g. `Zoe-iyi`). The human-friendly *name* (`Zoe`) is a PURE FUNCTION of that
// id (`agentBaseName`) — it must never be stored as its own field, because a
// second stored copy is a source of truth that can silently drift from the id.
//
// This deep function is the pure policy core: given source files, it returns one
// violation per object type that stores BOTH a `terminalId` and an `agentName`
// field — i.e. every place the dual source of truth currently exists. The
// measures test runs it across the repo and asserts the list is empty.

export type SourceFile = {
    readonly filePath: string
    readonly content: string
}

export type IdentitySourceOfTruthViolation = {
    readonly filePath: string
    readonly typeName: string
}

const ID_FIELD: RegExp = /(?:^|\n)\s*readonly\s+terminalId\b|(?:^|\n)\s*terminalId\s*[?:]/
const NAME_FIELD: RegExp = /(?:^|\n)\s*readonly\s+agentName\b|(?:^|\n)\s*agentName\s*[?:]/

// Forward-scan cap for an interface's body brace, which always follows its
// name (after an optional `extends` clause) within a few chars.
const MAX_PRE_BRACE_GAP = 300

/** Slice the `{...}` block starting at `openIndex`, honouring nested braces. */
function sliceBraceBlock(content: string, openIndex: number): string | null {
    let depth = 0
    for (let i = openIndex; i < content.length; i++) {
        const ch: string = content[i]
        if (ch === '{') depth++
        else if (ch === '}') {
            depth--
            if (depth === 0) return content.slice(openIndex, i + 1)
        }
    }
    return null
}

/**
 * Object-type bodies keyed by type name. Two precise shapes only:
 *   - `interface X … { … }` (interfaces always have a body brace)
 *   - `type X = { … }` (a DIRECT object literal — not a union/mapped/fn alias)
 * Braceless `type X = 'a' | 'b'` aliases are intentionally excluded, so they
 * can never borrow a neighbouring declaration's brace.
 */
function objectTypeBlocks(content: string): readonly {readonly name: string; readonly body: string}[] {
    const out: {name: string; body: string}[] = []

    const ifaceRe: RegExp = /\binterface\s+([A-Za-z_$][\w$]*)/g
    let match: RegExpExecArray | null
    while ((match = ifaceRe.exec(content)) !== null) {
        let i: number = ifaceRe.lastIndex
        const limit: number = Math.min(content.length, i + MAX_PRE_BRACE_GAP)
        while (i < limit && content[i] !== '{') i++
        if (i >= limit || content[i] !== '{') continue
        const body: string | null = sliceBraceBlock(content, i)
        if (body !== null) out.push({name: match[1], body})
    }

    const typeRe: RegExp = /\btype\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=\s*\{/g
    while ((match = typeRe.exec(content)) !== null) {
        const openIndex: number = typeRe.lastIndex - 1 // the matched `{`
        const body: string | null = sliceBraceBlock(content, openIndex)
        if (body !== null) out.push({name: match[1], body})
    }

    return out
}

/**
 * Every object type that stores an agent name alongside the terminal id — the
 * dual source of truth this policy forbids.
 */
export function findIdentitySourceOfTruthViolations(
    files: readonly SourceFile[],
): readonly IdentitySourceOfTruthViolation[] {
    const violations: IdentitySourceOfTruthViolation[] = []
    for (const file of files) {
        for (const block of objectTypeBlocks(file.content)) {
            if (ID_FIELD.test(block.body) && NAME_FIELD.test(block.body)) {
                violations.push({filePath: file.filePath, typeName: block.name})
            }
        }
    }
    return violations
}
