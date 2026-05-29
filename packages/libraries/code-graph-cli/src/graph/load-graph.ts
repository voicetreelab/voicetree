/**
 * Load a CallGraph for the CLI.
 *
 * Two modes:
 *   - "repo":  whole-repo graph via @vt/measures' cached buildCallGraph.
 *              Excludes tests / generated / scripts / configs by design.
 *   - "paths": build a fresh ts-morph Project over the supplied globs and
 *              build the graph from those source files. Used by tests
 *              against a fixture tree so the unit suite doesn't pull in
 *              the whole repo.
 *
 * Both modes route through `createCallGraphFromSourceFiles` so the algorithm
 * lives in exactly one place.
 */
import {Project, ts} from 'ts-morph'
import {buildCallGraph, type CallGraph} from '@vt/measures/graph/call-graph'

export type LoadGraphOptions =
    | {readonly mode: 'repo'}
    | {readonly mode: 'paths'; readonly globs: readonly string[]; readonly rootDir: string}

export async function loadGraph(opts: LoadGraphOptions = {mode: 'repo'}): Promise<CallGraph> {
    if (opts.mode === 'repo') return buildCallGraph()
    return buildFromPaths(opts.globs, opts.rootDir)
}

async function buildFromPaths(globs: readonly string[], rootDir: string): Promise<CallGraph> {
    const project = new Project({
        compilerOptions: {
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            allowJs: false,
            skipLibCheck: true,
        },
    })
    const sourceFiles = project.addSourceFilesAtPaths([...globs])
    if (sourceFiles.length === 0) {
        throw new Error(`loadGraph found 0 source files for globs: ${globs.join(', ')}`)
    }
    return buildCallGraph({sourceFiles, rootDir})
}

export type {CallGraph, FunctionNode} from '@vt/measures/graph/call-graph'
