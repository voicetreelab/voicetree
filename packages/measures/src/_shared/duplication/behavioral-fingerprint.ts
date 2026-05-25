/**
 * Behavioral fingerprint (Type-4 clone detector).
 *
 * Captures what a function does rather than how it is spelled:
 *  - calledSymbols: multiset of CallExpression callees in the body
 *    (last identifier of a property-access chain), reduced to coarse
 *    log2-bucket counts so 1 vs 1, 2-3 vs 2-3, etc. cluster together
 *  - cfgShape: quantized (branchCount, loopCount, maxNestingDepth)
 *  - signature: arity, async-ness, returns-value vs returns-void
 *
 * The three are flattened into a feature set so MinHash + LSH can shortlist
 * candidates the same way the structural and lexical signals do.
 */
import * as ts from 'typescript'
import {minhash} from './minhash'

export const BEH_PERMUTATION_COUNT: number = 64
export const BEH_BAND_COUNT: number = 16
export const BEH_ROWS_PER_BAND: number = 4
const BEH_SEED: number = 2

export type CfgShape = {
    readonly branches: number
    readonly loops: number
    readonly depth: number
}

export type BehavioralFingerprint = {
    readonly calledSymbols: ReadonlyMap<string, number>
    readonly cfgShape: CfgShape
    readonly signature: string
    /** Flat feature set used for both LSH and exact Jaccard scoring. */
    readonly features: ReadonlySet<string>
    /** MinHash signature over `features`. */
    readonly minhashSignature: readonly number[]
}

function isFunctionLikeBoundary(node: ts.Node): boolean {
    return ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node)
        || ts.isConstructorDeclaration(node)
}

function calleeText(callee: ts.Expression): string | null {
    if (ts.isIdentifier(callee)) return callee.text
    if (ts.isPropertyAccessExpression(callee)) {
        return ts.isIdentifier(callee.name) ? callee.name.text : null
    }
    if (ts.isElementAccessExpression(callee)) {
        const arg = callee.argumentExpression
        if (ts.isStringLiteral(arg)) return arg.text
        return null
    }
    if (ts.isParenthesizedExpression(callee)) return calleeText(callee.expression)
    if (ts.isNonNullExpression(callee)) return calleeText(callee.expression)
    return null
}

function isBranching(node: ts.Node): boolean {
    return ts.isIfStatement(node)
        || ts.isConditionalExpression(node)
        || ts.isCaseClause(node)
        || ts.isCatchClause(node)
}

function isLoop(node: ts.Node): boolean {
    return ts.isForStatement(node)
        || ts.isForInStatement(node)
        || ts.isForOfStatement(node)
        || ts.isWhileStatement(node)
        || ts.isDoStatement(node)
}

function isNestingIncrement(node: ts.Node): boolean {
    return ts.isBlock(node)
        || ts.isIfStatement(node)
        || ts.isForStatement(node)
        || ts.isForInStatement(node)
        || ts.isForOfStatement(node)
        || ts.isWhileStatement(node)
        || ts.isDoStatement(node)
        || ts.isTryStatement(node)
        || ts.isCatchClause(node)
        || ts.isSwitchStatement(node)
}

function collectFromBody(body: ts.Node, root: ts.FunctionLikeDeclaration): {
    calledSymbols: Map<string, number>
    cfgShape: CfgShape
} {
    const calledSymbols = new Map<string, number>()
    let branches = 0
    let loops = 0
    let maxDepth = 0

    function visit(node: ts.Node, depth: number): void {
        if (node !== root && isFunctionLikeBoundary(node)) return

        if (isBranching(node)) branches += 1
        if (isLoop(node)) loops += 1

        if (ts.isCallExpression(node)) {
            const name = calleeText(node.expression)
            if (name !== null && name.length > 0) {
                calledSymbols.set(name, (calledSymbols.get(name) ?? 0) + 1)
            }
        }

        const nextDepth = isNestingIncrement(node) ? depth + 1 : depth
        if (nextDepth > maxDepth) maxDepth = nextDepth
        ts.forEachChild(node, child => visit(child, nextDepth))
    }
    visit(body, 0)

    return {
        calledSymbols,
        cfgShape: {branches, loops, depth: maxDepth},
    }
}

function quantize(value: number, bins: readonly number[]): number {
    for (let index = 0; index < bins.length; index += 1) {
        if (value <= bins[index]) return index
    }
    return bins.length
}

const BRANCH_BINS: readonly number[] = [0, 1, 3, 7]
const LOOP_BINS: readonly number[] = [0, 1, 3, 7]
const DEPTH_BINS: readonly number[] = [1, 2, 3, 5]

function quantizeCfg(cfg: CfgShape): string {
    return `B${quantize(cfg.branches, BRANCH_BINS)}L${quantize(cfg.loops, LOOP_BINS)}D${quantize(cfg.depth, DEPTH_BINS)}`
}

function logBucket(count: number): number {
    // 0 should never appear, but guard anyway.
    if (count <= 0) return 0
    return Math.floor(Math.log2(count))
}

function arityOf(node: ts.FunctionLikeDeclaration): number {
    return node.parameters?.length ?? 0
}

function isAsync(node: ts.FunctionLikeDeclaration): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    return modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false
}

function returnsValue(node: ts.FunctionLikeDeclaration, body: ts.Node): boolean {
    // Constructors and setters always return void semantically.
    if (ts.isConstructorDeclaration(node)) return false
    if (ts.isSetAccessor(node)) return false

    // Concise arrow body that is not a block is an expression -> returns value.
    if (ts.isArrowFunction(node) && !ts.isBlock(body)) return true

    let found = false
    function visit(child: ts.Node): void {
        if (found) return
        if (child !== body && isFunctionLikeBoundary(child)) return
        if (ts.isReturnStatement(child) && child.expression) {
            found = true
            return
        }
        ts.forEachChild(child, visit)
    }
    visit(body)
    return found
}

function signatureOf(node: ts.FunctionLikeDeclaration, body: ts.Node): string {
    const arity = arityOf(node)
    const async = isAsync(node) ? 1 : 0
    const returns = returnsValue(node, body) ? 'value' : 'void'
    return `arity-${arity}-async-${async}-returns-${returns}`
}

function featuresOf(calledSymbols: ReadonlyMap<string, number>, cfg: CfgShape, signature: string): Set<string> {
    const features = new Set<string>()
    for (const [symbol, count] of calledSymbols) {
        features.add(`cs:${symbol}@${logBucket(count)}`)
    }
    features.add(`cfg:${quantizeCfg(cfg)}`)
    features.add(`sig:${signature}`)
    return features
}

export function behavioralFingerprint(node: ts.FunctionLikeDeclaration): BehavioralFingerprint {
    const body = node.body
    if (!body) {
        // Defensive — extractFunctions filters bodiless declarations out.
        return {
            calledSymbols: new Map(),
            cfgShape: {branches: 0, loops: 0, depth: 0},
            signature: signatureOf(node, node),
            features: new Set(),
            minhashSignature: minhash([], BEH_PERMUTATION_COUNT, BEH_SEED),
        }
    }

    const {calledSymbols, cfgShape} = collectFromBody(body, node)
    const signature = signatureOf(node, body)
    const features = featuresOf(calledSymbols, cfgShape, signature)
    const minhashSignature = minhash(features, BEH_PERMUTATION_COUNT, BEH_SEED)

    return {
        calledSymbols,
        cfgShape,
        signature,
        features,
        minhashSignature,
    }
}
