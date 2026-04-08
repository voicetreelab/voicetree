import path from 'path'

export type ComplexityScore = 'low' | 'medium' | 'high'

export type BuildMarkdownBodyParams = {
    readonly title: string
    readonly summary: string
    readonly content: string | undefined
    readonly codeDiffs: readonly string[] | undefined
    readonly filesChanged: readonly string[] | undefined
    readonly diagram: string | undefined
    readonly notes: readonly string[] | undefined
    readonly linkedArtifacts: readonly string[] | undefined
    readonly complexityScore: ComplexityScore | undefined
    readonly complexityExplanation: string | undefined
    readonly color: string
    readonly agentName: string
    readonly parentLinks: readonly { baseName: string; edgeLabel: string | undefined }[]
}

export type StructureManifest = {
    readonly format: 'ascii' | 'mermaid'
    readonly source: string
}

export type FilesystemAuthoringInput = {
    readonly filename: string
    readonly markdown: string
}

export type FilesystemAuthoringValidationError = {
    readonly code: 'duplicate_target' | 'missing_ref' | 'invalid_manifest'
    readonly message: string
    readonly filename?: string
    readonly ref?: string
}

export type FilesystemAuthoringPlanEntry = {
    readonly filename: string
    readonly parentFilenames: readonly string[]
    readonly markdown: string
}

export type FilesystemAuthoringPlanResult =
    | {
        readonly status: 'ok'
        readonly writePlan: readonly FilesystemAuthoringPlanEntry[]
    }
    | {
        readonly status: 'invalid'
        readonly errors: readonly FilesystemAuthoringValidationError[]
    }

type IndexedInput = {
    readonly filename: string
    readonly ref: string
    readonly markdown: string
}

type ParsedManifest = {
    readonly refsInOrder: readonly string[]
    readonly parentsByRef: ReadonlyMap<string, readonly string[]>
}

function normalizeArtifactMarkdownLink(artifact: string): { readonly label: string; readonly href: string } {
    const trimmed: string = artifact.trim()
    const href: string = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`
    const label: string = trimmed.replace(/\.md$/, '')
    return {label, href}
}

export function buildMarkdownBody(params: BuildMarkdownBodyParams): string {
    const sections: string[] = []

    sections.push('---')
    sections.push(`color: ${params.color}`)
    sections.push(`agent_name: ${params.agentName}`)
    sections.push('---')
    sections.push('')

    sections.push(`# ${params.title}`)
    sections.push('')

    sections.push(params.summary)
    sections.push('')

    if (params.content) {
        sections.push(params.content)
        sections.push('')
    }

    if (params.codeDiffs && params.codeDiffs.length > 0) {
        sections.push('## DIFF')
        sections.push('')
        for (const diff of params.codeDiffs) {
            sections.push('```')
            sections.push(diff)
            sections.push('```')
            sections.push('')
        }
    }

    if (params.complexityScore && params.complexityExplanation) {
        sections.push(`## Complexity: ${params.complexityScore}`)
        sections.push('')
        sections.push(params.complexityExplanation)
        sections.push('')
    }

    if (params.filesChanged && params.filesChanged.length > 0) {
        sections.push('## Files Changed')
        sections.push('')
        for (const filePath of params.filesChanged) {
            sections.push(`- ${filePath}`)
        }
        sections.push('')
    }

    if (params.diagram) {
        sections.push('## Diagram')
        sections.push('')
        sections.push('```mermaid')
        sections.push(params.diagram)
        sections.push('```')
        sections.push('')
    }

    if (params.notes && params.notes.length > 0) {
        sections.push('### NOTES')
        sections.push('')
        for (const note of params.notes) {
            sections.push(`- ${note}`)
        }
        sections.push('')
    }

    if (params.linkedArtifacts && params.linkedArtifacts.length > 0) {
        sections.push('## Related')
        sections.push('')
        for (const artifact of params.linkedArtifacts) {
            const {label, href}: { readonly label: string; readonly href: string } =
                normalizeArtifactMarkdownLink(artifact)
            sections.push(`- [${label}](${href})`)
        }
        sections.push('')
    }

    for (const parent of params.parentLinks) {
        if (parent.edgeLabel) {
            sections.push(`${parent.edgeLabel} [[${parent.baseName}]]`)
        } else {
            sections.push(`[[${parent.baseName}]]`)
        }
    }
    sections.push('')

    return sections.join('\n')
}

export function buildFilesystemAuthoringPlan(params: {
    readonly inputs: readonly FilesystemAuthoringInput[]
    readonly manifest?: StructureManifest
    readonly agentName?: string
    readonly defaultColor?: string
}): FilesystemAuthoringPlanResult {
    const indexedInputs: IndexedInput[] = []
    const duplicateErrors: FilesystemAuthoringValidationError[] = []
    const seenFilenames: Set<string> = new Set()

    for (const input of params.inputs) {
        const filename: string = normalizeFilename(input.filename)
        if (seenFilenames.has(filename)) {
            duplicateErrors.push({
                code: 'duplicate_target',
                message: `Duplicate target filename: ${filename}`,
                filename,
            })
            continue
        }

        seenFilenames.add(filename)
        indexedInputs.push({
            filename,
            ref: normalizeRef(filename),
            markdown: normalizeMarkdown(input.markdown),
        })
    }

    if (duplicateErrors.length > 0) {
        return {status: 'invalid', errors: duplicateErrors}
    }

    const inputsByRef: Map<string, IndexedInput> = new Map(indexedInputs.map(input => [input.ref, input]))
    let parsedManifest: ParsedManifest | undefined

    if (params.manifest) {
        parsedManifest = parseStructureManifest(params.manifest)
        if ('code' in parsedManifest) {
            return {status: 'invalid', errors: [parsedManifest]}
        }

        const missingRefs: FilesystemAuthoringValidationError[] = parsedManifest.refsInOrder
            .filter(ref => !inputsByRef.has(ref))
            .map(ref => ({
                code: 'missing_ref' as const,
                message: `Manifest references missing target: ${ref}`,
                ref,
            }))

        if (missingRefs.length > 0) {
            return {status: 'invalid', errors: missingRefs}
        }
    }

    const writePlan: FilesystemAuthoringPlanEntry[] = indexedInputs.map((input) => {
        const parentRefs: readonly string[] = parsedManifest?.parentsByRef.get(input.ref) ?? []
        return {
            filename: input.filename,
            parentFilenames: parentRefs.map((parentRef) => inputsByRef.get(parentRef)!.filename),
            markdown: assembleMarkdown({
                markdown: input.markdown,
                parentRefs,
                agentName: params.agentName,
                defaultColor: params.defaultColor,
            }),
        }
    })

    return {status: 'ok', writePlan}
}

function parseStructureManifest(
    manifest: StructureManifest
): ParsedManifest | FilesystemAuthoringValidationError {
    switch (manifest.format) {
        case 'ascii':
            return parseAsciiManifest(manifest.source)
        case 'mermaid':
            return parseMermaidManifest(manifest.source)
        default:
            return invalidManifest(`Unsupported manifest format: ${(manifest as {format?: string}).format ?? 'unknown'}`)
    }
}

function parseAsciiManifest(source: string): ParsedManifest | FilesystemAuthoringValidationError {
    const lines: string[] = source
        .split(/\r?\n/)
        .map(line => line.replace(/\s+$/u, ''))
        .filter(line => line.trim().length > 0)

    if (lines.length === 0) {
        return invalidManifest('ASCII manifest is empty.')
    }

    const refsInOrder: string[] = []
    const parentsByRef: Map<string, string[]> = new Map()
    const stack: string[] = []

    for (const [index, line] of lines.entries()) {
        const match: RegExpExecArray | null = /^((?:│   |    )*)(?:(├── |└── ))?(.+)$/.exec(line)
        if (!match) {
            return invalidManifest(`Malformed ASCII manifest line: ${line}`)
        }

        const indent: string = match[1] ?? ''
        const branch: string | undefined = match[2]
        const ref: string = normalizeRef(match[3] ?? '')

        if (!ref) {
            return invalidManifest(`ASCII manifest line is missing a target reference: ${line}`)
        }

        if (index === 0) {
            if (indent.length > 0 || branch) {
                return invalidManifest('ASCII manifest root must be unindented and unbranched.')
            }
        } else if (!branch) {
            return invalidManifest(`ASCII manifest line is missing a branch marker: ${line}`)
        }

        const depth: number = indent.length / 4 + (branch ? 1 : 0)
        if (!Number.isInteger(depth) || depth > stack.length) {
            return invalidManifest(`ASCII manifest has an invalid indentation jump at: ${line}`)
        }
        if (index > 0 && depth === 0) {
            return invalidManifest('ASCII manifest must describe a single rooted tree.')
        }
        if (parentsByRef.has(ref)) {
            return {
                code: 'duplicate_target',
                message: `ASCII manifest references the same target more than once: ${ref}`,
                ref,
            }
        }

        stack.length = depth
        refsInOrder.push(ref)
        parentsByRef.set(ref, [])

        if (depth > 0) {
            const parentRef: string | undefined = stack[depth - 1]
            if (!parentRef) {
                return invalidManifest(`ASCII manifest is missing a parent for: ${ref}`)
            }
            parentsByRef.get(ref)!.push(parentRef)
        }

        stack[depth] = ref
    }

    return {refsInOrder, parentsByRef}
}

function parseMermaidManifest(source: string): ParsedManifest | FilesystemAuthoringValidationError {
    const lines: string[] = source
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0)

    if (lines.length === 0) {
        return invalidManifest('Mermaid manifest is empty.')
    }

    const refsInOrder: string[] = []
    const parentsByRef: Map<string, string[]> = new Map()
    let parsedEdgeCount: number = 0

    for (const [index, line] of lines.entries()) {
        if (index === 0 && /^(?:graph|flowchart)\b/i.test(line)) {
            continue
        }
        if (line.startsWith('%%')) {
            continue
        }

        const match: RegExpExecArray | null = /^([A-Za-z0-9_./-]+)\s*-->\s*([A-Za-z0-9_./-]+)$/.exec(line)
        if (!match) {
            return invalidManifest(`Malformed Mermaid manifest line: ${line}`)
        }

        const parentRef: string = normalizeRef(match[1] ?? '')
        const childRef: string = normalizeRef(match[2] ?? '')

        if (!parentRef || !childRef) {
            return invalidManifest(`Mermaid manifest line is missing a target reference: ${line}`)
        }

        ensureManifestRef(refsInOrder, parentsByRef, parentRef)
        ensureManifestRef(refsInOrder, parentsByRef, childRef)

        const parentRefs: string[] = parentsByRef.get(childRef)!
        if (!parentRefs.includes(parentRef)) {
            parentRefs.push(parentRef)
        }

        parsedEdgeCount += 1
    }

    if (parsedEdgeCount === 0) {
        return invalidManifest('Mermaid manifest must contain at least one edge.')
    }

    return {refsInOrder, parentsByRef}
}

function ensureManifestRef(refsInOrder: string[], parentsByRef: Map<string, string[]>, ref: string): void {
    if (parentsByRef.has(ref)) {
        return
    }

    refsInOrder.push(ref)
    parentsByRef.set(ref, [])
}

function assembleMarkdown(params: {
    readonly markdown: string
    readonly parentRefs: readonly string[]
    readonly agentName?: string
    readonly defaultColor?: string
}): string {
    const {frontmatterLines, body} = splitFrontmatter(params.markdown)
    const mergedFrontmatterLines: string[] = mergeFrontmatter(frontmatterLines, {
        color: params.defaultColor,
        agent_name: params.agentName,
    })

    const sections: string[] = []
    if (mergedFrontmatterLines.length > 0) {
        sections.push(['---', ...mergedFrontmatterLines, '---'].join('\n'))
    }

    const trimmedBody: string = body.trimEnd()
    if (trimmedBody) {
        sections.push(trimmedBody)
    }

    const existingParentRefs: Set<string> = extractExistingParentRefs(trimmedBody)
    const parentLines: string[] = params.parentRefs
        .filter(ref => !existingParentRefs.has(ref))
        .map(ref => `- parent [[${ref}]]`)

    if (parentLines.length > 0) {
        sections.push(parentLines.join('\n'))
    }

    return sections.length > 0 ? `${sections.join('\n\n')}\n` : ''
}

function splitFrontmatter(markdown: string): { readonly frontmatterLines: readonly string[]; readonly body: string } {
    if (!markdown.startsWith('---\n')) {
        return {frontmatterLines: [], body: markdown}
    }

    const lines: string[] = markdown.split('\n')
    const closingIndex: number = lines.findIndex((line, index) => index > 0 && line === '---')
    if (closingIndex === -1) {
        return {frontmatterLines: [], body: markdown}
    }

    const body: string = lines.slice(closingIndex + 1).join('\n').replace(/^\n/, '')
    return {
        frontmatterLines: lines.slice(1, closingIndex),
        body,
    }
}

function mergeFrontmatter(
    frontmatterLines: readonly string[],
    additions: Readonly<Record<string, string | undefined>>
): string[] {
    const mergedFrontmatterLines: string[] = [...frontmatterLines]
    const existingKeys: Set<string> = new Set(
        frontmatterLines
            .map(line => /^([A-Za-z0-9_-]+):/.exec(line)?.[1])
            .filter((key): key is string => Boolean(key))
    )

    for (const [key, value] of Object.entries(additions)) {
        if (!value || existingKeys.has(key)) {
            continue
        }
        mergedFrontmatterLines.push(`${key}: ${value}`)
    }

    return mergedFrontmatterLines
}

function extractExistingParentRefs(markdown: string): Set<string> {
    const refs: Set<string> = new Set()

    for (const match of markdown.matchAll(/^- parent \[\[([^[\]]+)\]\]$/gm)) {
        const ref: string = normalizeRef(match[1] ?? '')
        if (ref) {
            refs.add(ref)
        }
    }

    return refs
}

function normalizeFilename(filename: string): string {
    const normalized: string = path.posix.normalize(filename.replace(/\\/g, '/'))
    return normalized.replace(/^(?:\.\/)+/, '')
}

function normalizeRef(ref: string): string {
    return normalizeFilename(ref.trim()).replace(/\.md$/i, '')
}

function normalizeMarkdown(markdown: string): string {
    return markdown.replace(/\r\n/g, '\n')
}

function invalidManifest(message: string): FilesystemAuthoringValidationError {
    return {
        code: 'invalid_manifest',
        message,
    }
}
