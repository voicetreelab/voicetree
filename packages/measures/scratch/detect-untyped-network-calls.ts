import {dirname, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Node, Project, SyntaxKind, ts, type SourceFile} from 'ts-morph'

const THIS_FILE = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(dirname(THIS_FILE), '..', '..', '..')

type Category =
    | 'fetch'
    | 'websocket'
    | 'eventsource'
    | 'childProcess'
    | 'nodeHttp'
    | 'nodeNet'
    | 'urlScheme'
    | 'localhostPort'

type Hit = {
    readonly category: Category
    readonly filePath: string
    readonly line: number
    readonly snippet: string
}

const CATEGORIES: readonly Category[] = [
    'fetch', 'websocket', 'eventsource', 'childProcess',
    'nodeHttp', 'nodeNet', 'urlScheme', 'localhostPort',
]

const CHILD_PROCESS_METHODS = new Set(['spawn', 'exec', 'execFile', 'fork'])
const NODE_HTTP_METHODS = new Set(['request', 'get'])
const NODE_NET_METHODS = new Set(['connect', 'createConnection'])

const URL_SCHEME_REGEX = /\b(?:https?|wss?):\/\//
const LOCALHOST_PORT_REGEX = /\blocalhost:\d{2,5}\b/

function isProductionSourcePath(path: string): boolean {
    const p = path.replaceAll('\\', '/')
    return !p.endsWith('.d.ts')
        && !p.endsWith('.test.ts')
        && !p.endsWith('.test.tsx')
        && !p.endsWith('.spec.ts')
        && !p.endsWith('.spec.tsx')
        && !p.endsWith('.config.ts')
        && !p.includes('/__tests__/')
        && !p.includes('/__generated__/')
        && !p.includes('/integration-tests/')
        && !p.includes('/node_modules/')
        && !p.includes('/dist/')
        && !p.includes('/build/')
        && !p.includes('/scripts/')
        && !p.includes('/bin/')
        && !p.includes('/tests/')
}

function snippet(text: string): string {
    const oneLine = text.replaceAll(/\s+/g, ' ').trim()
    return oneLine.length > 120 ? oneLine.slice(0, 117) + '...' : oneLine
}

function relPath(sourceFile: SourceFile): string {
    return relative(REPO_ROOT, sourceFile.getFilePath()).replaceAll('\\', '/')
}

function callExprIdentifierName(node: Node): string | null {
    if (!Node.isCallExpression(node)) return null
    const expr = node.getExpression()
    if (Node.isIdentifier(expr)) return expr.getText()
    return null
}

function callExprPropertyAccess(node: Node): {object: string; property: string} | null {
    if (!Node.isCallExpression(node)) return null
    const expr = node.getExpression()
    if (!Node.isPropertyAccessExpression(expr)) return null
    return {
        object: expr.getExpression().getText(),
        property: expr.getName(),
    }
}

function newExprIdentifierName(node: Node): string | null {
    if (!Node.isNewExpression(node)) return null
    const expr = node.getExpression()
    if (Node.isIdentifier(expr)) return expr.getText()
    return null
}

function fileLine(sourceFile: SourceFile, node: Node): number {
    return sourceFile.getLineAndColumnAtPos(node.getStart()).line
}

function collectAstHits(sourceFile: SourceFile, hits: Hit[]): void {
    const filePath = relPath(sourceFile)
    sourceFile.forEachDescendant(node => {
        const fetchName = callExprIdentifierName(node)
        if (fetchName === 'fetch') {
            hits.push({category: 'fetch', filePath, line: fileLine(sourceFile, node), snippet: snippet(node.getText())})
            return
        }
        const newName = newExprIdentifierName(node)
        if (newName === 'WebSocket') {
            hits.push({category: 'websocket', filePath, line: fileLine(sourceFile, node), snippet: snippet(node.getText())})
            return
        }
        if (newName === 'EventSource') {
            hits.push({category: 'eventsource', filePath, line: fileLine(sourceFile, node), snippet: snippet(node.getText())})
            return
        }
        const propCall = callExprPropertyAccess(node)
        if (propCall) {
            const {object, property} = propCall
            if (CHILD_PROCESS_METHODS.has(property) && (object === 'child_process' || object.endsWith('childProcess'))) {
                hits.push({category: 'childProcess', filePath, line: fileLine(sourceFile, node), snippet: snippet(node.getText())})
                return
            }
            if (NODE_HTTP_METHODS.has(property) && (object === 'http' || object === 'https')) {
                hits.push({category: 'nodeHttp', filePath, line: fileLine(sourceFile, node), snippet: snippet(node.getText())})
                return
            }
            if (NODE_NET_METHODS.has(property) && object === 'net') {
                hits.push({category: 'nodeNet', filePath, line: fileLine(sourceFile, node), snippet: snippet(node.getText())})
                return
            }
        }
        if (Node.isCallExpression(node)) {
            const callee = callExprIdentifierName(node)
            if (callee && (CHILD_PROCESS_METHODS.has(callee) || NODE_HTTP_METHODS.has(callee) || NODE_NET_METHODS.has(callee))) {
                const importDecl = sourceFile.getImportDeclarations().find(d => {
                    const named = d.getNamedImports().some(n => (n.getAliasNode()?.getText() ?? n.getName()) === callee)
                    const spec = d.getModuleSpecifierValue()
                    return named && (spec === 'child_process' || spec === 'node:child_process' || spec === 'http' || spec === 'https' || spec === 'net' || spec === 'node:http' || spec === 'node:https' || spec === 'node:net')
                })
                if (importDecl) {
                    const spec = importDecl.getModuleSpecifierValue()
                    const cat: Category = spec.includes('child_process') ? 'childProcess'
                        : spec.includes('http') ? 'nodeHttp'
                        : 'nodeNet'
                    hits.push({category: cat, filePath, line: fileLine(sourceFile, node), snippet: snippet(node.getText())})
                }
            }
        }
    })
}

function collectStringHits(sourceFile: SourceFile, hits: Hit[]): void {
    const filePath = relPath(sourceFile)
    sourceFile.forEachDescendant(node => {
        const kind = node.getKind()
        if (kind !== SyntaxKind.StringLiteral
            && kind !== SyntaxKind.NoSubstitutionTemplateLiteral
            && kind !== SyntaxKind.TemplateExpression
            && kind !== SyntaxKind.TemplateHead
            && kind !== SyntaxKind.TemplateMiddle
            && kind !== SyntaxKind.TemplateTail) return
        const text = node.getText()
        if (URL_SCHEME_REGEX.test(text)) {
            hits.push({category: 'urlScheme', filePath, line: fileLine(sourceFile, node), snippet: snippet(text)})
        }
        if (LOCALHOST_PORT_REGEX.test(text)) {
            hits.push({category: 'localhostPort', filePath, line: fileLine(sourceFile, node), snippet: snippet(text)})
        }
    })
}

function deduplicateHits(hits: readonly Hit[]): Hit[] {
    const seen = new Set<string>()
    const out: Hit[] = []
    for (const hit of hits) {
        const key = `${hit.category}\0${hit.filePath}\0${hit.line}\0${hit.snippet}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(hit)
    }
    return out
}

function printSummary(hits: readonly Hit[]): void {
    const counts = new Map<Category, number>(CATEGORIES.map(c => [c, 0]))
    for (const h of hits) counts.set(h.category, (counts.get(h.category) ?? 0) + 1)
    console.log('category          count')
    console.log('─────────────────────')
    for (const c of CATEGORIES) {
        console.log(`${c.padEnd(17)}${String(counts.get(c) ?? 0).padStart(5)}`)
    }
    console.log('─────────────────────')
    console.log(`${'TOTAL'.padEnd(17)}${String(hits.length).padStart(5)}`)
    console.log()
}

function printListing(hits: readonly Hit[], cap: number): void {
    for (const c of CATEGORIES) {
        const inCat = hits.filter(h => h.category === c)
        if (inCat.length === 0) continue
        console.log(`## ${c} (${inCat.length})`)
        const shown = inCat.slice(0, cap)
        for (const h of shown) {
            console.log(`  ${h.filePath}:${h.line} — ${h.snippet}`)
        }
        if (inCat.length > cap) console.log(`  (${inCat.length - cap} more)`)
        console.log()
    }
}

async function main(): Promise<void> {
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
    ]).filter(sf => isProductionSourcePath(sf.getFilePath()))

    console.error(`scanning ${sourceFiles.length} files…`)

    const rawHits: Hit[] = []
    for (const sf of sourceFiles) {
        collectAstHits(sf, rawHits)
        collectStringHits(sf, rawHits)
    }
    const hits = deduplicateHits(rawHits)

    printSummary(hits)
    printListing(hits, 30)
}

await main()
