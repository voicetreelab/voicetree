import type {VTSettings} from '@vt/graph-model/settings'

export function shouldBypassElectronNodePtySpawn(settings: Pick<VTSettings, 'ptyBackend'>): boolean {
    return (settings.ptyBackend ?? 'node-pty') === 'tmux'
}
