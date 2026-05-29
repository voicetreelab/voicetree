#!/usr/bin/env -S node --import tsx
// vt-resume: terminal-side equivalent of the Voicetree "Surviving Agents"
// panel. Lists recoverable Claude/Codex agent sessions in a vault, and
// resumes a chosen one — spawning the tmux-backed terminal and execing
// `tmux attach-session` to drop the user into the live pane.
//
// Designed for testing the resume path without the Electron renderer:
//   1. `vt-resume list`              → enumerate surviving agents
//   2. `vt-resume resume <id>`       → resume + attach in this terminal
//
// Vault / project root resolution (in order):
//   --vault <path>            explicit vault path
//   $VOICETREE_VAULT_PATH     env var set by Voicetree-spawned terminals
//   walk up from cwd          looks for a `.voicetree` directory
//
// The discovery + resume code paths are the same ones the Electron main
// process uses; only the UI launch step is replaced with `tmux attach`.

import {existsSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {spawnSync} from 'node:child_process'

import {configureAgentRuntime} from '../src/application/runtime/runtime-config.ts'
import {discoverRecoverableAgentSessions} from '../src/application/recovery/discovery.ts'
import {resumePersistedAgentSession} from '../src/application/recovery/sessions/resumePersistedAgentSession.ts'
import type {RecoverableAgentSession} from '../src/application/recovery/types.ts'
import {buildTmuxSessionName} from '../src/application/terminals/tmux/tmux-session-manager.ts'

type Cmd = 'list' | 'resume'

type Args = {
    readonly cmd: Cmd
    readonly terminalId?: string
    readonly vault?: string
    readonly projectRoot?: string
    readonly noAttach: boolean
}

function die(msg: string, code: number = 1): never {
    process.stderr.write(`vt-resume: ${msg}\n`)
    process.exit(code)
}

function usage(): never {
    process.stderr.write(
        [
            'usage:',
            '  vt-resume list                          List recoverable agents',
            '  vt-resume resume <terminalId>           Resume an agent and attach to tmux',
            '',
            'Flags:',
            '  --vault <path>           Vault directory (default: $VOICETREE_VAULT_PATH or auto-detect)',
            '  --project-root <path>    Watched parent dir (default: parent of vault)',
            '  --no-attach              For `resume`: spawn the tmux session but do not exec attach',
            '',
        ].join('\n'),
    )
    process.exit(2)
}

function parseArgs(argv: readonly string[]): Args {
    let cmd: Cmd | null = null
    let terminalId: string | undefined
    let vault: string | undefined
    let projectRoot: string | undefined
    let noAttach: boolean = false
    for (let i = 0; i < argv.length; i++) {
        const a: string = argv[i]
        if (a === '--vault') {
            vault = argv[++i]
            continue
        }
        if (a === '--project-root') {
            projectRoot = argv[++i]
            continue
        }
        if (a === '--no-attach') {
            noAttach = true
            continue
        }
        if (a === '-h' || a === '--help') usage()
        if (cmd === null && (a === 'list' || a === 'resume')) {
            cmd = a
            continue
        }
        if (cmd === 'resume' && terminalId === undefined) {
            terminalId = a
            continue
        }
        die(`unrecognized argument: ${a}`, 2)
    }
    if (cmd === null) usage()
    if (cmd === 'resume' && !terminalId) usage()
    return {cmd, terminalId, vault, projectRoot, noAttach}
}

// A vault directory has `.voicetree/terminals/` but no daemon lock; the
// project-root `.voicetree` is the one holding `graphd.owner.json` (written
// by the graph-db-server daemon). The CLI must use the project-root form so
// tmux namespace hashing matches what the running Voicetree process used.
function isProjectRootVoicetreeDir(dotVoicetree: string): boolean {
    return existsSync(join(dotVoicetree, 'graphd.owner.json'))
        || existsSync(join(dotVoicetree, 'graphd.lock'))
}

function findUpForProjectRoot(start: string): string | null {
    let dir: string = resolve(start)
    while (true) {
        const candidate: string = join(dir, '.voicetree')
        if (existsSync(candidate) && isProjectRootVoicetreeDir(candidate)) return dir
        const parent: string = dirname(dir)
        if (parent === dir) return null
        dir = parent
    }
}

type ResolvedPaths = {
    readonly vault: string
    readonly projectRoot: string
}

function resolvePaths(args: Args): ResolvedPaths {
    const envVault: string | undefined = process.env.VOICETREE_VAULT_PATH
    const envProjectDir: string | undefined = process.env.VOICETREE_PROJECT_DIR // ends in `/.voicetree`

    const vault: string = args.vault
        ? resolve(args.vault)
        : envVault
            ? resolve(envVault)
            : (findUpForProjectRoot(process.cwd()) ?? die('cannot locate a vault. Pass --vault or set VOICETREE_VAULT_PATH.'))

    const projectRoot: string = args.projectRoot
        ? resolve(args.projectRoot)
        : envProjectDir
            ? resolve(dirname(envProjectDir))
            : findUpForProjectRoot(vault) ?? resolve(dirname(vault))

    if (!existsSync(join(projectRoot, '.voicetree'))) {
        die(`project root ${projectRoot} has no .voicetree directory.`)
    }
    return {vault, projectRoot}
}

function configureRuntime(paths: ResolvedPaths): void {
    configureAgentRuntime({
        env: {
            // Discovery and tmux-namespace resolution read project-root and
            // write-path; the snapshot keeps spawned terminal env assembly on
            // the same resolved vault metadata if this CLI launches one.
            getVoicetreeHomePath: (): string => '',
            getMcpPort: (): number => 0,
            getProjectRoot: async (): Promise<string> => paths.projectRoot,
            getVaultSnapshot: async () => ({
                projectRoot: paths.projectRoot,
                readPaths: [paths.vault],
                writeFolder: paths.vault,
            }),
            getWriteFolder: async (): Promise<string> => paths.vault,
        },
    })
}

function formatRow(row: RecoverableAgentSession): string {
    const status: string = row.isClaimed ? 'CLAIMED' : 'unclaimed'
    const capabilities: string[] = []
    if (row.attach) capabilities.push(`attach=${row.attach.session.sessionName}`)
    if (row.resume) capabilities.push(`resume=${row.resume.cliType}`)
    if (capabilities.length === 0) capabilities.push('-')
    return `${row.terminalId.padEnd(24)}  ${(row.agentName ?? '').padEnd(20)}  ${status.padEnd(10)}  ${capabilities.join('  ')}`
}

async function runList(paths: ResolvedPaths): Promise<void> {
    configureRuntime(paths)
    const sessions: readonly RecoverableAgentSession[] = await discoverRecoverableAgentSessions()
    process.stdout.write(`project_root: ${paths.projectRoot}\n`)
    process.stdout.write(`vault:        ${paths.vault}\n\n`)
    if (sessions.length === 0) {
        process.stdout.write('(no recoverable agents)\n')
        return
    }
    process.stdout.write(
        'TERMINAL_ID               AGENT                 STATUS      CAPABILITIES\n',
    )
    for (const row of sessions) process.stdout.write(formatRow(row) + '\n')
}

async function runResume(paths: ResolvedPaths, terminalId: string, noAttach: boolean): Promise<void> {
    configureRuntime(paths)
    const sessions: readonly RecoverableAgentSession[] = await discoverRecoverableAgentSessions()
    const target: RecoverableAgentSession | undefined = sessions.find((s) => s.terminalId === terminalId)
    if (!target) die(`terminal '${terminalId}' is not in discovery for project_root ${paths.projectRoot}.`)

    if (target.attach) {
        const sessionName: string = target.attach.session.sessionName
        process.stdout.write(`tmux session ${sessionName} is already live; attaching\n`)
        return finishWithAttach(sessionName, noAttach)
    }

    if (!target.resume) die(`terminal '${terminalId}' has neither attach nor resume capability.`)

    process.stdout.write(
        `resuming '${terminalId}' via ${target.resume.cliType} (native session id resolved lazily by resolveNativeSession)\n`,
    )
    const result = await resumePersistedAgentSession(target.terminalId)
    if (result.kind !== 'spawned') {
        die(`resume failed: ${JSON.stringify(result)}`)
    }
    process.stdout.write(`spawned pid=${result.pid}\n`)
    process.stdout.write(`command:   ${result.command}\n`)

    const sessionName: string = buildTmuxSessionName(
        terminalId,
        target.terminalData.initialEnvVars ?? {},
    )
    finishWithAttach(sessionName, noAttach)
}

function finishWithAttach(sessionName: string, noAttach: boolean): never {
    if (noAttach) {
        process.stdout.write(`tmux session: ${sessionName}\n`)
        process.stdout.write(`(skipping attach due to --no-attach; use: tmux attach-session -t ${sessionName})\n`)
        process.exit(0)
    }
    execAttach(sessionName)
}

function execAttach(sessionName: string): never {
    const r = spawnSync('tmux', ['attach-session', '-t', sessionName], {stdio: 'inherit'})
    if (r.error) die(`tmux attach failed to launch: ${r.error.message}`)
    process.exit(r.status ?? 0)
}

async function main(): Promise<void> {
    const args: Args = parseArgs(process.argv.slice(2))
    const paths: ResolvedPaths = resolvePaths(args)
    if (args.cmd === 'list') return runList(paths)
    if (args.cmd === 'resume') return runResume(paths, args.terminalId!, args.noAttach)
}

await main().catch((err: unknown): never => {
    die(err instanceof Error ? err.stack ?? err.message : String(err))
})
