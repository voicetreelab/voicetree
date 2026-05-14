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

type MutableStateViolation = {
    file: string
    line: number
    declaration: string
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
