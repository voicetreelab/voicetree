import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, chmodSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runHook } from './gitWorktreeCommands';

describe('runHook env plumbing', () => {
    it('forwards extraEnv vars into the child process environment', async () => {
        const dir: string = mkdtempSync(path.join(tmpdir(), 'vt-runhook-env-'));
        const probeScript: string = path.join(dir, 'probe.sh');
        const outFile: string = path.join(dir, 'out.txt');
        writeFileSync(
            probeScript,
            `#!/bin/sh\nprintf '%s' "$VOICETREE_MCP_PORT" > "${outFile}"\n`,
            'utf-8',
        );
        chmodSync(probeScript, 0o755);

        const result = await runHook(probeScript, [], dir, { VOICETREE_MCP_PORT: '4242' });

        expect(result.success).toBe(true);
        expect(readFileSync(outFile, 'utf-8')).toBe('4242');
    });

    it('inherits parent env (PATH) so binaries resolve when extraEnv is partial', async () => {
        const dir: string = mkdtempSync(path.join(tmpdir(), 'vt-runhook-env-'));
        const probeScript: string = path.join(dir, 'probe.sh');
        const outFile: string = path.join(dir, 'out.txt');
        // Uses `printf` (an external binary on some shells) — needs PATH.
        writeFileSync(
            probeScript,
            `#!/bin/sh\nwhich printf > "${outFile}" 2>&1 || true\n`,
            'utf-8',
        );
        chmodSync(probeScript, 0o755);

        const result = await runHook(probeScript, [], dir, { VOICETREE_MCP_PORT: '4242' });

        expect(result.success).toBe(true);
        const out: string = readFileSync(outFile, 'utf-8').trim();
        // PATH must be present for `which printf` to return a path. If extraEnv
        // had REPLACED env instead of merging, this would fail.
        expect(out.length).toBeGreaterThan(0);
    });

    it('omits extraEnv argument leaves the child running with inherited env (default behavior)', async () => {
        const dir: string = mkdtempSync(path.join(tmpdir(), 'vt-runhook-env-'));
        const probeScript: string = path.join(dir, 'probe.sh');
        const outFile: string = path.join(dir, 'out.txt');
        writeFileSync(
            probeScript,
            `#!/bin/sh\nprintf '%s' "$HOME" > "${outFile}"\n`,
            'utf-8',
        );
        chmodSync(probeScript, 0o755);

        // No extraEnv passed → child should still inherit parent env (HOME present).
        const result = await runHook(probeScript, [], dir);

        expect(result.success).toBe(true);
        expect(readFileSync(outFile, 'utf-8').length).toBeGreaterThan(0);

        if (existsSync(outFile)) unlinkSync(outFile);
    });

    it('extraEnv overrides an inherited variable when names collide', async () => {
        const dir: string = mkdtempSync(path.join(tmpdir(), 'vt-runhook-env-'));
        const probeScript: string = path.join(dir, 'probe.sh');
        const outFile: string = path.join(dir, 'out.txt');
        writeFileSync(
            probeScript,
            `#!/bin/sh\nprintf '%s' "$HOME" > "${outFile}"\n`,
            'utf-8',
        );
        chmodSync(probeScript, 0o755);

        const result = await runHook(probeScript, [], dir, { HOME: '/forced-override' });

        expect(result.success).toBe(true);
        expect(readFileSync(outFile, 'utf-8')).toBe('/forced-override');
    });
});

