import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    Node,
    SyntaxKind,
    ts,
    type FunctionDeclaration,
    type MethodDeclaration,
    type Node as MorphNode,
    type SourceFile,
    type VariableDeclaration,
} from 'ts-morph'
import { discoverPackages, type PackageInfo } from '../discovery/discover-packages'
import { createRepoTsMorphProject } from './repo-ts-morph-project'

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
const DEFAULT_REPO_ROOT: string = resolve(TEST_DIR, '../../../../..')

export async function buildCallGraph(
    repoRoot: string = DEFAULT_REPO_ROOT,
    packages?: readonly PackageInfo[],
): Promise<CallGraph> {
    return createCallGraph(repoRoot, packages ?? await discoverPackages(repoRoot))
}

function createCallGraph(repoRoot: string, packages: readonly PackageInfo[]): CallGraph {
    const project = createRepoTsMorphProject(repoRoot, packages)
    const sourceFiles = project.addSourceFilesAtPaths([
        `${repoRoot}/packages/libraries/**/*.{ts,tsx}`,
        `${repoRoot}/packages/systems/**/*.{ts,tsx}`,
        `${repoRoot}/webapp/src/**/*.{ts,tsx}`,
        `!${repoRoot}/**/*.test.ts`,
        `!${repoRoot}/**/*.test.tsx`,
        `!${repoRoot}/**/*.spec.ts`,
        `!${repoRoot}/**/*.spec.tsx`,
        `!${repoRoot}/**/*.d.ts`,
        `!${repoRoot}/**/__tests__/**`,
        `!${repoRoot}/**/tests/**`,
        `!${repoRoot}/**/__generated__/**`,
        `!${repoRoot}/**/integration-tests/**`,
        `!${repoRoot}/**/node_modules/**`,
        `!${repoRoot}/**/dist/**`,
        `!${repoRoot}/**/build/**`,
        `!${repoRoot}/**/*.config.ts`,
    ]).filter(sourceFile => isProductionSourcePath(sourceFile.getFilePath()))
    if (sourceFiles.length === 0) {
        throw new Error('buildCallGraph found 0 production source files; check for concurrent package moves before changing globs')
    }

    const nodes = new Map<string, FunctionNode>()
    const functionIdsBySyntaxNode = new Map<MorphNode, string>()

    for (const sourceFile of sourceFiles) {
        for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
            addFunctionDeclaration(repoRoot, nodes, functionIdsBySyntaxNode, sourceFile, fn)
        }
        for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
            addMethodDeclaration(repoRoot, nodes, functionIdsBySyntaxNode, sourceFile, method)
        }
        for (const variable of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
            addVariableFunction(repoRoot, nodes, functionIdsBySyntaxNode, sourceFile, variable)
        }
    }

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
    repoRoot: string,
    nodes: Map<string, FunctionNode>,
    functionIdsBySyntaxNode: Map<MorphNode, string>,
    sourceFile: SourceFile,
    fn: FunctionDeclaration,
): void {
    if (!fn.getBody()) return
    const name = fn.getName() ?? 'default'
    const node = createFunctionNode(repoRoot, sourceFile, fn.getNameNode() ?? fn, fn, name, 'function', fn.isExported())
    nodes.set(node.id, node)
    functionIdsBySyntaxNode.set(fn, node.id)
}

function addMethodDeclaration(
    repoRoot: string,
    nodes: Map<string, FunctionNode>,
    functionIdsBySyntaxNode: Map<MorphNode, string>,
    sourceFile: SourceFile,
    method: MethodDeclaration,
): void {
    if (!method.getBody()) return
    const classDecl = method.getParentIfKind(SyntaxKind.ClassDeclaration)
    const name = method.getName()
    const node = createFunctionNode(repoRoot, sourceFile, method.getNameNode(), method, name, 'method', classDecl?.isExported() ?? false)
    nodes.set(node.id, node)
    functionIdsBySyntaxNode.set(method, node.id)
}

function addVariableFunction(
    repoRoot: string,
    nodes: Map<string, FunctionNode>,
    functionIdsBySyntaxNode: Map<MorphNode, string>,
    sourceFile: SourceFile,
    variable: VariableDeclaration,
): void {
    const initializer = variable.getInitializer()
    if (!initializer || (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))) return
    if (!Node.isIdentifier(variable.getNameNode())) return
    const name = variable.getName()
    const variableStatement = variable.getVariableStatement()
    const node = createFunctionNode(
        repoRoot,
        sourceFile,
        variable.getNameNode(),
        initializer,
        name,
        Node.isArrowFunction(initializer) ? 'arrow' : 'function',
        variableStatement?.isExported() ?? false,
    )
    nodes.set(node.id, node)
    functionIdsBySyntaxNode.set(variable, node.id)
    functionIdsBySyntaxNode.set(initializer, node.id)
}

function createFunctionNode(
    repoRoot: string,
    sourceFile: SourceFile,
    locationNode: MorphNode,
    node: MorphNode,
    name: string,
    kind: FunctionNode['kind'],
    isExported: boolean,
): FunctionNode {
    const file = normalizePath(relative(repoRoot, sourceFile.getFilePath()))
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
