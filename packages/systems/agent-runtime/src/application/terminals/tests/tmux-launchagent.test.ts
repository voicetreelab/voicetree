import {join} from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'
import {
    ensureTmuxLaunchAgent,
    getTmuxCommandArgs,
    getTmuxSocketPath,
    renderPlist,
    resetTmuxLaunchAgentForTests,
    type TmuxLaunchAgentDeps,
} from '../tmux-launchagent.ts'

type FakeLaunchctlCall = {
    readonly args: readonly string[]
    readonly file: string
}

function makeDeps(files: Map<string, string>, launchctlLoaded: {value: boolean}): TmuxLaunchAgentDeps & {
    readonly calls: FakeLaunchctlCall[]
    readonly writes: string[]
} {
    const calls: FakeLaunchctlCall[] = []
    const writes: string[] = []
    const deps: TmuxLaunchAgentDeps & {calls: FakeLaunchctlCall[], writes: string[]} = {
        calls,
        writes,
        env: {},
        platform: 'darwin',
        homedir: () => '/Users/test',
        getuid: () => 501,
        existsSync: (path: string): boolean =>
            files.has(path) || path === '/opt/homebrew/bin/tmux' || path.endsWith('/tmux.sock'),
        mkdirSync: () => undefined,
        readFileSync: (path: string): string => {
            const value: string | undefined = files.get(path)
            if (value === undefined) throw new Error(`ENOENT: ${path}`)
            return value
        },
        writeFileSync: (path: string, data: string | NodeJS.ArrayBufferView): void => {
            files.set(path, String(data))
            writes.push(path)
        },
        rmSync: (path: string): void => {
            files.delete(path)
        },
        execFileSync: (file: string, args?: readonly string[] | undefined): string => {
            if (file === 'which' && args?.[0] === 'tmux') return '/opt/homebrew/bin/tmux\n'
            return ''
        },
        execFile: (file: string, args: readonly string[], callback): void => {
            calls.push({file, args})
            if (file === 'launchctl' && args[0] === 'print') {
                callback(launchctlLoaded.value ? null : new Error('not loaded'), '', '')
                return
            }
            if (file === 'launchctl' && args[0] === 'bootstrap') {
                launchctlLoaded.value = true
            }
            if (file === 'launchctl' && args[0] === 'bootout') {
                launchctlLoaded.value = false
            }
            callback(null, '', '')
        },
        sleep: async () => undefined,
    }
    return deps
}

describe('tmux-launchagent', () => {
    beforeEach(() => {
        resetTmuxLaunchAgentForTests()
    })

    it('renders an interactive keep-alive tmux LaunchAgent plist', () => {
        const plist: string = renderPlist({
            tmuxBin: '/opt/homebrew/bin/tmux',
            socketPath: '/Users/test/Library/Application Support/Voicetree/tmux.sock',
            logDir: '/Users/test/Library/Application Support/Voicetree/logs',
        })

        expect(plist).toMatchInlineSnapshot(`
          "<?xml version="1.0" encoding="UTF-8"?>
          <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
          <plist version="1.0">
          <dict>
            <key>Label</key><string>com.voicetree.tmux</string>
            <key>ProgramArguments</key>
            <array>
              <string>/opt/homebrew/bin/tmux</string>
              <string>-S</string><string>/Users/test/Library/Application Support/Voicetree/tmux.sock</string>
              <string>-f</string><string>/dev/null</string>
              <string>new-session</string><string>-d</string>
              <string>-s</string><string>__voicetree_root__</string>
              <string>--</string><string>sleep</string><string>infinity</string>
            </array>
            <key>ProcessType</key><string>Interactive</string>
            <key>RunAtLoad</key><true/>
            <key>KeepAlive</key><true/>
            <key>StandardOutPath</key><string>/Users/test/Library/Application Support/Voicetree/logs/tmux-server.out.log</string>
            <key>StandardErrorPath</key><string>/Users/test/Library/Application Support/Voicetree/logs/tmux-server.err.log</string>
          </dict>
          </plist>
          "
        `)
    })

    it('writes and bootstraps once, then treats a matching loaded plist as a no-op', async () => {
        const files = new Map<string, string>()
        const loaded = {value: false}
        const deps = makeDeps(files, loaded)
        const appSupportPath: string = '/Users/test/Library/Application Support/Voicetree'
        const plistPath: string = join('/Users/test/Library/LaunchAgents', 'com.voicetree.tmux.plist')

        await ensureTmuxLaunchAgent({appSupportPath, deps, forceInTests: true})
        await ensureTmuxLaunchAgent({appSupportPath, deps, forceInTests: true})

        expect(deps.writes).toEqual([plistPath])
        expect(deps.calls.map((call) => [call.file, ...call.args])).toEqual([
            ['launchctl', 'print', 'gui/501/com.voicetree.tmux'],
            ['launchctl', 'bootstrap', 'gui/501', plistPath],
            ['launchctl', 'print', 'gui/501/com.voicetree.tmux'],
        ])
    })

    it('builds socket-scoped tmux args from the app support path', () => {
        const appSupportPath: string = '/tmp/vt support'
        expect(getTmuxSocketPath(appSupportPath)).toBe('/tmp/vt support/tmux.sock')
        expect(getTmuxCommandArgs(['list-sessions'], getTmuxSocketPath(appSupportPath))).toEqual([
            '-S',
            '/tmp/vt support/tmux.sock',
            'list-sessions',
        ])
    })
})
