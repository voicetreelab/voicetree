import {readFile} from 'node:fs/promises'

import {extractVitestFailureDetails, vitestOutputFileFromArgs} from '../_shared/writers/vitest-failure-details.ts'

type WarningSink = (message: string) => void

export async function vitestFailureDetailsForCommand(args: readonly string[], warn: WarningSink, context: string): Promise<Record<string, unknown>> {
    const outputFile = vitestOutputFileFromArgs(args)
    if (outputFile === null) return {}

    let raw: string
    try {
        raw = await readFile(outputFile, 'utf8')
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
        const message = messageOf(err)
        warn(`[${context}] failed to read Vitest JSON failure details from ${outputFile}: ${message}`)
        return {failureDetailsError: message}
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(raw) as unknown
    } catch (err) {
        const message = messageOf(err)
        warn(`[${context}] failed to parse Vitest JSON failure details from ${outputFile}: ${message}`)
        return {failureDetailsError: `malformed Vitest JSON: ${message}`}
    }

    return extractVitestFailureDetails(parsed) ?? {}
}

function messageOf(value: unknown): string {
    if (value instanceof Error) return value.message || value.stack || String(value)
    if (typeof value === 'object' && value !== null && 'message' in value) {
        return String((value as {message?: unknown}).message ?? value)
    }
    return String(value)
}
