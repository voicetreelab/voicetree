/**
 * Structural fingerprint (Type-2 clone detector).
 *
 * Walks a function body and emits a canonical shape string composed of
 * SyntaxKind names. Identifiers and literals are erased, so two functions
 * that differ only in variable names or literal values produce identical
 * fingerprints.
 *
 * We also produce a multi-set of "subtree shapes" (every internal subtree,
 * stringified) so the final Jaccard score uses richer structural overlap
 * than a single root hash would give. The root hash is the LSH bucket key
 * (LSH degenerates to exact-hash equality for the structural signal — that
 * is intentional: structural matches are precise by nature, fuzzy matching
 * is what the lexical signal is for).
 */
import * as ts from 'typescript'
import {stableHash} from '../duplication-lsh/minhash'

export type StructuralFingerprint = {
    /** FNV-1a-32 of the canonical body shape — used as a single LSH bucket. */
    readonly rootHash: number
    /** Set of subtree shape strings — used for exact Jaccard scoring. */
    readonly subtreeShapes: ReadonlySet<string>
}

function kindName(kind: ts.SyntaxKind): string {
    return ts.SyntaxKind[kind] ?? `K${kind}`
}

function isIdentifierLike(node: ts.Node): boolean {
    return ts.isIdentifier(node)
        || ts.isPrivateIdentifier(node)
}

function isLiteralLike(node: ts.Node): boolean {
    return ts.isStringLiteral(node)
        || ts.isNumericLiteral(node)
        || ts.isBigIntLiteral(node)
        || ts.isRegularExpressionLiteral(node)
        || ts.isNoSubstitutionTemplateLiteral(node)
        || node.kind === ts.SyntaxKind.TrueKeyword
        || node.kind === ts.SyntaxKind.FalseKeyword
        || node.kind === ts.SyntaxKind.NullKeyword
}

function shapeOf(node: ts.Node): string {
    if (isIdentifierLike(node)) return 'ID'
    if (isLiteralLike(node)) return 'LIT'

    const children: ts.Node[] = []
    ts.forEachChild(node, child => {
        children.push(child)
    })

    if (children.length === 0) return kindName(node.kind)
    const childShapes = children.map(shapeOf).join(',')
    return `${kindName(node.kind)}(${childShapes})`
}

function collectSubtreeShapes(node: ts.Node, into: Set<string>): string {
    if (isIdentifierLike(node)) {
        into.add('ID')
        return 'ID'
    }
    if (isLiteralLike(node)) {
        into.add('LIT')
        return 'LIT'
    }

    const children: ts.Node[] = []
    ts.forEachChild(node, child => {
        children.push(child)
    })

    if (children.length === 0) {
        const leaf = kindName(node.kind)
        into.add(leaf)
        return leaf
    }

    const childShapes = children.map(child => collectSubtreeShapes(child, into))
    const shape = `${kindName(node.kind)}(${childShapes.join(',')})`
    into.add(shape)
    return shape
}

export function structuralFingerprint(body: ts.Node): StructuralFingerprint {
    const subtreeShapes = new Set<string>()
    const root = collectSubtreeShapes(body, subtreeShapes)
    return {
        rootHash: stableHash(root),
        subtreeShapes,
    }
}

/** Helper for tests that want to see the canonical shape string itself. */
export function structuralShapeString(body: ts.Node): string {
    return shapeOf(body)
}
