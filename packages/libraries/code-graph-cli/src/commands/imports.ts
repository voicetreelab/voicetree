/**
 * List the import specifiers used by `filePath`, with resolved targets
 * when ts-morph can resolve them.
 *
 * `filePath` is matched against CallGraph.sourceFiles by repo-relative
 * path suffix — agents can pass either an absolute or repo-relative path.
 *
 * Resolved-target detection uses ts-morph's
 * `ImportDeclaration.getModuleSpecifierSourceFile()`, which returns the
 * matched SourceFile when the specifier resolves to a file ts-morph has
 * loaded. For npm packages or files outside the Project, `resolvedFile`
 * is undefined and the agent sees only the raw specifier.
 */
import {relative} from 'node:path'
import type {CallGraph} from '../graph/load-graph.ts'

export type ImportRecord = {
    readonly specifier: string
    readonly resolvedFile: string | undefined
    readonly isTypeOnly: boolean
}

export function imports(
    graph: CallGraph,
    filePath: string,
    repoRoot: string,
): {readonly file: string; readonly imports: readonly ImportRecord[]} {
    const sourceFile = matchSourceFile(graph, filePath)
    if (!sourceFile) {
        throw new Error(
            `File not in graph: ${filePath}\n` +
            `Note: buildCallGraph excludes tests / generated / configs / scripts.`,
        )
    }
    const records: ImportRecord[] = sourceFile.getImportDeclarations().map(decl => {
        const resolved = decl.getModuleSpecifierSourceFile()
        return {
            specifier: decl.getModuleSpecifierValue(),
            resolvedFile: resolved
                ? relative(repoRoot, resolved.getFilePath()).replaceAll('\\', '/')
                : undefined,
            isTypeOnly: decl.isTypeOnly(),
        }
    })
    return {
        file: relative(repoRoot, sourceFile.getFilePath()).replaceAll('\\', '/'),
        imports: records,
    }
}

function matchSourceFile(graph: CallGraph, filePath: string): CallGraph['sourceFiles'][number] | undefined {
    const needle = filePath.replaceAll('\\', '/')
    const exact = graph.sourceFiles.find(sf => sf.getFilePath() === needle)
    if (exact) return exact
    return graph.sourceFiles.find(sf => sf.getFilePath().endsWith(needle))
}
