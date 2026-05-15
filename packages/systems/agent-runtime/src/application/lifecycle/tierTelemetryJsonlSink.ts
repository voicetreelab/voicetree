/**
 * Edge helper: append every recorded tier event to a JSONL file under
 * VOICETREE_APP_SUPPORT/lifecycle-telemetry.jsonl. Fire-and-forget — failures
 * never block the hot path.
 *
 * Useful for offline analysis once the in-memory ring (10k events) starts
 * dropping older ones. To analyse:
 *   tail -f <APP_SUPPORT>/lifecycle-telemetry.jsonl | jq ...
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {configureTelemetrySink, type TierEvent} from './tierTelemetry'

export type JsonlSinkDeps = {
    readonly appendFile: (filePath: string, line: string) => void
    readonly mkdirSync: (dir: string) => void
}

const defaultDeps: JsonlSinkDeps = {
    appendFile: (filePath: string, line: string): void => {
        // fire-and-forget; errors are swallowed inside fs.appendFile's callback.
        fs.appendFile(filePath, line, () => undefined)
    },
    mkdirSync: (dir: string): void => {
        try {
            fs.mkdirSync(dir, {recursive: true})
        } catch {
            // best-effort; if creation fails, the appendFile call will silently fail too.
        }
    },
}

/**
 * Install a JSONL file sink for tier telemetry. The directory containing
 * `filePath` is created (recursive) on first call. After this returns,
 * every `recordTierEvent` invocation appends one JSON line to the file.
 *
 * Returns an `uninstall` function that clears the sink.
 */
export function installJsonlTelemetrySink(
    filePath: string,
    deps: JsonlSinkDeps = defaultDeps,
): () => void {
    deps.mkdirSync(path.dirname(filePath))
    configureTelemetrySink((event: TierEvent): void => {
        deps.appendFile(filePath, JSON.stringify(event) + '\n')
    })
    return (): void => configureTelemetrySink(null)
}
