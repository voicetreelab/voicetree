import {describe, it, expect} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AgentConfig} from './types';
import {flattenAgentTree, type ResolvedAgent} from './agentTree';

/**
 * END-TO-END DELIVERY VERIFICATION.
 *
 * The pure tests (agentTree.test.ts) prove the resolver composes the right
 * {command, env}. They do NOT prove those parameters actually reach the spawned
 * process: a single-quote that swallows `$EFFORT`, an env var that never gets
 * injected, or a shell that fails to expand a placeholder would all pass the
 * pure tests yet break in production.
 *
 * This suite closes that gap with a probe. We run the resolved command through a
 * real shell with the resolved env injected (exactly as the daemon hands the env
 * to tmux via `-e KEY=VALUE`, then the shell parses + expands the command), and
 * inspect the literal env + argv the launched process received. This is the
 * robust, accurate oracle for "did the parameter actually get delivered".
 */

const PROBE: string = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../tools/agent-tree-probe/probe.mjs');

/** Codex-Local shape: EFFORT is expanded into a `-c` flag (argv channel). */
const LOCAL_TREE: readonly AgentConfig[] = [{
    name: 'codex-local',
    command: `node ${PROBE} -c "model_reasoning_effort=\\"$EFFORT\\""`,
    children: [
        {name: 'Medium', env: {EFFORT: 'medium'}},
        {name: 'XHigh', env: {EFFORT: 'xhigh'}},
    ],
}];

/** Codex-Remote shape: EFFORT is expanded into a launcher env prefix (env channel). */
const REMOTE_TREE: readonly AgentConfig[] = [{
    name: 'codex-remote',
    command: `CODEX_REASONING_EFFORT="$EFFORT" node ${PROBE}`,
    children: [
        {name: 'Medium', env: {EFFORT: 'medium'}},
        {name: 'XHigh', env: {EFFORT: 'xhigh'}},
    ],
}];

interface ProbeDump {
    readonly argv: readonly string[];
    readonly env: Readonly<Record<string, string>>;
}

/**
 * Spawn the resolved command through a real shell with its resolved env injected,
 * and return what the launched process actually received. `bash -c <command>`
 * with the env set is a faithful stand-in for the daemon's `tmux new-session
 * -e KEY=VALUE … <command>`: tmux sets exactly these env vars, then the session
 * shell parses and expands the command identically.
 */
async function runProbe(leaf: ResolvedAgent): Promise<ProbeDump> {
    const outFile: string = join(mkdtempSync(join(tmpdir(), 'agent-tree-probe-')), 'dump.json');
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn('bash', ['-c', leaf.command], {
            env: {...process.env, ...leaf.env, AGENT_TREE_PROBE_OUT: outFile},
            stdio: 'ignore',
        });
        child.on('error', rejectPromise);
        child.on('exit', (code: number | null) => code === 0 ? resolvePromise() : rejectPromise(new Error(`probe exited ${code}`)));
    });
    return JSON.parse(readFileSync(outFile, 'utf8')) as ProbeDump;
}

type Expectation =
    | {readonly channel: 'argv'; readonly pattern: RegExp}
    | {readonly channel: 'env'; readonly key: string; readonly value: string};

/**
 * The reusable verification function. Given a resolved leaf and the channel its
 * parameter is expected to arrive on, it runs the probe and reports whether the
 * parameter was actually delivered, along with what was observed. Honest by
 * construction: it can (and the tests below confirm it does) return false.
 */
async function verifyAgentDelivery(leaf: ResolvedAgent, expected: Expectation): Promise<{readonly ok: boolean; readonly observed: ProbeDump}> {
    const observed: ProbeDump = await runProbe(leaf);
    const ok: boolean = expected.channel === 'env'
        ? observed.env[expected.key] === expected.value
        : expected.pattern.test(observed.argv.join(' '));
    return {ok, observed};
}

function leaf(tree: readonly AgentConfig[], pathLabel: string): ResolvedAgent {
    const found: ResolvedAgent | undefined = flattenAgentTree(tree).find(l => l.path.join(' / ') === pathLabel);
    if (!found) throw new Error(`no leaf ${pathLabel}`);
    return found;
}

describe('agent-tree end-to-end delivery (probe oracle)', () => {
    it('Local: EFFORT reaches the process as the expanded -c flag value', async () => {
        const xhigh = await verifyAgentDelivery(leaf(LOCAL_TREE, 'codex-local / XHigh'), {channel: 'argv', pattern: /model_reasoning_effort="xhigh"/});
        expect(xhigh.ok).toBe(true);
        const medium = await verifyAgentDelivery(leaf(LOCAL_TREE, 'codex-local / Medium'), {channel: 'argv', pattern: /model_reasoning_effort="medium"/});
        expect(medium.ok).toBe(true);
    });

    it('Remote: EFFORT reaches the launcher as CODEX_REASONING_EFFORT in its env', async () => {
        const xhigh = await verifyAgentDelivery(leaf(REMOTE_TREE, 'codex-remote / XHigh'), {channel: 'env', key: 'CODEX_REASONING_EFFORT', value: 'xhigh'});
        expect(xhigh.ok).toBe(true);
        const medium = await verifyAgentDelivery(leaf(REMOTE_TREE, 'codex-remote / Medium'), {channel: 'env', key: 'CODEX_REASONING_EFFORT', value: 'medium'});
        expect(medium.ok).toBe(true);
    });

    it('does not leak a sibling leaf\'s value (no cross-contamination)', async () => {
        const dump = await runProbe(leaf(LOCAL_TREE, 'codex-local / XHigh'));
        expect(dump.argv.join(' ')).not.toContain('medium');
    });

    it('the verifier is honest — a wrong expectation fails', async () => {
        // Guards against a rubber-stamp oracle: the XHigh leaf must NOT satisfy a
        // "medium" expectation. If this passed, every other assertion would be worthless.
        const wrong = await verifyAgentDelivery(leaf(LOCAL_TREE, 'codex-local / XHigh'), {channel: 'argv', pattern: /model_reasoning_effort="medium"/});
        expect(wrong.ok).toBe(false);
    });
});
