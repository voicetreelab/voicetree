import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {recordHealthMetric} from './_health-report-test-helpers'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const SYSTEMS_ROOT: string = TEST_FILE_DIR
const REPO_ROOT: string = resolve(SYSTEMS_ROOT, '../..')

const SCANNED_PACKAGE_NAMES: readonly string[] = [
    'graph-db-server',
    'agent-runtime',
    'voicetree-mcp',
] as const
const MODULE_MUTABLE_STATE_BASELINE = 43
const GRAPH_DB_SERVER_IMPORT_PATTERN = /^@vt\/graph-db-server(?:\/.*)?$/
const GRAPH_DB_SERVER_CONSUMER_SOURCE_ROOTS: readonly string[] = [
    join(REPO_ROOT, 'webapp/src'),
    join(SYSTEMS_ROOT, 'agent-runtime/src'),
    join(SYSTEMS_ROOT, 'voicetree-mcp/src'),
] as const
const ALLOWED_GRAPH_DB_SERVER_IMPORT_FILES: readonly string[] = [
    'webapp/src/shell/edge/main/cli/commands/serve.ts',
    'webapp/src/shell/edge/main/cli/commands/daemonRouteParity.ts',
    'webapp/src/shell/edge/main/cli/commands/graph-search.ts',
    'webapp/src/shell/edge/main/cli/commands/graph/index-cmds.ts',
    'webapp/src/shell/edge/main/cli/commands/graph/types.ts',
] as const

type MutableStateViolation = {
    file: string
    line: number
    declaration: string
}

type GraphDbServerImportViolation = {
    file: string
    line: number
    importPath: string
    kind: string
    snippet: string
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

function isProductionTypeScriptSource(path: string): boolean {
    return path.endsWith('.ts')
        && !path.endsWith('.test.ts')
        && !path.endsWith('.spec.ts')
        && !path.includes('/__tests__/')
}

async function listProductionSources(root: string): Promise<string[]> {
    if (!(await pathExists(root))) return []
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) {
            return listProductionSources(path)
        }
        if (entry.isFile() && isProductionTypeScriptSource(path)) {
            return [path]
        }
        return []
    }))
    return nested.flat()
}

function repoRelativePath(path: string): string {
    return relative(REPO_ROOT, path).replaceAll('\\', '/')
}

function isAllowedGraphDbServerImportFile(file: string): boolean {
    const relFile = repoRelativePath(file)
    return ALLOWED_GRAPH_DB_SERVER_IMPORT_FILES.includes(relFile)
}

function isLetDeclarationList(node: ts.VariableDeclarationList): boolean {
    return (node.flags & ts.NodeFlags.Let) !== 0
}

function isConstDeclarationList(node: ts.VariableDeclarationList): boolean {
    return (node.flags & ts.NodeFlags.Const) !== 0
}

function isMapOrSetConstructor(expression: ts.Expression): boolean {
    return ts.isNewExpression(expression)
        && ts.isIdentifier(expression.expression)
        && (expression.expression.text === 'Map' || expression.expression.text === 'Set')
}

function isMutableContainerInitializer(expression: ts.Expression | undefined): boolean {
    if (!expression) return false
    return ts.isArrayLiteralExpression(expression) || isMapOrSetConstructor(expression)
}

function summarizeInitializer(expression: ts.Expression): string {
    if (ts.isArrayLiteralExpression(expression)) return '[...]'
    if (isMapOrSetConstructor(expression)) {
        const constructorName = expression.expression.getText()
        return `new ${constructorName}(...)`
    }
    return expression.getText().replace(/\s+/g, ' ')
}

function formatDeclaration(declaration: ts.VariableDeclaration, sourceFile: ts.SourceFile): string {
    if (!declaration.initializer) {
        return declaration.getText(sourceFile).replace(/\s+/g, ' ')
    }

    const declarationText = declaration.getText(sourceFile)
    const initializerStart = declaration.initializer.getStart(sourceFile) - declaration.getStart(sourceFile)
    const nameAndType = declarationText.slice(0, initializerStart).replace(/\s*=\s*$/, '').replace(/\s+/g, ' ')
    return `${nameAndType} = ${summarizeInitializer(declaration.initializer)}`
}

function findModuleMutableState(file: string, text: string): MutableStateViolation[] {
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const violations: MutableStateViolation[] = []

    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue

        const declarations = statement.declarationList.declarations
        const isLet = isLetDeclarationList(statement.declarationList)
        const isConst = isConstDeclarationList(statement.declarationList)

        for (const declaration of declarations) {
            if (!isLet && !(isConst && isMutableContainerInitializer(declaration.initializer))) continue
            const {line} = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile))
            violations.push({
                file: relative(REPO_ROOT, file),
                line: line + 1,
                declaration: formatDeclaration(declaration, sourceFile),
            })
        }
    }

    return violations
}

async function scanSystemsPackages(): Promise<MutableStateViolation[]> {
    const sourceRoots = SCANNED_PACKAGE_NAMES.map(packageName => join(SYSTEMS_ROOT, packageName, 'src'))
    const sourceFiles = (await Promise.all(sourceRoots.map(listProductionSources))).flat().sort()
    const nested = await Promise.all(sourceFiles.map(async file => {
        const text = await readFile(file, 'utf8')
        return findModuleMutableState(file, text)
    }))
    return nested.flat()
}

function maybeRecordGraphDbServerImportViolation(
    violations: GraphDbServerImportViolation[],
    sourceFile: ts.SourceFile,
    file: string,
    node: ts.Node,
    importPath: string,
    kind: string,
): void {
    if (!GRAPH_DB_SERVER_IMPORT_PATTERN.test(importPath)) return
    const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    violations.push({
        file: repoRelativePath(file),
        line: line + 1,
        importPath,
        kind,
        snippet: node.getText(sourceFile).replace(/\s+/g, ' '),
    })
}

function findGraphDbServerImportViolations(file: string, text: string): GraphDbServerImportViolation[] {
    if (isAllowedGraphDbServerImportFile(file)) return []

    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const violations: GraphDbServerImportViolation[] = []

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            maybeRecordGraphDbServerImportViolation(
                violations,
                sourceFile,
                file,
                statement,
                statement.moduleSpecifier.text,
                'import',
            )
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            maybeRecordGraphDbServerImportViolation(
                violations,
                sourceFile,
                file,
                statement,
                statement.moduleSpecifier.text,
                'export',
            )
        }
    }

    const visit = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node)
            && node.expression.kind === ts.SyntaxKind.ImportKeyword
            && node.arguments.length > 0
            && ts.isStringLiteral(node.arguments[0])
        ) {
            maybeRecordGraphDbServerImportViolation(
                violations,
                sourceFile,
                file,
                node,
                node.arguments[0].text,
                'dynamic import',
            )
        }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sourceFile, visit)

    return violations
}

async function scanGraphDbServerConsumerImports(): Promise<GraphDbServerImportViolation[]> {
    const sourceFiles = (await Promise.all(GRAPH_DB_SERVER_CONSUMER_SOURCE_ROOTS.map(listProductionSources))).flat().sort()
    const nested = await Promise.all(sourceFiles.map(async file => {
        const text = await readFile(file, 'utf8')
        return findGraphDbServerImportViolations(file, text)
    }))
    return nested.flat()
}

function formatViolation(violation: MutableStateViolation): string {
    return `${violation.file}:${violation.line} — ${violation.declaration}`
}

function formatReport(violations: readonly MutableStateViolation[]): string {
    if (violations.length === 0) {
        return 'No module-level mutable state declarations found.'
    }

    return [
        `Found ${violations.length} module-level mutable state declaration(s):`,
        ...violations.map(formatViolation),
    ].join('\n')
}

function formatGraphDbServerImportViolation(violation: GraphDbServerImportViolation): string {
    return `${violation.file}:${violation.line} — ${violation.kind} ${violation.importPath}\n    ${violation.snippet}`
}

function formatGraphDbServerImportReport(violations: readonly GraphDbServerImportViolation[]): string {
    if (violations.length === 0) {
        return 'No forbidden @vt/graph-db-server imports found in production consumer sources.'
    }

    return [
        'Forbidden @vt/graph-db-server import(s) found outside launchers/search tools/tests:',
        ...violations.map(formatGraphDbServerImportViolation),
    ].join('\n')
}

describe('systems module-level mutable state scanner', () => {
    it('keeps top-level mutable state at or below the current ratchet baseline', async () => {
        const violations = await scanSystemsPackages()

        console.info(formatReport(violations))

        await recordHealthMetric({
            metricId: 'package-boundaries',
            metricName: 'Module-Level Mutable State',
            description: 'Top-level mutable declarations detected in scanned systems packages.',
            category: 'Purity',
            current: violations.length,
            budget: MODULE_MUTABLE_STATE_BASELINE,
            comparison: 'lte',
            unit: 'declarations',
            details: {violations},
        })

        expect(
            violations.length,
            formatReport(violations),
        ).toBeLessThanOrEqual(MODULE_MUTABLE_STATE_BASELINE)
    })
})

describe('@vt/graph-db-server consumer import boundary', () => {
    it('rejects static, dynamic, and re-exported imports from non-launcher production consumers', () => {
        const violations = findGraphDbServerImportViolations(
            join(REPO_ROOT, 'webapp/src/shell/edge/main/electron/bad-consumer.ts'),
            `
                import { getGraph } from '@vt/graph-db-server/state/graph-store'
                export { loadGraphFromDisk } from '@vt/graph-db-server/graph/loadGraphFromDisk'
                async function load() {
                    return import('@vt/graph-db-server/context-nodes/createContextNode')
                }
                void getGraph
                void load
            `,
        )

        expect(violations.map(v => `${v.kind} ${v.importPath}`)).toEqual([
            'import @vt/graph-db-server/state/graph-store',
            'export @vt/graph-db-server/graph/loadGraphFromDisk',
            'dynamic import @vt/graph-db-server/context-nodes/createContextNode',
        ])
    })

    it('allows intentional webapp CLI launcher/search/parity imports', () => {
        const violations = findGraphDbServerImportViolations(
            join(REPO_ROOT, 'webapp/src/shell/edge/main/cli/commands/graph/index-cmds.ts'),
            `
                import {buildIndex, search} from '@vt/graph-db-server/search/index-backend'
                import {SearchIndexNotFoundError, type NodeSearchHit} from '@vt/graph-db-server/search/types'
                void buildIndex
                void search
                void SearchIndexNotFoundError
            `,
        )

        expect(violations).toEqual([])
    })

    it('keeps webapp, agent-runtime, and voicetree-mcp production sources off graph-db-server outside allowlisted entrypoints', async () => {
        const violations = await scanGraphDbServerConsumerImports()

        expect(
            violations.map(formatGraphDbServerImportViolation),
            formatGraphDbServerImportReport(violations),
        ).toEqual([])
    })
})
