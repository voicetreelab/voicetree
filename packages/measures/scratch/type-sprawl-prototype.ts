/**
 * Type-sprawl detection PROTOTYPE (scratch — not wired into any tier).
 *
 * Proves the core detection signal for the "type sprawl" health measure:
 * the same domain concept declared as multiple separate, structurally-similar
 * named types across modules (each agent redeclares a local type instead of
 * importing the canonical one).
 *
 * Run: npx tsx packages/measures/scratch/type-sprawl-prototype.ts
 *
 * Signal: for every exported interface / object-type alias we harvest the
 * SET of field names (the structural shape, name-agnostic). Two declarations
 * in different files are a sprawl pair when their field-name sets are highly
 * similar (Jaccard >= STRUCT_THRESHOLD) and large enough to be non-trivial
 * (>= MIN_FIELDS). We then classify the relationship:
 *   - near-duplicate : symmetric coverage both ways  -> accidental sprawl
 *   - projection     : one set strictly contains the other, low reverse
 *                      coverage -> likely a deliberate subset, downweighted
 *
 * This is name-AGNOSTIC on purpose: it catches renamed copies and anonymous
 * drift that the existing name-uniqueness check (name-token based) cannot.
 */
import {execFileSync} from 'node:child_process'
import {dirname, join} from 'node:path'
import {Project, SyntaxKind, type Node} from 'ts-morph'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')

const MIN_FIELDS = 4 // ignore trivial shapes like {success, error}
const STRUCT_THRESHOLD = 0.7 // field-set Jaccard to count as a sprawl pair
const PROJECTION_REVERSE_COVERAGE = 0.85 // below this in the smaller->larger
// direction with full containment => treat as projection, not sprawl

type TypeDecl = {
    readonly name: string
    readonly file: string // repo-relative
    readonly line: number
    readonly community: string // package/firstDirSegment
    readonly fields: ReadonlySet<string>
}

function listTrackedTsFiles(): readonly string[] {
    const stdout = execFileSync('git', ['ls-files', '-z', '*.ts'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    })
    return stdout
        .split('\0')
        .filter(p => p.length > 0)
        .filter(p => !p.endsWith('.d.ts'))
        .filter(p => !p.includes('/node_modules/'))
        .filter(p => !/\.(test|spec)\.ts$/.test(p))
}

/** package/firstSegment community key, mirroring community-at-depth(depth=1). */
function communityOf(relPath: string): string {
    const parts = relPath.split('/')
    const srcIdx = parts.indexOf('src')
    if (srcIdx === -1 || srcIdx + 1 >= parts.length) {
        return parts.slice(0, 2).join('/')
    }
    const pkg = parts[srcIdx - 1] ?? parts[0]
    const firstSeg = parts[srcIdx + 1].endsWith('.ts') ? '__root__' : parts[srcIdx + 1]
    return `${pkg}/${firstSeg}`
}

/** Harvest the field-name set from an interface body or object type literal. */
function fieldNamesOf(node: Node): Set<string> {
    const fields = new Set<string>()
    for (const member of node.getChildrenOfKind(SyntaxKind.PropertySignature)) {
        const name = member.getName()
        if (name) fields.add(name)
    }
    return fields
}

function extractTypeDecls(project: Project, files: readonly string[]): TypeDecl[] {
    const decls: TypeDecl[] = []
    for (const rel of files) {
        const sf = project.addSourceFileAtPathIfExists(join(REPO_ROOT, rel))
        if (!sf) continue
        const community = communityOf(rel)

        for (const iface of sf.getInterfaces()) {
            const fields = fieldNamesOf(iface)
            if (fields.size >= MIN_FIELDS) {
                decls.push({name: iface.getName(), file: rel, line: iface.getStartLineNumber(), community, fields})
            }
        }
        for (const alias of sf.getTypeAliases()) {
            const literal = alias.getTypeNode()
            if (literal?.getKind() !== SyntaxKind.TypeLiteral) continue
            const fields = fieldNamesOf(literal)
            if (fields.size >= MIN_FIELDS) {
                decls.push({name: alias.getName(), file: rel, line: alias.getStartLineNumber(), community, fields})
            }
        }
        // Drop the AST to keep memory bounded across the whole repo.
        sf.forget()
    }
    return decls
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
    let inter = 0
    for (const x of a) if (b.has(x)) inter++
    const union = a.size + b.size - inter
    return union === 0 ? 0 : inter / union
}

/** coverage(small ⊆ large): fraction of small's fields present in large. */
function coverage(small: ReadonlySet<string>, large: ReadonlySet<string>): number {
    let inter = 0
    for (const x of small) if (large.has(x)) inter++
    return small.size === 0 ? 0 : inter / small.size
}

type SprawlPair = {
    readonly a: TypeDecl
    readonly b: TypeDecl
    readonly jaccard: number
    readonly relation: 'near-duplicate' | 'projection'
    readonly crossCommunity: boolean
}

function findSprawl(decls: readonly TypeDecl[]): SprawlPair[] {
    const pairs: SprawlPair[] = []
    for (let i = 0; i < decls.length; i++) {
        for (let j = i + 1; j < decls.length; j++) {
            const a = decls[i]
            const b = decls[j]
            if (a.file === b.file) continue // same-file siblings are not sprawl
            const jac = jaccard(a.fields, b.fields)
            if (jac < STRUCT_THRESHOLD) continue

            const [small, large] = a.fields.size <= b.fields.size ? [a, b] : [b, a]
            const fullyContained = coverage(small.fields, large.fields) >= 0.999
            const reverse = coverage(large.fields, small.fields)
            const relation: SprawlPair['relation'] =
                fullyContained && reverse < PROJECTION_REVERSE_COVERAGE ? 'projection' : 'near-duplicate'

            pairs.push({a, b, jaccard: jac, relation, crossCommunity: a.community !== b.community})
        }
    }
    return pairs.sort((p, q) => q.jaccard - p.jaccard)
}

function main(): void {
    const files = listTrackedTsFiles()
    const project = new Project({
        useInMemoryFileSystem: false,
        skipAddingFilesFromTsConfig: true,
        compilerOptions: {skipLibCheck: true, allowImportingTsExtensions: true},
    })
    const decls = extractTypeDecls(project, files)
    const pairs = findSprawl(decls)

    const sprawl = pairs.filter(p => p.relation === 'near-duplicate')
    const projections = pairs.filter(p => p.relation === 'projection')

    console.info(`scanned ${files.length} files, harvested ${decls.length} object-type decls (>= ${MIN_FIELDS} fields)`)
    console.info(`structural threshold: Jaccard >= ${STRUCT_THRESHOLD}\n`)

    console.info(`=== NEAR-DUPLICATE (accidental sprawl) — ${sprawl.length} pairs ===`)
    for (const p of sprawl) {
        const flag = p.crossCommunity ? 'XCOMM' : 'intra '
        const nameFlag = p.a.name === p.b.name ? 'same-name' : 'RENAMED'
        console.info(
            `  J=${p.jaccard.toFixed(2)} [${flag}] [${nameFlag}]  ` +
            `${p.a.name} ${p.a.file}:${p.a.line}  <->  ${p.b.name} ${p.b.file}:${p.b.line}`,
        )
    }

    console.info(`\n=== PROJECTION (likely deliberate subset, downweighted) — ${projections.length} pairs ===`)
    for (const p of projections.slice(0, 15)) {
        console.info(
            `  J=${p.jaccard.toFixed(2)}  ${p.a.name} ${p.a.file}:${p.a.line}  ⊂/⊃  ${p.b.name} ${p.b.file}:${p.b.line}`,
        )
    }
}

main()
