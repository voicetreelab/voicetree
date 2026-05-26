type ParsedNode = {
    readonly kind: 'virtualFolder' | 'folderNote' | 'file'
    readonly title: string
    readonly folderPath: string
    readonly line: number
}

type ParsedInlineEdge = {
    readonly srcLine: number
    readonly srcTitle: string
    readonly srcFolderPath: string
    readonly targetTitle: string
}

type ParsedFooterEdge = {
    readonly srcId: string
    readonly targetId: string
    readonly unresolved: boolean
}

type ParseResult = {
    readonly nodes: readonly ParsedNode[]
    readonly inlineEdges: readonly ParsedInlineEdge[]
    readonly footerEdges: readonly ParsedFooterEdge[]
    readonly footerStartLine: number | null
    readonly droppedLines: readonly string[]
}

const BRANCH_RE: RegExp = /^(?<indent>(?:│\s{3}|\s{4})*)(?:├──\s|└──\s)?(?<rest>.*)$/
const VF_RE: RegExp = /^▢\s(?<name>.+?)\/(?:\s\[collapsed.*\])?$/
const FN_RE: RegExp = /^(?:★\s)?▣\s(?<foldernoteTitle>.+?)\/\s{2}—\s(?<h1>.+?)(?:\s\[collapsed\s⊟\s\d+\s.*\])?$/
const FILE_RE: RegExp = /^(?:★\s)?·\s(?<title>.+)$/
const CROSS_RE: RegExp = /^⇢\s(?<target>.+)$/

function indentDepth(indent: string): number {
    // Each branch segment (`│   ` or `    `) is 4 chars.
    return indent.length / 4
}

export type {ParsedFooterEdge, ParsedInlineEdge, ParsedNode, ParseResult}

export function parseAscii(ascii: string): ParseResult {
    const lines: string[] = ascii.split('\n')
    const nodes: ParsedNode[] = []
    const inlineEdges: ParsedInlineEdge[] = []
    const footerEdges: ParsedFooterEdge[] = []
    const dropped: string[] = []

    const folderStack: string[] = []
    let lastFileLike: {title: string; folderPath: string; line: number} | null = null
    let inCrossLinks = false
    let footerStartLine: number | null = null

    for (let i = 0; i < lines.length; i++) {
        const raw: string = lines[i]!
        const trimmed: string = raw.trim()

        if (inCrossLinks) {
            if (trimmed === '' || raw.startsWith('Legend:')) {
                inCrossLinks = false
                if (raw.startsWith('Legend:')) continue
                continue
            }
            const separatorIndex: number = raw.indexOf(' -> ')
            if (separatorIndex < 0) {
                dropped.push(`footer:${i}:${raw}`)
                continue
            }
            const srcId: string = raw.slice(0, separatorIndex).trim()
            const targetText: string = raw.slice(separatorIndex + 4).trim()
            if (!srcId || !targetText) {
                dropped.push(`footer:${i}:${raw}`)
                continue
            }
            footerEdges.push({
                srcId,
                targetId: targetText.startsWith('?') ? targetText.slice(1) : targetText,
                unresolved: targetText.startsWith('?'),
            })
            continue
        }

        if (trimmed === '') continue
        if (trimmed === '[Cross-Links]') {
            inCrossLinks = true
            footerStartLine = i
            lastFileLike = null
            continue
        }
        if (raw.startsWith('Legend:')) continue

        const m: RegExpMatchArray | null = raw.match(BRANCH_RE)
        if (!m?.groups) { dropped.push(`${i}:${raw}`); continue }
        const indent: string = m.groups.indent!
        const rest: string = m.groups.rest!
        const hasBranch: boolean = /^(?:│\s{3}|\s{4})*(?:├──\s|└──\s)/.test(raw)
        const depth: number = hasBranch ? indentDepth(indent) + 1 : indentDepth(indent)

        const crossM: RegExpMatchArray | null = rest.match(CROSS_RE)
        if (crossM?.groups) {
            if (!lastFileLike) { dropped.push(`cross-without-source:${i}:${raw}`); continue }
            inlineEdges.push({
                srcLine: lastFileLike.line,
                srcTitle: lastFileLike.title,
                srcFolderPath: lastFileLike.folderPath,
                targetTitle: crossM.groups.target!,
            })
            continue
        }

        const vfM: RegExpMatchArray | null = rest.match(VF_RE)
        if (vfM?.groups) {
            folderStack.length = depth
            folderStack[depth] = vfM.groups.name!
            const folderPath: string = folderStack.slice(0, depth).join('/')
            nodes.push({kind: 'virtualFolder', title: vfM.groups.name!, folderPath, line: i})
            lastFileLike = null
            continue
        }

        const fnM: RegExpMatchArray | null = rest.match(FN_RE)
        if (fnM?.groups) {
            folderStack.length = depth
            folderStack[depth] = fnM.groups.foldernoteTitle!
            // Folder note file LIVES IN the folder it names: path includes its own name.
            const folderPath: string = folderStack.slice(0, depth + 1).join('/')
            nodes.push({kind: 'folderNote', title: fnM.groups.h1!, folderPath, line: i})
            lastFileLike = {title: fnM.groups.h1!, folderPath, line: i}
            continue
        }

        const fileM: RegExpMatchArray | null = rest.match(FILE_RE)
        if (fileM?.groups) {
            const folderPath: string = folderStack.slice(0, depth).join('/')
            nodes.push({kind: 'file', title: fileM.groups.title!, folderPath, line: i})
            lastFileLike = {title: fileM.groups.title!, folderPath, line: i}
            continue
        }

        dropped.push(`${i}:${raw}`)
    }

    return {nodes, inlineEdges, footerEdges, footerStartLine, droppedLines: dropped}
}
