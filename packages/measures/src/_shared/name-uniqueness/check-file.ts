// Deep-function public API for the name-uniqueness measure.
//
// Cross-community consumers (e.g. the tier-0 post-edit hook) should
// depend on this file only — never on the underlying extract/build/find
// trio directly. Inside the module those three are still independently
// testable; the deep function just composes them into the single
// operation production code actually wants:
//
//   "Given this file's content (and what it was at HEAD), tell me the
//    name-collision violations it introduces."

import {buildNameUniquenessContext} from './build-context.ts'
import {extractScopeDeclarations} from './extract-scope.ts'
import {findNameUniquenessViolations} from './find-violations.ts'

// Consumers that need to name the per-violation shape derive it via
// `Awaited<ReturnType<typeof checkFileForNameCollisions>>[number]` rather
// than importing a separate type alias — keeps the boundary-width of the
// _shared community to one symbol for this entry point.

export async function checkFileForNameCollisions(args: {
    readonly filePath: string
    readonly content: string
    readonly previousContent: string | null
    readonly cacheKey: string | null
}): Promise<readonly NameUniquenessViolation[]> {
    const scope = extractScopeDeclarations({
        filePath: args.filePath,
        content: args.content,
        previousContent: args.previousContent,
    })
    if (scope.length === 0) return []
    const context = await buildNameUniquenessContext({cacheKey: args.cacheKey})
    return findNameUniquenessViolations({
        scope,
        index: context.index,
        allowlist: context.allowlist,
        importGraph: context.importGraph,
    })
}
