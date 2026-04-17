/** Shared CLI argument parsing utilities for vt-graph. */

function fail(message: string): never {
    process.stderr.write(`${message}\n`)
    process.exit(1)
}

export function parsePrettyValue(value: string): boolean {
    if (value === 'true') return true
    if (value === 'false') return false
    fail(`Invalid value for --pretty: ${value}. Use true or false.`)
}

export function parseStateDumpArgs(
    parsedArgs: string[],
): {rootPath: string; pretty: boolean; outFile?: string} {
    let rootPath: string | undefined
    let pretty = true
    let outFile: string | undefined

    for (let i = 0; i < parsedArgs.length; i++) {
        const arg = parsedArgs[i]

        if (arg === '--pretty') { pretty = true; continue }
        if (arg === '--no-pretty') { pretty = false; continue }
        if (arg.startsWith('--pretty=')) { pretty = parsePrettyValue(arg.slice('--pretty='.length)); continue }

        if (arg === '--out') {
            const next = parsedArgs[i + 1]
            if (!next || next.startsWith('--')) fail('--out requires a value')
            outFile = next
            i += 1
            continue
        }
        if (arg.startsWith('--out=')) {
            outFile = arg.slice('--out='.length)
            if (!outFile) fail('--out requires a value')
            continue
        }

        if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
        if (rootPath !== undefined) fail(`Unexpected argument: ${arg}`)
        rootPath = arg
    }

    if (rootPath === undefined) {
        fail('Usage: vt-graph state dump <root> [--pretty|--no-pretty] [--out <file>]')
    }

    return {rootPath, pretty, ...(outFile ? {outFile} : {})}
}
