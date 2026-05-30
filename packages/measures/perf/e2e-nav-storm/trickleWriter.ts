/**
 * Background trickle writer — the perturbation load for e2e-nav-storm.
 *
 * Writes one new markdown node into the daemon-watched project tree every
 * `intervalMs`, so the graph GROWS while it is being navigated. This is the
 * production node-birth path: VoiceTree's daemon is a live view of a markdown
 * folder, and its chokidar watcher ingests a newly-written `.md` exactly as it
 * ingests an agent- or user-authored node — there is no synthetic graph
 * mutation or test-only bypass here. Each node links to an existing seed node so
 * it attaches into the graph rather than floating as an isolated root.
 *
 * Ingestion is verified downstream (the renderer probe's cytoscape `add` count
 * + the on-disk file delta), per the harness validation bar.
 *
 * Impure shell: fs writes on a timer.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

const TRICKLE_SUBDIR = 'nav-storm-trickle'

export interface TrickleWriter {
    /** Stop the timer and return what was written. */
    readonly stop: () => { readonly nodesWritten: number; readonly paths: readonly string[] }
}

function buildTrickleNodeContent(id: string, index: number, linkBasename: string): string {
    const frontmatter = ['---', 'isContextNode: false', '---'].join('\n')
    const body = [
        `# Trickle node ${index}`,
        '',
        `This is ${id}, written into the live project while the graph is being navigated.`,
        '',
        '-----------------',
        '_Links:_',
        '',
        `[[${linkBasename}]]`,
        '',
    ].join('\n')
    return `${frontmatter}\n${body}\n`
}

export interface TrickleWriterInputs {
    readonly projectDir: string
    readonly intervalMs: number
    /** Relative path of an existing seed node to link new nodes to. */
    readonly linkTargetRelativePath: string
    readonly nowEpoch?: () => number
}

/**
 * Start writing trickle nodes immediately and then every `intervalMs`. The
 * first node lands right away so even a short nav window observes growth.
 */
export function startTrickleWriter(inputs: TrickleWriterInputs): TrickleWriter {
    const now = inputs.nowEpoch ?? (() => Date.now())
    const dir = path.join(inputs.projectDir, TRICKLE_SUBDIR)
    mkdirSync(dir, { recursive: true })
    const linkBasename = path.basename(inputs.linkTargetRelativePath)

    const paths: string[] = []
    const writeOne = (): void => {
        const index = paths.length
        const id = `trickle-${index}-${now()}`
        const filePath = path.join(dir, `${id}.md`)
        writeFileSync(filePath, buildTrickleNodeContent(id, index, linkBasename), 'utf8')
        paths.push(filePath)
    }

    writeOne()
    const timer = setInterval(writeOne, inputs.intervalMs)
    timer.unref()

    return {
        stop: () => {
            clearInterval(timer)
            return { nodesWritten: paths.length, paths: [...paths] }
        },
    }
}
