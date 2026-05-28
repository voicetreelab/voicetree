import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    Node,
    Project,
    SyntaxKind,
    ts,
    type FunctionDeclaration,
    type MethodDeclaration,
    type Node as MorphNode,
    type SourceFile,
    type VariableDeclaration,
} from 'ts-morph'

export type FunctionNode = {
    readonly id: string
    readonly name: string
    readonly file: string
    readonly line: number
    readonly kind: 'function' | 'arrow' | 'method'
    readonly isExported: boolean
    readonly loc: number
    readonly folderAncestors: readonly string[]
    readonly __compilerNode: ts.Node
    readonly __sourceFile: SourceFile
}

export type CallGraph = {
    readonly nodes: ReadonlyMap<string, FunctionNode>
    readonly sourceFiles: readonly SourceFile[]
    callees(fnId: string): ReadonlySet<string>
    callers(fnId: string): ReadonlySet<string>
    reachableFrom(fnId: string): ReadonlySet<string>
    reachesAny(fnId: string, predicate: (n: FunctionNode) => boolean): boolean
    nodesInFolder(folder: string): readonly FunctionNode[]
}

const TEST_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_DIR, '../../../../..')

let graphPromise: Promise<CallGraph> | undefined

/**
 * Build a CallGraph.
 *
 * Zero-arg form scans the whole repo and caches the result (module-scope
 * promise). Pass `{sourceFiles, rootDir}` to build a graph over an
 * arbitrary, caller-supplied set of ts-morph SourceFiles — used by tools
 * (the cgcli `loadGraph` path, tests) that need to point the same
 * algorithm at a fixture tree. Custom-input form is uncached and creates
 * a fresh graph each call.
 */
export async function buildCallGraph(
    opts?: {readonly sourceFiles: readonly SourceFile[]; readonly rootDir: string},
): Promise<CallGraph> {
    if (opts) return createCallGraphFromSourceFiles(opts.sourceFiles, opts.rootDir)
    graphPromise ??= Promise.resolve(buildRepoCallGraph())
    return graphPromise
}

function createCallGraphFromSourceFiles(
    sourceFiles: readonly SourceFile[],
    rootDir: string,
): CallGraph {
    const {nodes, functionIdsBySyntaxNode} = collectFunctionNodes(sourceFiles, rootDir)
    const {calleeIdsByFnId, callerIdsByFnId} = collectCallEdges(nodes, functionIdsBySyntaxNode)
    return assembleGraph(nodes, sourceFiles, calleeIdsByFnId, callerIdsByFnId)
}

function buildRepoCallGraph(): CallGraph {
    const project = new Project({
        compilerOptions: {
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            allowJs: false,
            skipLibCheck: true,
            jsx: ts.JsxEmit.Preserve,
        },
    })
    const sourceFiles = project.addSourceFilesAtPaths([
        `${REPO_ROOT}/packages/libraries/**/*.{ts,tsx}`,
        `${REPO_ROOT}/packages/systems/**/*.{ts,tsx}`,
        `${REPO_ROOT}/webapp/src/**/*.{ts,tsx}`,
        `!${REPO_ROOT}/**/*.test.ts`,
        `!${REPO_ROOT}/**/*.test.tsx`,
        `!${REPO_ROOT}/**/*.spec.ts`,
        `!${REPO_ROOT}/**/*.spec.tsx`,
        `!${REPO_ROOT}/**/*.d.ts`,
        `!${REPO_ROOT}/**/__tests__/**`,
        `!${REPO_ROOT}/**/tests/**`,
        `!${REPO_ROOT}/**/__generated__/**`,
        `!${REPO_ROOT}/**/integration-tests/**`,
        `!${REPO_ROOT}/**/node_modules/**`,
        `!${REPO_ROOT}/**/dist/**`,
        `!${REPO_ROOT}/**/build/**`,
        `!${REPO_ROOT}/**/*.config.ts`,
    ]).filter(sourceFile => isProductionSourcePath(sourceFile.getFilePath()))
    if (sourceFiles.length === 0) {
        throw new Error('buildCallGraph found 0 production source files; check for concurrent package moves before changing globs')
    }
    return createCallGraphFromSourceFiles(sourceFiles, REPO_ROOT)
}

function collectFunctionNodes(
    sourceFiles: readonly SourceFile[],
    rootDir: string,
): {nodes: Map<string, FunctionNode>; functionIdsBySyntaxNode: Map<MorphNode, string>} {
    const nodes = new Map<string, FunctionNode>()
    const functionIdsBySyntaxNode = new Map<MorphNode, string>()
    for (const sourceFile of sourceFiles) {
        for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
            addFunctionDeclaration(nodes, functionIdsBySyntaxNode, sourceFile, fn, rootDir)
        }
        for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
            addMethodDeclaration(nodes, functionIdsBySyntaxNode, sourceFile, method, rootDir)
        }
        for (const variable of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
            addVariableFunction(nodes, functionIdsBySyntaxNode, sourceFile, variable, rootDir)
        }
    }
    return {nodes, functionIdsBySyntaxNode}
}

function collectCallEdges(
    nodes: ReadonlyMap<string, FunctionNode>,
    functionIdsBySyntaxNode: ReadonlyMap<MorphNode, string>,
): {calleeIdsByFnId: Map<string, Set<string>>; callerIdsByFnId: Map<string, Set<string>>} {
    const calleeIdsByFnId = new Map<string, Set<string>>()
    const callerIdsByFnId = new Map<string, Set<string>>()
    for (const id of nodes.keys()) {
        calleeIdsByFnId.set(id, new Set())
        callerIdsByFnId.set(id, new Set())
    }
    for (const [syntaxNode, callerId] of functionIdsBySyntaxNode.entries()) {
        if (Node.isVariableDeclaration(syntaxNode)) continue
        for (const call of syntaxNode.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            if (findEnclosingFunctionId(call, functionIdsBySyntaxNode) !== callerId) continue
            const calleeId = resolveCalleeId(call.getExpression(), functionIdsBySyntaxNode)
            if (!calleeId || calleeId === callerId) continue
            calleeIdsByFnId.get(callerId)?.add(calleeId)
            callerIdsByFnId.get(calleeId)?.add(callerId)
        }
    }
    return {calleeIdsByFnId, callerIdsByFnId}
}

function assembleGraph(
    nodes: ReadonlyMap<string, FunctionNode>,
    sourceFiles: readonly SourceFile[],
    calleeIdsByFnId: ReadonlyMap<string, ReadonlySet<string>>,
    callerIdsByFnId: ReadonlyMap<string, ReadonlySet<string>>,
): CallGraph {
    const reachableMemo = new Map<string, ReadonlySet<string>>()
    const graph: CallGraph = {
        nodes,
        sourceFiles,
        callees: (fnId: string): ReadonlySet<string> => calleeIdsByFnId.get(fnId) ?? new Set<string>(),
        callers: (fnId: string): ReadonlySet<string> => callerIdsByFnId.get(fnId) ?? new Set<string>(),
        reachableFrom: (fnId: string): ReadonlySet<string> => {
            const cached = reachableMemo.get(fnId)
            if (cached) return cached
            const reachable = collectReachable(fnId, calleeIdsByFnId)
            reachable.delete(fnId)
            reachableMemo.set(fnId, reachable)
            return reachable
        },
        reachesAny: (fnId: string, predicate: (n: FunctionNode) => boolean): boolean => {
            for (const reachableId of graph.reachableFrom(fnId)) {
                const node = nodes.get(reachableId)
                if (node && predicate(node)) return true
            }
            return false
        },
        nodesInFolder: (folder: string): readonly FunctionNode[] => {
            const normalizedFolder = normalizePath(folder).replace(/\/$/, '')
            return [...nodes.values()].filter(node =>
                normalizedFolder === ''
                || node.folderAncestors.includes(normalizedFolder))
        },
    }
    return graph
}

function isProductionSourcePath(path: string): boolean {
    const normalized = normalizePath(path)
    return !normalized.endsWith('.d.ts')
        && !normalized.endsWith('.test.ts')
        && !normalized.endsWith('.test.tsx')
        && !normalized.endsWith('.spec.ts')
        && !normalized.endsWith('.spec.tsx')
        && !normalized.endsWith('.config.ts')
        && !normalized.includes('/__tests__/')
        && !normalized.includes('/__generated__/')
        && !normalized.includes('/integration-tests/')
        && !normalized.includes('/node_modules/')
        && !normalized.includes('/dist/')
        && !normalized.includes('/build/')
        // Package scripts and bin entrypoints are shell/edge code. The call graph
        // is used by purity/coupling metrics that should measure core source.
        && !normalized.includes('/scripts/')
        && !normalized.includes('/bin/')
        && !normalized.includes('/tests/')
}

function addFunctionDeclaration(
    nodes: Map<string, FunctionNode>,
    functionIdsBySyntaxNode: Map<MorphNode, string>,
    sourceFile: SourceFile,
    fn: FunctionDeclaration,
    rootDir: string,
): void {
    if (!fn.getBody()) return
    const name = fn.getName() ?? 'default'
    const node = createFunctionNode(sourceFile, fn.getNameNode() ?? fn, fn, name, 'function', fn.isExported(), rootDir)
    nodes.set(node.id, node)
    functionIdsBySyntaxNode.set(fn, node.id)
}

function addMethodDeclaration(
    nodes: Map<string, FunctionNode>,
    functionIdsBySyntaxNode: Map<MorphNode, string>,
    sourceFile: SourceFile,
    method: MethodDeclaration,
    rootDir: string,
): void {
    if (!method.getBody()) return
    const classDecl = method.getParentIfKind(SyntaxKind.ClassDeclaration)
    const name = method.getName()
    const node = createFunctionNode(sourceFile, method.getNameNode(), method, name, 'method', classDecl?.isExported() ?? false, rootDir)
    nodes.set(node.id, node)
    functionIdsBySyntaxNode.set(method, node.id)
}

function addVariableFunction(
    nodes: Map<string, FunctionNode>,
    functionIdsBySyntaxNode: Map<MorphNode, string>,
    sourceFile: SourceFile,
    variable: VariableDeclaration,
    rootDir: string,
): void {
    const initializer = variable.getInitializer()
    if (!initializer || (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))) return
    if (!Node.isIdentifier(variable.getNameNode())) return
    const name = variable.getName()
    const variableStatement = variable.getVariableStatement()
    const node = createFunctionNode(
        sourceFile,
        variable.getNameNode(),
        initializer,
        name,
        Node.isArrowFunction(initializer) ? 'arrow' : 'function',
        variableStatement?.isExported() ?? false,
        rootDir,
    )
    nodes.set(node.id, node)
    functionIdsBySyntaxNode.set(variable, node.id)
    functionIdsBySyntaxNode.set(initializer, node.id)
}

function createFunctionNode(
    sourceFile: SourceFile,
    locationNode: MorphNode,
    node: MorphNode,
    name: string,
    kind: FunctionNode['kind'],
    isExported: boolean,
    rootDir: string,
): FunctionNode {
    const file = normalizePath(relative(rootDir, sourceFile.getFilePath()))
    const line = sourceFile.getLineAndColumnAtPos(locationNode.getStart()).line
    return {
        id: `${file}:${line}:${name}`,
        name,
        file,
        line,
        kind,
        isExported,
        loc: node.getEndLineNumber() - node.getStartLineNumber() + 1,
        folderAncestors: folderAncestors(file),
        __compilerNode: node.compilerNode,
        __sourceFile: sourceFile,
    }
}

function folderAncestors(file: string): readonly string[] {
    const folders: string[] = []
    let current = dirname(file)
    while (current !== '.' && current !== '') {
        folders.push(normalizePath(current))
        const parent = dirname(current)
        if (parent === current) break
        current = parent
    }
    return folders
}

function resolveCalleeId(
    expression: MorphNode,
    functionIdsBySyntaxNode: ReadonlyMap<MorphNode, string>,
): string | undefined {
    const symbol = expression.getSymbol()
    const resolved = symbol?.getAliasedSymbol() ?? symbol
    const declaration = resolved?.getValueDeclaration() ?? resolved?.getDeclarations()[0]
    if (!declaration) return undefined
    return findFunctionIdForDeclaration(declaration, functionIdsBySyntaxNode)
}

function findFunctionIdForDeclaration(
    declaration: MorphNode,
    functionIdsBySyntaxNode: ReadonlyMap<MorphNode, string>,
): string | undefined {
    let current: MorphNode | undefined = declaration
    while (current) {
        const id = functionIdsBySyntaxNode.get(current)
        if (id) return id
        current = current.getParent()
    }
    return undefined
}

function findEnclosingFunctionId(
    node: MorphNode,
    functionIdsBySyntaxNode: ReadonlyMap<MorphNode, string>,
): string | undefined {
    let current: MorphNode | undefined = node
    while (current) {
        const id = functionIdsBySyntaxNode.get(current)
        if (id) return id
        current = current.getParent()
    }
    return undefined
}

function collectReachable(fnId: string, calleeIdsByFnId: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
    const visited = new Set<string>()
    const visit = (current: string): void => {
        for (const callee of calleeIdsByFnId.get(current) ?? []) {
            if (visited.has(callee)) continue
            visited.add(callee)
            visit(callee)
        }
    }
    visit(fnId)
    return visited
}

function normalizePath(path: string): string {
    return path.replaceAll('\\', '/')
}
