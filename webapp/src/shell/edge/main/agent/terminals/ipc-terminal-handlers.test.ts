import {describe, expect, it} from 'vitest';
import type {VTSettings} from '@vt/graph-model/settings';
import {shouldBypassElectronNodePtySpawn} from './terminal-backend-gate';

describe('terminal IPC spawn backend gate', () => {
    it('bypasses Electron node-pty ownership only for the tmux backend', () => {
        expect(shouldBypassElectronNodePtySpawn({ptyBackend: 'tmux'} as Pick<VTSettings, 'ptyBackend'>)).toBe(true);
        expect(shouldBypassElectronNodePtySpawn({ptyBackend: 'node-pty'} as Pick<VTSettings, 'ptyBackend'>)).toBe(false);
    });
});
