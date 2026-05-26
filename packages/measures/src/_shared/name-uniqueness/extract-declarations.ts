// Pure declaration extractor — given a file path + content, returns the
// declarations the name-uniqueness policy cares about: the file's basename
// plus its top-level exports (functions, classes, types, interfaces,
// enums, const/let/var, default exports, and named-export lists like
// `export {a, b as c}`). Re-exports (`export {...} from '...'`) are
// excluded because the names are owned by the source module.
//
// One export by design — see find-violations.ts for the boundary-width
// rationale. The returned shape mirrors the inline DeclaredName shape
// used in find-violations.ts; structural typing keeps them compatible
// without a shared type export.

import {basename} from 'node:path'

type DeclarationKind =
    | 'file'
    | 'export-function'
    | 'export-const'
    | 'export-class'
    | 'export-interface'
    | 'export-type'
    | 'export-enum'
    | 'export-named'

type DeclaredName = {
    readonly name: string
    readonly filePath: string
    readonly kind: DeclarationKind
}

const EXPORT_PATTERNS: readonly {regex: RegExp; kind: DeclarationKind}[] = [
    {regex: /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-function'},
    {regex: /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-class'},
    {regex: /^\s*export\s+interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-interface'},
    {regex: /^\s*export\s+type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[=<]/gm, kind: 'export-type'},
    {regex: /^\s*export\s+enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-enum'},
    {regex: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-const'},
    {regex: /^\s*export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-function'},
    {regex: /^\s*export\s+default\s+(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm, kind: 'export-class'},
]

const NAMED_EXPORT_LIST_REGEX = /^\s*export\s*\{([^}]+)\}\s*(?:from\s*['"][^'"]+['"])?/gm

const FILE_EXT_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/

export function extractDeclarations(filePath: string, content: string): readonly DeclaredName[] {
    const out: DeclaredName[] = []
    out.push({name: basename(filePath).replace(FILE_EXT_PATTERN, ''), filePath, kind: 'file'})

    for (const pattern of EXPORT_PATTERNS) {
        const re = new RegExp(pattern.regex.source, pattern.regex.flags)
        let match: RegExpExecArray | null
        while ((match = re.exec(content)) !== null) {
            out.push({name: match[1], filePath, kind: pattern.kind})
        }
    }

    const listRe = new RegExp(NAMED_EXPORT_LIST_REGEX.source, NAMED_EXPORT_LIST_REGEX.flags)
    let listMatch: RegExpExecArray | null
    while ((listMatch = listRe.exec(content)) !== null) {
        const closeIdx = listMatch[0].lastIndexOf('}')
        if (closeIdx !== -1 && /from\s*['"]/.test(listMatch[0].slice(closeIdx + 1))) continue
        for (const rawSpec of listMatch[1].split(/[,\n]/)) {
            const spec = rawSpec.trim()
            if (spec.length === 0) continue
            const asMatch = /^(?:type\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(spec)
            if (asMatch) {
                out.push({name: asMatch[1], filePath, kind: 'export-named'})
                continue
            }
            const plain = /^(?:type\s+)?([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(spec)
            if (plain) out.push({name: plain[1], filePath, kind: 'export-named'})
        }
    }

    const seen = new Set<string>()
    return out.filter(decl => {
        const key = `${decl.kind}\0${decl.name}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}
