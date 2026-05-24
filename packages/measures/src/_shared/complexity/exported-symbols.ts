/**
 * Top-level exported-symbol counter, shared by the file-shape and the
 * subgraph boundary-width measures.
 *
 * Extracted from `health/shape/exports-per-file.test.ts` so the subgraph
 * gate's boundary-width measure cannot drift from the test's reference
 * implementation. Both must agree on what "exported" means:
 *   - `export function/class/interface/type/enum/var`: counted by
 *     declaration name(s) — destructuring is unpacked.
 *   - `export default`: counted as `default`.
 *   - `export { a, b as c }`: counted as the local names.
 *   - `export * from '...'`: counted as `*:<specifier>`.
 *   - `export namespace { ... }`: counted as the namespace name.
 *
 * Pure of side effects: returns the list of unique top-level exported
 * symbol names from one TS source file. Does not call ts.transpile or
 * touch the type checker.
 */
import * as ts from 'typescript'

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    return modifiers?.some(modifier => modifier.kind === kind) ?? false
}

function collectBindingNames(name: ts.BindingName): string[] {
    if (ts.isIdentifier(name)) return [name.text]
    const nested = name.elements.map(element => {
        if (ts.isOmittedExpression(element)) return []
        return collectBindingNames(element.name)
    })
    return nested.flat()
}

function collectExportedDeclarationSymbols(statement: ts.Statement): string[] {
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return []
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return ['default']

    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.flatMap(declaration => collectBindingNames(declaration.name))
    }

    if (
        (ts.isFunctionDeclaration(statement)
            || ts.isTypeAliasDeclaration(statement)
            || ts.isInterfaceDeclaration(statement)
            || ts.isClassDeclaration(statement)
            || ts.isEnumDeclaration(statement))
        && statement.name
    ) {
        return [statement.name.text]
    }

    return []
}

function collectExportDeclarationSymbols(statement: ts.ExportDeclaration): string[] {
    if (!statement.exportClause) {
        const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : 'local'
        return [`*:${specifier}`]
    }
    if (ts.isNamespaceExport(statement.exportClause)) return [statement.exportClause.name.text]
    return statement.exportClause.elements.map(element => element.name.text)
}

/**
 * Return the unique sorted set of top-level exported symbol names for a
 * single TS source file's text.
 */
export function exportedSymbolNames(filePath: string, text: string): string[] {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    const symbols: Set<string> = new Set()

    for (const statement of sourceFile.statements) {
        for (const symbol of collectExportedDeclarationSymbols(statement)) symbols.add(symbol)
        if (ts.isExportAssignment(statement) && !statement.isExportEquals) symbols.add('default')
        if (ts.isExportDeclaration(statement)) {
            for (const symbol of collectExportDeclarationSymbols(statement)) symbols.add(symbol)
        }
    }
    return [...symbols].sort()
}
