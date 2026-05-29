import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, normalize, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import {describe, expect, it} from 'vitest'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const WEBAPP_ROOT: string = resolve(TEST_FILE_DIR, '../../../../../..')
const REPO_ROOT: string = resolve(WEBAPP_ROOT, '..')

const ELECTRON_MAIN_ENTRYPOINTS: string[] = [
    join(WEBAPP_ROOT, 'src/shell/edge/main/runtime/electron/app/main.ts'),
    join(WEBAPP_ROOT, 'src/shell/edge/main/runtime/electron/app/preload.ts'),
]

const INTERNAL_PACKAGE_ROOTS: Record<string, string> = {
    '@vt/graph-db-client': join(REPO_ROOT, 'packages/systems/graph-db-client/src'),
    '@vt/graph-db-server': join(REPO_ROOT, 'packages/systems/graph-db-server/src'),
    '@vt/graph-model': join(REPO_ROOT, 'packages/libraries/graph-model/src'),
    '@vt/graph-state': join(REPO_ROOT, 'packages/libraries/graph-state/src'),
    '@vt/graph-tools': join(REPO_ROOT, 'packages/libraries/graph-tools/src'),
}

const FORBIDDEN_MODULES: RegExp[] = [
    /^@vt\/graph-db-server\/watch-folder\/project-allowlist$/,
    /^@vt\/graph-db-server\/views\/folderVisibilitySqlite$/,
    /^@vt\/graph-db-server\/views\/folder-visibility-active-view$/,
]

const FORBIDDEN_SOURCE_PATHS: string[] = [
    join(REPO_ROOT, 'packages/systems/graph-db-server/src/watch-folder/project-allowlist.ts'),
    join(REPO_ROOT, 'packages/systems/graph-db-server/src/views/folderVisibilitySqlite.ts'),
    join(REPO_ROOT, 'packages/systems/graph-db-server/src/views/folder-visibility-active-view.ts'),
]

type ImportEdge = {
    importer: string
    specifier: string
    resolvedPath: string | null
}

type Violation = {
    forbidden: string
    chain: ImportEdge[]
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

function isProductionSource(path: string): boolean {
    return !path.endsWith('.test.ts')
        && !path.endsWith('.test.tsx')
        && !path.endsWith('.spec.ts')
        && !path.endsWith('.spec.tsx')
        && !path.includes('/__tests__/')
        && !path.includes('/integration-tests/')
}

async function listProductionSources(root: string): Promise<string[]> {
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) {
            return listProductionSources(path)
        }
        if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && isProductionSource(path)) {
            return [path]
        }
        return []
    }))
    return nested.flat()
}

function importSpecifierFromNode(node: ts.Node): {specifier: string, typeOnly: boolean} | null {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        return {
            specifier: node.moduleSpecifier.text,
            typeOnly: node.importClause?.isTypeOnly === true,
        }
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        return {
            specifier: node.moduleSpecifier.text,
            typeOnly: node.isTypeOnly === true,
        }
    }

    if (
        ts.isCallExpression(node)
        && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments.length === 1
        && ts.isStringLiteral(node.arguments[0])
    ) {
        return {
            specifier: node.arguments[0].text,
            typeOnly: false,
        }
    }

    return null
}

function collectRuntimeImportSpecifiers(sourceText: string, filePath: string): string[] {
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
    const specifiers: string[] = []

    function visit(node: ts.Node): void {
        const importSpecifier = importSpecifierFromNode(node)
        if (importSpecifier && !importSpecifier.typeOnly) {
            specifiers.push(importSpecifier.specifier)
        }
        ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    return specifiers
}

function withoutExtension(path: string): string {
    return path.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '')
}

async function resolveFileCandidate(candidate: string): Promise<string | null> {
    const candidates = [
        candidate,
        `${candidate}.ts`,
        `${candidate}.tsx`,
        `${candidate}.mts`,
        `${candidate}.js`,
        join(candidate, 'index.ts'),
        join(candidate, 'index.tsx'),
    ]

    for (const path of candidates) {
        if (await pathExists(path)) {
            return path
        }
    }

    return null
}

async function resolveInternalSpecifier(importer: string, specifier: string): Promise<string | null> {
    if (specifier.startsWith('.')) {
        return resolveFileCandidate(resolve(dirname(importer), specifier))
    }

    if (specifier.startsWith('@/')) {
        return resolveFileCandidate(join(WEBAPP_ROOT, 'src', specifier.slice(2)))
    }

    for (const [packageName, packageSrcRoot] of Object.entries(INTERNAL_PACKAGE_ROOTS)) {
        if (specifier === packageName) {
            return resolveFileCandidate(join(packageSrcRoot, 'index'))
        }
        if (specifier.startsWith(`${packageName}/`)) {
            return resolveFileCandidate(join(packageSrcRoot, specifier.slice(packageName.length + 1)))
        }
    }

    return null
}

function forbiddenForSpecifier(specifier: string): string | null {
    const match = FORBIDDEN_MODULES.find(pattern => pattern.test(specifier))
    return match?.source ?? null
}

function forbiddenForResolvedPath(path: string): string | null {
    const normalizedPath = normalize(path)
    return FORBIDDEN_SOURCE_PATHS.find(forbiddenPath => {
        const normalizedForbiddenPath = normalize(forbiddenPath)
        return normalizedPath === normalizedForbiddenPath
            || normalizedPath.startsWith(`${withoutExtension(normalizedForbiddenPath)}/`)
            || normalizedPath.startsWith(`${normalizedForbiddenPath}/`)
    }) ?? null
}

async function findNativeBoundaryViolations(): Promise<Violation[]> {
    const sourceRoots: string[] = [
        join(WEBAPP_ROOT, 'src/shell/edge/main'),
        ...Object.values(INTERNAL_PACKAGE_ROOTS),
    ]
    const sourceFiles = new Set((await Promise.all(sourceRoots.map(listProductionSources))).flat())
    const queue: {path: string, chain: ImportEdge[]}[] = ELECTRON_MAIN_ENTRYPOINTS.map(path => ({
        path,
        chain: [],
    }))
    const visited = new Set<string>()
    const violations: Violation[] = []

    while (queue.length > 0) {
        const current = queue.shift()
        if (!current || visited.has(current.path) || !sourceFiles.has(current.path)) {
            continue
        }
        visited.add(current.path)

        const sourceText = await readFile(current.path, 'utf8')
        for (const specifier of collectRuntimeImportSpecifiers(sourceText, current.path)) {
            const resolvedPath = await resolveInternalSpecifier(current.path, specifier)
            const edge: ImportEdge = {importer: current.path, specifier, resolvedPath}
            const specifierViolation = forbiddenForSpecifier(specifier)
            const pathViolation = resolvedPath ? forbiddenForResolvedPath(resolvedPath) : null

            if (specifierViolation || pathViolation) {
                violations.push({
                    forbidden: specifierViolation ?? pathViolation ?? specifier,
                    chain: [...current.chain, edge],
                })
                continue
            }

            if (resolvedPath && sourceFiles.has(resolvedPath)) {
                queue.push({
                    path: resolvedPath,
                    chain: [...current.chain, edge],
                })
            }
        }
    }

    return violations
}

function formatEdge(edge: ImportEdge): string {
    const importer = relative(REPO_ROOT, edge.importer)
    const resolved = edge.resolvedPath ? ` -> ${relative(REPO_ROOT, edge.resolvedPath)}` : ''
    return `${importer} imports ${edge.specifier}${resolved}`
}

function formatViolation(violation: Violation): string {
    return [
        `Forbidden native-storage reachability: ${violation.forbidden}`,
        ...violation.chain.map(edge => `  ${formatEdge(edge)}`),
    ].join('\n')
}

describe('Electron main native storage boundary', () => {
    it('does not reach daemon-owned SQLite/search modules from Electron entrypoints', async () => {
        const violations = await findNativeBoundaryViolations()

        expect(violations.map(formatViolation)).toEqual([])
    }, 30000)
})
