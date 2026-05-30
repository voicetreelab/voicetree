import {execFile} from 'node:child_process'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {promisify} from 'node:util'
import {afterEach, describe, expect, it} from 'vitest'
import {
    ensureTmuxServer,
    getTmuxBinaryPath,
    getTmuxCommandArgs,
    shutdownTmuxServer,
} from './tmux-server.ts'

const execFileAsync = promisify(execFile)

// A real tmux server is started on an isolated socket per test, so these assert
// the observable end state of the OSC 52 clipboard bridge rather than mocking
// internals: copy from a pane (e.g. an agent SSH'd into a remote box) only reaches
// the user's local clipboard when tmux is willing to forward inner OSC 52 outward.
async function showServerOption(socketPath: string, option: string): Promise<string> {
    const {stdout} = await execFileAsync(
        getTmuxBinaryPath(),
        getTmuxCommandArgs(['show', '-sv', option], socketPath),
    )
    return stdout.trim()
}

describe('ensureTmuxServer clipboard bridge', () => {
    let homePath: string | null = null
    let socketPath: string | null = null

    afterEach(async () => {
        if (homePath && socketPath) {
            await shutdownTmuxServer({voicetreeHomePath: homePath, socketPath})
        }
        if (homePath) {
            await rm(homePath, {recursive: true, force: true})
        }
        homePath = null
        socketPath = null
    })

    it('sets set-clipboard to on so inner-pane OSC 52 sequences are forwarded to the client', async () => {
        homePath = await mkdtemp(join(tmpdir(), 'vt-clip-'))
        socketPath = join(homePath, 'tmux.sock')

        await ensureTmuxServer({voicetreeHomePath: homePath, socketPath})

        // Default is `external`, which drops application OSC 52. `on` forwards it.
        expect(await showServerOption(socketPath, 'set-clipboard')).toBe('on')
    })

    it('advertises the xterm-256color clipboard terminal-feature for the relay client', async () => {
        homePath = await mkdtemp(join(tmpdir(), 'vt-clip-'))
        socketPath = join(homePath, 'tmux.sock')

        await ensureTmuxServer({voicetreeHomePath: homePath, socketPath})

        // The relay attaches as xterm-256color; tmux only forwards OSC 52 to a
        // client whose terminal is tagged clipboard-capable.
        expect(await showServerOption(socketPath, 'terminal-features')).toContain('xterm-256color:clipboard')
    })
})
