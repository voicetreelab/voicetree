import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_FILE_DIR, '../../../../..')
const SYSTEMS_ROOT: string = resolve(REPO_ROOT, 'packages/systems')

const SCANNED_PACKAGE_NAMES: readonly string[] = [
    'graph-db-server',
    'agent-runtime',
    'vt-daemon',
] as const
// BF-267: Bumped 44 → 47 to absorb the net +3 module-state vars introduced by the
// DOVL+UFV epic (vaultLifecycle.{resources,mutexTail}, folderVisibilityResource.current,
// viewsStore.viewSwitchedListeners, watcherRebuild.unsub{FolderState,ViewSwitched}). A
// full DI refactor would re-thread vaultLifecycle through every HTTP route and webapp
// composition site (>3 files touched per the escalation trigger), so the team agreed to
// accept the bump and revisit when the daemon's composition root is restructured.
// 2026-05-21: Bumped 47 → 48 for writeMarkdownFile.ts's lastEditorBodyByTargetAndEditor
// cache, needed to preserve external SSE appends across focused-editor autosaves
// (tier2-editor-typing-order-regression-fixed.md). Same architectural reason as
// BF-267 — full DI would re-thread through every HTTP route.
// 2026-05-28 [PR #135 merge]: Bumped 48 → 49 for `SIBLING_SUFFIXES` — the
// top-level `readonly string[]` lookup table inside
// vt-daemon/.../recovery/removePersistedAgentRecord.ts (the deletion helper
// that backs the webapp "Show older" RPC, preserved from dev-manu through the
// dev-manu → dev integration). It's an immutable lookup constant by intent;
// the scanner still counts it because it's a top-level binding. Same
// architectural rationale as the prior bumps — folding it into a passed-in
// parameter would touch every recovery call site for no behavioral gain.
const MODULE_MUTABLE_STATE_BASELINE = 49
const GRAPH_DB_SERVER_IMPORT_PATTERN = /^@vt\/graph-db-server(?:\/.*)?$/
const GRAPH_DB_SERVER_CONSUMER_SOURCE_ROOTS: readonly string[] = [
    join(REPO_ROOT, 'webapp/src'),
    join(SYSTEMS_ROOT, 'agent-runtime/src'),
    join(SYSTEMS_ROOT, 'vt-daemon/bin'),
    join(SYSTEMS_ROOT, 'vt-daemon/src'),
    join(SYSTEMS_ROOT, 'voicetree-cli/src'),
] as const
const ALLOWED_GRAPH_DB_SERVER_IMPORT_FILES: readonly string[] = [
    // Vaultless graph-db-client launcher embeds a daemon start import in the child-process eval script.
    'packages/systems/graph-db-client/src/autoLaunch/spawn/vaultlessSpawn.ts',
    // CLI serve command is the intentional entrypoint for starting the daemon.
    'packages/systems/voicetree-cli/src/commands/runtime/serve.ts',
    // Route-parity command imports daemon route types for CLI/API consistency checks.
    'packages/systems/voicetree-cli/src/commands/runtime/daemonRouteParity.ts',
    // Graph CLI index command intentionally reaches the daemon search backend.
    'packages/systems/voicetree-cli/src/commands/graph/actions/index-cmds.ts',
    // Graph CLI shared types expose search-result shape without runtime daemon ownership.
    'packages/systems/voicetree-cli/src/commands/graph/core/types.ts',
    // BF-371: bin/vtd.ts (formerly bin/vt-mcpd.ts) no longer imports
    // graph-db-server — it talks to vt-graphd via @vt/graph-db-client as a
    // SIBLING process. No allowlist entry required.
] as const
const DAEMON_OWNED_MUTATIONS_NON_LAUNCHER_RUNTIME_IMPORT_BUDGET = 0

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
    runtimeSymbols: readonly string[]
    snippet: string
}

type GraphDbServerImportReference = GraphDbServerImportViolation & {
    allowed: boolean
}

type GraphDbServerConsumerImportReport = {
    allowlistedRuntimeImports: readonly GraphDbServerImportReference[]
    nonLauncherImports: readonly GraphDbServerImportReference[]
    nonLauncherRuntimeImports: readonly GraphDbServerImportReference[]
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
        && !path.endsWith('/__audit_seed__.ts')
        && !path.endsWith('.test.ts')
        && !path.endsWith('.spec.ts')
        && !path.includes('/__tests__/')
        && !path.includes('/__generated__/')
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

function isMapOrSetConstructor(expression: ts.Expression): expression is ts.NewExpression & {expression: ts.Identifier} {
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
    references: GraphDbServerImportReference[],
    sourceFile: ts.SourceFile,
    file: string,
    node: ts.Node,
    importPath: string,
    kind: string,
    runtimeSymbols: readonly string[],
): void {
    if (!GRAPH_DB_SERVER_IMPORT_PATTERN.test(importPath)) return
    const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    references.push({
        allowed: isAllowedGraphDbServerImportFile(file),
        file: repoRelativePath(file),
        line: line + 1,
        importPath,
        kind,
        runtimeSymbols,
        snippet: node.getText(sourceFile).replace(/\s+/g, ' '),
    })
}

function importClauseRuntimeSymbols(importClause: ts.ImportClause | undefined): readonly string[] {
    if (!importClause) return ['<side-effect>']
    if (importClause.isTypeOnly) return []

    const symbols: string[] = []
    if (importClause.name) {
        symbols.push(importClause.name.text)
    }

    const namedBindings = importClause.namedBindings
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        symbols.push(`* as ${namedBindings.name.text}`)
    } else if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
            if (!element.isTypeOnly) {
                symbols.push(element.name.text)
            }
        }
    }

    return symbols
}

function exportDeclarationRuntimeSymbols(statement: ts.ExportDeclaration): readonly string[] {
    if (statement.isTypeOnly) return []
    if (!statement.exportClause) return ['*']
    if (!ts.isNamedExports(statement.exportClause)) return ['*']

    return statement.exportClause.elements
        .filter(element => !element.isTypeOnly)
        .map(element => element.name.text)
}

function findGraphDbServerImportReferences(file: string, text: string): GraphDbServerImportReference[] {
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const references: GraphDbServerImportReference[] = []

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            maybeRecordGraphDbServerImportViolation(
                references,
                sourceFile,
                file,
                statement,
                statement.moduleSpecifier.text,
                'import',
                importClauseRuntimeSymbols(statement.importClause),
            )
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            maybeRecordGraphDbServerImportViolation(
                references,
                sourceFile,
                file,
                statement,
                statement.moduleSpecifier.text,
                'export',
                exportDeclarationRuntimeSymbols(statement),
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
                references,
                sourceFile,
                file,
                node,
                node.arguments[0].text,
                'dynamic import',
                ['<dynamic>'],
            )
        }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sourceFile, visit)

    return references
}

function findGraphDbServerImportViolations(file: string, text: string): GraphDbServerImportViolation[] {
    return findGraphDbServerImportReferences(file, text)
        .filter(reference => !reference.allowed)
}

async function scanGraphDbServerConsumerImports(): Promise<GraphDbServerConsumerImportReport> {
    const sourceFiles = (await Promise.all(GRAPH_DB_SERVER_CONSUMER_SOURCE_ROOTS.map(listProductionSources))).flat().sort()
    const nested = await Promise.all(sourceFiles.map(async file => {
        const text = await readFile(file, 'utf8')
        return findGraphDbServerImportReferences(file, text)
    }))
    const references = nested.flat()
    const runtimeReferences = references.filter(reference => reference.runtimeSymbols.length > 0)
    const nonLauncherImports = references.filter(reference => !reference.allowed)

    return {
        allowlistedRuntimeImports: runtimeReferences.filter(reference => reference.allowed),
        nonLauncherImports,
        nonLauncherRuntimeImports: nonLauncherImports.filter(reference => reference.runtimeSymbols.length > 0),
    }
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
    const runtimeSymbols = violation.runtimeSymbols.length > 0
        ? ` runtime=[${violation.runtimeSymbols.join(', ')}]`
        : ' runtime=[]'
    return `${violation.file}:${violation.line} — ${violation.kind} ${violation.importPath}${runtimeSymbols}\n    ${violation.snippet}`
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

    it('allows intentional @voicetree/cli launcher/search/parity imports', () => {
        const violations = findGraphDbServerImportViolations(
            join(REPO_ROOT, 'packages/systems/voicetree-cli/src/commands/graph/actions/index-cmds.ts'),
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

    it('keeps webapp, agent-runtime, and vt-daemon production sources off graph-db-server outside allowlisted entrypoints', async () => {
        const report = await scanGraphDbServerConsumerImports()

        console.info(
            [
                'Daemon-owned-mutations graph-db-server coupling ratchet:',
                `nonLauncherGraphDbServerRuntimeImports=${report.nonLauncherRuntimeImports.length}`,
                `allowlistedGraphDbServerRuntimeImports=${report.allowlistedRuntimeImports.reduce((total, reference) => total + reference.runtimeSymbols.length, 0)}`,
            ].join(' '),
        )

        await recordHealthMetric({
            metricId: 'daemon-owned-mutations-non-launcher-graph-db-server-runtime-imports',
            metricName: 'Daemon-Owned Mutations Non-Launcher GraphDbServer Runtime Imports',
            description: 'Production webapp, agent-runtime, and vt-daemon runtime imports from @vt/graph-db-server outside launcher/search/parity entrypoints.',
            category: 'Coupling',
            current: report.nonLauncherRuntimeImports.length,
            budget: DAEMON_OWNED_MUTATIONS_NON_LAUNCHER_RUNTIME_IMPORT_BUDGET,
            comparison: 'lte',
            unit: 'imports',
            details: {
                allowlistedRuntimeImports: report.allowlistedRuntimeImports,
                nonLauncherImports: report.nonLauncherImports,
                nonLauncherRuntimeImports: report.nonLauncherRuntimeImports,
            },
        })

        expect(
            report.nonLauncherImports.map(formatGraphDbServerImportViolation),
            formatGraphDbServerImportReport(report.nonLauncherImports),
        ).toEqual([])
    })
})
