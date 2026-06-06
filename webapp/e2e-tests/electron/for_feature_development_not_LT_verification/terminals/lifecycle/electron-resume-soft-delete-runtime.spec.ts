import {expect, test} from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {getProjectDotVoicetreePath} from '@vt/paths';
import {defaultHeadlessAgentDeps} from '@vt/vt-daemon/agent-runtime/headless/headlessAgentDeps.ts';
import {spawnTmuxBackedTerminal, killTmuxHeadlessAgent, detachTmuxHeadlessAgents} from '@vt/vt-daemon/agent-runtime/headless/tmuxHeadlessRuntime.ts';
import {discoverRecoverableAgentSessions, type DiscoverRecoveryDeps} from '@vt/vt-daemon/agent-runtime/recovery/discovery.ts';
import {removePersistedAgentRecord} from '@vt/vt-daemon/agent-runtime/recovery/removePersistedAgentRecord.ts';
import {resumePersistedAgentSession} from '@vt/vt-daemon/agent-runtime/recovery/resumePersistedAgentSession.ts';
import {getRecoveryMetadataDir} from '@vt/vt-daemon/agent-runtime/recovery/paths.ts';
import {readMetadata, type TmuxTerminalMetadata} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/terminal-metadata.ts';
import {createTerminalData, type TerminalData, type TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts';
import {buildTmuxNamespaceHash, buildTmuxSessionName, hasSession, killSession} from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-session-manager.ts';

const TERMINAL_ID = 'SoftDeleteResumeE2E' as TerminalId;
const NATIVE_SESSION_ID = '2d1b7c5a-0e9f-4c8d-b6a3-1f0e9d8c7b6a';

async function writeStubClaude(dir: string): Promise<string> {
    const binDir = path.join(dir, 'bin');
    await fs.mkdir(binDir, {recursive: true});
    const stubPath = path.join(binDir, 'claude');
    await fs.writeFile(stubPath, '#!/usr/bin/env bash\nsleep 600\n', 'utf8');
    await fs.chmod(stubPath, 0o755);
    return binDir;
}

async function readMetadataRecords(projectRoot: string): Promise<readonly {readonly path: string; readonly data: unknown}[]> {
    const dir = getRecoveryMetadataDir(projectRoot);
    const entries = await fs.readdir(dir).catch(() => []);
    const records: {readonly path: string; readonly data: unknown}[] = [];
    for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        const filePath = path.join(dir, entry);
        records.push({path: filePath, data: JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown});
    }
    return records;
}

async function metadataStatus(metadataPath: string): Promise<string | null> {
    const metadata = readMetadata(metadataPath);
    return metadata?.status ?? null;
}

test.describe('persisted recovery soft-delete lifecycle', () => {
    test('Resume → close keeps terminal JSON resumable → Clear deletes persisted record', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-soft-delete-resume-'));
        const previousHome = process.env.VOICETREE_HOME_PATH;
        process.env.VOICETREE_HOME_PATH = path.join(tempRoot, 'home');

        const liveRegistry = new Set<string>();
        const projectRoot = path.join(tempRoot, 'project');
        const taskNodePath = path.join(projectRoot, 'readme.md');
        const metadataDir = getRecoveryMetadataDir(projectRoot);
        const metadataPath = path.join(metadataDir, `${TERMINAL_ID}.json`);
        const projectDir = getProjectDotVoicetreePath(projectRoot);
        const stubBinDir = await writeStubClaude(tempRoot);
        const initialEnvVars = {
            PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
            VOICETREE_TERMINAL_ID: TERMINAL_ID,
            AGENT_NAME: TERMINAL_ID,
            VOICETREE_PROJECT_PATH: projectRoot,
            VOICETREE_PROJECT_DIR: projectDir,
            TASK_NODE_PATH: taskNodePath,
        };
        const terminalData: TerminalData = createTerminalData({
            terminalId: TERMINAL_ID,
            attachedToNodeId: taskNodePath,
            terminalCount: 0,
            title: TERMINAL_ID,
            agentName: TERMINAL_ID,
            initialCommand: 'claude',
            initialEnvVars,
            isHeadless: false,
        });
        const sessionName = buildTmuxSessionName(TERMINAL_ID, initialEnvVars);
        const discoverDeps: DiscoverRecoveryDeps = {
            readProjectMetadataDir: () => readMetadataRecords(projectRoot),
            listLiveUnclaimedTmuxSessions: async () => [],
            getRegistryTerminalIds: () => liveRegistry,
            getCurrentNamespaceHash: async () => buildTmuxNamespaceHash(projectDir),
        };

        try {
            await fs.mkdir(metadataDir, {recursive: true});
            await fs.writeFile(taskNodePath, '# test\n', 'utf8');
            const seeded: TmuxTerminalMetadata = {
                name: TERMINAL_ID,
                status: 'exited',
                session: sessionName,
                startedAt: new Date(Date.now() - 1_000).toISOString(),
                endedAt: new Date().toISOString(),
                terminalData,
                recovery: {
                    native: {
                        cli: 'claude',
                        mode: 'interactive',
                        sessionId: NATIVE_SESSION_ID,
                        capturedAt: new Date().toISOString(),
                        source: 'claude-project-transcript',
                    },
                },
            };
            await fs.writeFile(metadataPath, JSON.stringify(seeded, null, 2), 'utf8');

            const beforeResume = await discoverRecoverableAgentSessions(discoverDeps, {horizonMs: null});
            expect(beforeResume.find((row) => row.terminalId === TERMINAL_ID)?.resume).toMatchObject({
                cliType: 'claude',
                nativeSessionId: NATIVE_SESSION_ID,
            });

            const resumeResult = await resumePersistedAgentSession(TERMINAL_ID, {
                discover: () => discoverRecoverableAgentSessions(discoverDeps, {horizonMs: null}),
                resolveNativeSession: async () => {
                    throw new Error('persisted native session id should avoid provider-store scan');
                },
                spawn: (terminalId, data, command, cwd, env) => spawnTmuxBackedTerminal(terminalId, data, command, cwd, env, {
                    ...defaultHeadlessAgentDeps,
                    getPlatform: () => process.platform,
                    getShellEnv: () => process.env.SHELL,
                    getHomeDir: () => tempRoot,
                    getCurrentDirectory: () => projectRoot,
                    getProcessEnv: () => process.env,
                    processPid: process.pid,
                    writeLog: () => undefined,
                    recordTerminalSpawn: (terminalId) => {
                        liveRegistry.add(terminalId);
                    },
                    markTerminalExited: (terminalId) => {
                        liveRegistry.delete(terminalId);
                    },
                }),
            });
            expect(resumeResult.kind).toBe('spawned');
            expect(resumeResult).toMatchObject({command: `claude --resume ${NATIVE_SESSION_ID}`});
            await expect.poll(() => hasSession(sessionName), {
                timeout: 15_000,
                intervals: [250, 500, 1_000],
            }).toBe(true);
            await expect(metadataStatus(metadataPath)).resolves.toBe('running');

            const closed = await killTmuxHeadlessAgent(TERMINAL_ID, {
                processPid: process.pid,
                markTerminalExited: (terminalId) => {
                    liveRegistry.delete(terminalId);
                },
            });
            expect(closed).toBe(true);
            await expect.poll(() => hasSession(sessionName), {
                timeout: 15_000,
                intervals: [250, 500, 1_000],
            }).toBe(false);
            await expect.poll(() => metadataStatus(metadataPath), {
                timeout: 10_000,
                intervals: [250, 500, 1_000],
            }).toBe('exited');

            const afterClose = await discoverRecoverableAgentSessions(discoverDeps, {horizonMs: null});
            expect(afterClose.find((row) => row.terminalId === TERMINAL_ID)?.resume).toMatchObject({
                cliType: 'claude',
                nativeSessionId: NATIVE_SESSION_ID,
            });

            const removeResult = await removePersistedAgentRecord(TERMINAL_ID, {
                getProjectRoot: async () => projectRoot,
                isInLiveRegistry: (terminalId) => liveRegistry.has(terminalId),
            });
            expect(removeResult.kind).toBe('removed');
            await expect(fs.access(metadataPath)).rejects.toThrow();

            const afterClear = await discoverRecoverableAgentSessions(discoverDeps, {horizonMs: null});
            expect(afterClear.find((row) => row.terminalId === TERMINAL_ID)).toBeUndefined();
        } finally {
            detachTmuxHeadlessAgents();
            await killSession(sessionName).catch(() => undefined);
            if (previousHome === undefined) {
                delete process.env.VOICETREE_HOME_PATH;
            } else {
                process.env.VOICETREE_HOME_PATH = previousHome;
            }
            await fs.rm(tempRoot, {recursive: true, force: true});
        }
    });
});
