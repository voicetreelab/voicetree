import { describe, it, expect } from 'vitest';
import { worktreeSiblingDirNameForRole } from './gitWorktreeCommands';

describe('worktree root role selection', () => {
    it('uses vt-wts-remote for VM-owned worktrees', () => {
        expect(worktreeSiblingDirNameForRole('remote')).toBe('vt-wts-remote');
    });

    it('uses vt-wts for Mac-owned and unspecified roles', () => {
        expect(worktreeSiblingDirNameForRole('mac')).toBe('vt-wts');
        expect(worktreeSiblingDirNameForRole(undefined)).toBe('vt-wts');
    });
});
