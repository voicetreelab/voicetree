// Pure scope extractor: given a single source file's current content and
// (optionally) the previous version, returns only the declarations that
// were INTRODUCED by the current change. New files contribute every
// declaration. Modified files contribute only declarations whose
// (kind, name) didn't already exist in the previous content. The file's
// basename declaration is included only when the file is new (a rename
// is handled by the runner edge passing `previousContent: null`).
//
// One export by design. The returned shape is the same DeclaredName
// structural shape `find-violations.ts` consumes — no cross-file type
// export needed.

import {extractDeclarations} from './extract-declarations.ts'

type DeclarationKind =
    | 'file' | 'export-function' | 'export-const' | 'export-class'
    | 'export-interface' | 'export-type' | 'export-enum' | 'export-named'

type DeclaredName = {
    readonly name: string
    readonly filePath: string
    readonly kind: DeclarationKind
}

export function extractScopeDeclarations(file: {
    readonly filePath: string
    readonly content: string
    readonly previousContent: string | null
}): readonly DeclaredName[] {
    const current = extractDeclarations(file.filePath, file.content)
    if (file.previousContent === null) return current
    const previousKeys = new Set(
        extractDeclarations(file.filePath, file.previousContent).map(d => `${d.kind}\0${d.name}`),
    )
    return current.filter(d => !previousKeys.has(`${d.kind}\0${d.name}`))
}
