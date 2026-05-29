import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
    Node,
    SyntaxKind,
    type FunctionDeclaration,
    type FunctionExpression,
    type Identifier,
    type MethodDeclaration,
    type Node as MorphNode,
    type SourceFile,
    type VariableDeclaration,
} from 'ts-morph'
import {discoverPackages} from '../../_shared/discovery/discover-packages'
import { buildCallGraph, type CallGraph } from '../../_shared/graph/call-graph'
import { recordHealthMetric } from '../../_shared/writers/report-writer'

const TEST_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_DIR, '../../../../..')
// Fixed shell allowance plus one transitive-impure function per N pure package
// functions. New impurity spends budget twice: it increments the impure count
// and removes one function from the pure-code allowance.
const TRANSITIVE_IMPURE_FUNCTIONS_BASE_BUDGET = 90
const PURE_FUNCTIONS_PER_TRANSITIVE_IMPURE_ALLOWANCE = 8
const IMPURE_RATIO_BUDGET = 1
const IMPURE_MODULES: ReadonlySet<string> = new Set([
    'fs',
    'fs/promises',
    'node:fs',
    'node:fs/promises',
    'http',
    'https',
    'node:http',
    'node:https',
    'node:net',
    'node:dgram',
    'node:tls',
    'node:child_process',
    'child_process',
    'axios',
    'node-fetch',
    'undici',
])
const IMPURE_GLOBALS: ReadonlySet<string> = new Set(['fetch', 'XMLHttpRequest'])

type FunctionSyntax = FunctionDeclaration | MethodDeclaration | FunctionExpression | MorphNode

describe('transitive impurity (ts-morph call graph)', () => {
    it('transitive impurity functions stay under budget', async () => {
        const started = performance.now()
        const packages = await discoverPackages(REPO_ROOT)
        const graph = await buildCallGraph(REPO_ROOT, packages)
        const buildMs = Math.round(performance.now() - started)
        const directIds = collectDirectlyImpureFunctionIds(graph)
        const scopedNodeIds = [...graph.nodes.keys()].filter(id => id.startsWith('packages/'))
        const transitiveIds = scopedNodeIds
            .filter(id => directIds.has(id) || graph.reachesAny(id, node => directIds.has(node.id)))
        const pureFunctionCount = scopedNodeIds.length - transitiveIds.length
        const transitiveImpureFunctionsBudget =
            TRANSITIVE_IMPURE_FUNCTIONS_BASE_BUDGET
            + Math.ceil(pureFunctionCount / PURE_FUNCTIONS_PER_TRANSITIVE_IMPURE_ALLOWANCE)
        const maxFolderRatio = maxImpureFolderRatio(graph, new Set(transitiveIds))
        const directTransitiveCount = transitiveIds.filter(id => directIds.has(id)).length

        console.info(`buildCallGraph first call: ${buildMs}ms`)
        console.info(`TS transitive impurity: ${transitiveIds.length} functions; budget=${transitiveImpureFunctionsBudget}, pure=${pureFunctionCount}, direct=${directTransitiveCount}, transitive=${transitiveIds.length - directTransitiveCount}`)
        console.info(`TS transitive impurity top roots: ${topRoots(graph, transitiveIds).join(', ')}`)

        await recordHealthMetric({
            metricId: 'transitive-impurity-functions-ts-canary',
            metricName: 'TS Canary Transitive Impurity Functions',
            description: 'ts-morph call-graph count of functions that directly or transitively reach filesystem, network, or process sinks.',
            category: 'Purity',
            current: transitiveIds.length,
            budget: transitiveImpureFunctionsBudget,
            comparison: 'lte',
            unit: 'functions',
            details: {
                directFunctions: directTransitiveCount,
                transitiveOnlyFunctions: transitiveIds.length - directTransitiveCount,
                totalPackageFunctions: scopedNodeIds.length,
                pureFunctionCount,
                baseBudget: TRANSITIVE_IMPURE_FUNCTIONS_BASE_BUDGET,
                pureFunctionsPerAllowance: PURE_FUNCTIONS_PER_TRANSITIVE_IMPURE_ALLOWANCE,
                buildMs,
                scope: 'packages/',
                sampleFunctionIds: transitiveIds.slice(0, 25),
            },
        })
        await recordHealthMetric({
            metricId: 'transitive-impurity-ratio-ts-canary',
            metricName: 'TS Canary Transitive Impurity Folder Ratio',
            description: 'Maximum folder impurity ratio among folders with at least four functions, using the ts-morph call graph.',
            category: 'Purity',
            current: maxFolderRatio,
            budget: IMPURE_RATIO_BUDGET,
            comparison: 'lte',
            unit: 'ratio',
            details: {
                minimumFolderFunctions: 4,
            },
        })

        // recordHealthMetric only journals the result; enforcement happens here.
        const topTsCandidates = transitiveIds.slice(0, 10).map(id => graph.nodes.get(id)?.name ?? id)
        expect(
            transitiveIds.length,
            `Transitive impurity count ${transitiveIds.length} exceeds budget ${transitiveImpureFunctionsBudget}. Pure functions: ${pureFunctionCount}. Top candidates: ${topTsCandidates.join(', ')}`,
        ).toBeLessThanOrEqual(transitiveImpureFunctionsBudget)
    }, 120000)
})

function collectDirectlyImpureFunctionIds(graph: CallGraph): ReadonlySet<string> {
    // Reuse the call-graph's existing ts-morph Project. Building a second one
    // here roughly doubled the test's heap (~900 MB → ~1.8 GB) and was the
    // cause of the tier-1-health OOM that drove the captureCi heap bumps.
    const sourceFiles = graph.sourceFiles
    const functionNodes = new Map<string, FunctionSyntax>()
    for (const sourceFile of sourceFiles) {
        for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
            if (fn.getBody()) functionNodes.set(functionId(sourceFile, fn.getNameNode() ?? fn, fn.getName() ?? 'default'), fn)
        }
        for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
            if (method.getBody()) functionNodes.set(functionId(sourceFile, method.getNameNode(), method.getName()), method)
        }
        for (const variable of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
            addVariableFunctionSyntax(functionNodes, sourceFile, variable)
        }
    }
    const directIds = new Set<string>()
    for (const [id, node] of functionNodes.entries()) {
        if (graph.nodes.has(id) && containsDirectImpureSink(node)) directIds.add(id)
    }
    return directIds
}

function addVariableFunctionSyntax(
    functionNodes: Map<string, FunctionSyntax>,
    sourceFile: SourceFile,
    variable: VariableDeclaration,
): void {
    const initializer = variable.getInitializer()
    if (!initializer || (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))) return
    if (!Node.isIdentifier(variable.getNameNode())) return
    functionNodes.set(functionId(sourceFile, variable.getNameNode(), variable.getName()), initializer)
}

function containsDirectImpureSink(fn: FunctionSyntax): boolean {
    const impureBindingDeclarations = collectImpureBindingDeclarations(fn.getSourceFile())
    let found = false
    fn.forEachDescendant((descendant, traversal) => {
        if (found) {
            traversal.stop()
            return
        }
        if (isFunctionBoundary(descendant)) {
            traversal.skip()
            return
        }
        if (Node.isCallExpression(descendant) && isImpureRequireOrImport(descendant)) {
            found = true
            traversal.stop()
            return
        }
        if (Node.isPropertyAccessExpression(descendant)) {
            if (isImpureProcessPropertyRead(descendant) || isImpureModulePropertyRead(descendant, impureBindingDeclarations)) {
                found = true
                traversal.stop()
            }
            return
        }
        if (Node.isIdentifier(descendant)) {
            if (isImpureImportedBinding(descendant, impureBindingDeclarations) || isImpureGlobalReference(descendant)) {
                found = true
                traversal.stop()
            }
        }
    })
    return found
}

function collectImpureBindingDeclarations(sourceFile: SourceFile): ReadonlySet<MorphNode> {
    const declarations = new Set<MorphNode>()
    for (const importDecl of sourceFile.getImportDeclarations()) {
        if (!IMPURE_MODULES.has(importDecl.getModuleSpecifierValue())) continue
        const namespaceImport = importDecl.getImportClause()?.getNamedBindings()
        if (namespaceImport && Node.isNamespaceImport(namespaceImport)) {
            declarations.add(namespaceImport)
            declarations.add(namespaceImport.getNameNode())
        }
    }
    for (const variable of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        if (!isImpureRequireInitializer(variable.getInitializer())) continue
        const nameNode = variable.getNameNode()
        if (Node.isIdentifier(nameNode)) {
            declarations.add(variable)
            declarations.add(nameNode)
        }
        if (Node.isObjectBindingPattern(nameNode)) {
            for (const element of nameNode.getElements()) {
                const bindingName = element.getNameNode()
                if (Node.isIdentifier(bindingName)) {
                    declarations.add(element)
                    declarations.add(bindingName)
                }
            }
        }
    }
    return declarations
}

function isImpureModulePropertyRead(
    node: MorphNode,
    impureBindingDeclarations: ReadonlySet<MorphNode>,
): boolean {
    if (!Node.isPropertyAccessExpression(node)) return false
    const expression = node.getExpression()
    return Node.isIdentifier(expression) && isImpureImportedBinding(expression, impureBindingDeclarations)
}

function isImpureImportedBinding(
    identifier: Identifier,
    impureBindingDeclarations: ReadonlySet<MorphNode>,
): boolean {
    const declarations = identifier.getSymbol()?.getDeclarations() ?? []
    return declarations.some(declaration => impureBindingDeclarations.has(declaration))
}

function isImpureGlobalReference(identifier: Identifier): boolean {
    if (!IMPURE_GLOBALS.has(identifier.getText())) return false
    return isGlobalReference(identifier)
}

function isImpureProcessPropertyRead(node: MorphNode): boolean {
    if (!Node.isPropertyAccessExpression(node)) return false
    const chain = propertyChain(node)
    if (chain[0] === 'process' && chain.length > 1) {
        const root = leftmostIdentifier(node)
        return root ? isGlobalReference(root) : true
    }
    if (chain[0] === 'globalThis' && chain[1] === 'process' && chain.length > 2) {
        return true
    }
    return false
}

function isImpureRequireOrImport(node: MorphNode): boolean {
    if (!Node.isCallExpression(node)) return false
    if (isImpureRequireInitializer(node)) return true
    const expression = node.getExpression()
    if (expression.getKind() !== SyntaxKind.ImportKeyword) return false
    const moduleName = node.getArguments()[0]
    return Node.isStringLiteral(moduleName) && IMPURE_MODULES.has(moduleName.getLiteralText())
}

function isImpureRequireInitializer(node: MorphNode | undefined): boolean {
    if (!node || !Node.isCallExpression(node)) return false
    const expression = node.getExpression()
    if (!Node.isIdentifier(expression) || expression.getText() !== 'require') return false
    const moduleName = node.getArguments()[0]
    return Node.isStringLiteral(moduleName) && IMPURE_MODULES.has(moduleName.getLiteralText())
}

function isGlobalReference(identifier: Identifier): boolean {
    const declarations = identifier.getSymbol()?.getDeclarations() ?? []
    if (declarations.length === 0) return true
    return declarations.every(declaration => declaration.getSourceFile().isFromExternalLibrary() || declaration.getSourceFile().isDeclarationFile())
}

function isFunctionBoundary(node: MorphNode): boolean {
    return Node.isFunctionDeclaration(node)
        || Node.isMethodDeclaration(node)
        || Node.isArrowFunction(node)
        || Node.isFunctionExpression(node)
}

function propertyChain(node: MorphNode): readonly string[] {
    if (Node.isIdentifier(node)) return [node.getText()]
    if (!Node.isPropertyAccessExpression(node)) return []
    return [...propertyChain(node.getExpression()), node.getName()]
}

function leftmostIdentifier(node: MorphNode): Identifier | undefined {
    if (Node.isIdentifier(node)) return node
    if (Node.isPropertyAccessExpression(node)) return leftmostIdentifier(node.getExpression())
    return undefined
}

function maxImpureFolderRatio(graph: CallGraph, impureIds: ReadonlySet<string>): number {
    const folders = new Map<string, { impure: number; total: number }>()
    for (const node of graph.nodes.values()) {
        for (const folder of node.folderAncestors) {
            const current = folders.get(folder) ?? { impure: 0, total: 0 }
            folders.set(folder, {
                impure: current.impure + (impureIds.has(node.id) ? 1 : 0),
                total: current.total + 1,
            })
        }
    }
    return Math.max(0, ...[...folders.values()]
        .filter(folder => folder.total >= 4)
        .map(folder => folder.impure / folder.total))
}

function topRoots(graph: CallGraph, ids: readonly string[]): readonly string[] {
    const counts = new Map<string, number>()
    for (const id of ids) {
        const node = graph.nodes.get(id)
        if (!node) continue
        const root = node.file.split('/').slice(0, 3).join('/')
        counts.set(root, (counts.get(root) ?? 0) + 1)
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([root, count]) => `${root}=${count}`)
}

function functionId(sourceFile: SourceFile, node: MorphNode, name: string): string {
    const file = relative(REPO_ROOT, sourceFile.getFilePath()).replaceAll('\\', '/')
    const line = sourceFile.getLineAndColumnAtPos(node.getStart()).line
    return `${file}:${line}:${name}`
}
