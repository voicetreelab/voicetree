import type {StructureManifest} from '@vt/graph-tools/node'
import {error} from '../../output.ts'
import {readGraphFileUtf8} from './filesystem.ts'
import type {GraphCreateNode, ParsedGraphCreateArgs} from './types.ts'
import {getErrorMessage} from './util.ts'

export {getErrorMessage, normalizeRef} from './util.ts'

function getRequiredValue(args: string[], index: number, flag: string): string {
    const value: string | undefined = args[index]
    if (!value) {
        error(`${flag} requires a value`)
    }

    return value
}

function titleToFilename(title: string): string {
    const normalizedTitle: string = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)

    return normalizedTitle || 'node'
}

function parseInlineNode(spec: string, color?: string): GraphCreateNode {
    const parts: string[] = spec.split('::')
    if (parts.length < 2) {
        error(`Invalid --node value "${spec}". Use title::summary or title::summary::content`)
    }

    const [rawTitle, rawSummary, ...rawContent] = parts
    const title: string = rawTitle.trim()
    const summary: string = rawSummary.trim()
    if (!title || !summary) {
        error(`Invalid --node value "${spec}". Title and summary must be non-empty`)
    }

    const node: GraphCreateNode = {
        filename: titleToFilename(title),
        title,
        summary,
    }

    const content: string = rawContent.join('::').trim()
    if (content) {
        node.content = content
    }
    if (color) {
        node.color = color
    }

    return node
}

function parsePositiveInteger(value: string, flag: string): number {
    const parsedValue: number = Number(value)
    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
        error(`${flag} must be a positive integer, received "${value}"`)
    }

    return parsedValue
}

function parseGraphIndexArgs(args: string[]): string {
    if (args.length !== 1) {
        error('Usage: vt graph index <vault-path>')
    }

    return args[0]
}

function parseGraphSearchArgs(args: string[]): {vaultPath: string; query: string; topK: number} {
    let topK: number = 10
    const positionalArgs: string[] = []

    for (let index: number = 0; index < args.length; index += 1) {
        const arg: string = args[index]
        if (arg === '--top-k') {
            topK = parsePositiveInteger(getRequiredValue(args, index + 1, '--top-k'), '--top-k')
            index += 1
            continue
        }

        if (arg.startsWith('--')) {
            error(`Unknown argument: ${arg}`)
        }

        positionalArgs.push(arg)
    }

    if (positionalArgs.length < 2) {
        error('Usage: vt graph search <vault-path> <query...> [--top-k N]')
    }

    return {
        vaultPath: positionalArgs[0],
        query: positionalArgs.slice(1).join(' ').trim(),
        topK,
    }
}

function inferManifestFormat(source: string, filePath: string): StructureManifest['format'] {
    const firstMeaningfulLine: string | undefined = source
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => line.length > 0)

    if (filePath.endsWith('.mmd') || filePath.endsWith('.mermaid')) {
        return 'mermaid'
    }

    if (firstMeaningfulLine && /^(?:graph|flowchart)\b/i.test(firstMeaningfulLine)) {
        return 'mermaid'
    }

    return 'ascii'
}

function parseGraphCreateArgs(args: string[]): ParsedGraphCreateArgs {
    let nodesFile: string | undefined
    const inlineNodeSpecs: string[] = []
    let parentValue: string | undefined
    let color: string | undefined
    const inputFilePaths: string[] = []
    let manifestPath: string | undefined
    let validateOnly: boolean = false

    for (let index: number = 0; index < args.length; index += 1) {
        const arg: string = args[index]

        if (arg === '--nodes-file') {
            nodesFile = getRequiredValue(args, index + 1, '--nodes-file')
            index += 1
            continue
        }

        if (arg === '--node') {
            inlineNodeSpecs.push(getRequiredValue(args, index + 1, '--node'))
            index += 1
            continue
        }

        if (arg === '--parent') {
            parentValue = getRequiredValue(args, index + 1, '--parent')
            index += 1
            continue
        }

        if (arg === '--color') {
            color = getRequiredValue(args, index + 1, '--color')
            index += 1
            continue
        }

        if (arg === '--manifest') {
            manifestPath = getRequiredValue(args, index + 1, '--manifest')
            index += 1
            continue
        }

        if (arg === '--validate-only') {
            validateOnly = true
            continue
        }

        if (arg.startsWith('--')) {
            error(`Unknown argument: ${arg}`)
        }

        inputFilePaths.push(arg)
    }

    if (inputFilePaths.length > 0 || manifestPath) {
        if (nodesFile || inlineNodeSpecs.length > 0) {
            error('Use either filesystem markdown inputs or the live --nodes-file/--node flags, not both')
        }

        if (inputFilePaths.length === 0) {
            error('graph create --manifest requires at least one markdown file input')
        }

        const manifest: StructureManifest | undefined = manifestPath
            ? (() => {
                let source: string
                try {
                    source = readGraphFileUtf8(manifestPath)
                } catch (readError: unknown) {
                    error(`Failed to read manifest file ${manifestPath}: ${getErrorMessage(readError)}`)
                }

                return {
                    format: inferManifestFormat(source, manifestPath),
                    source,
                }
            })()
            : undefined

        return {
            mode: 'filesystem',
            inputFilePaths,
            validateOnly,
            ...(parentValue ? {parentPath: parentValue} : {}),
            ...(color ? {color} : {}),
            ...(manifest ? {manifest} : {}),
        }
    }

    return {
        mode: 'live',
        ...(nodesFile ? {nodesFile} : {}),
        inlineNodeSpecs,
        validateOnly,
        ...(parentValue ? {parentNodeId: parentValue} : {}),
        ...(color ? {color} : {}),
    }
}

function requireTerminalId(terminalId: string | undefined): string {
    if (!terminalId) {
        error('This command requires --terminal or VOICETREE_TERMINAL_ID')
    }

    return terminalId
}

export {
    getRequiredValue,
    inferManifestFormat,
    parseGraphCreateArgs,
    parseGraphIndexArgs,
    parseGraphSearchArgs,
    parseInlineNode,
    parsePositiveInteger,
    requireTerminalId,
    titleToFilename,
}
