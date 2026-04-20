import type { Command } from '@vt/graph-state'
import type { NodeIdAndFilePath } from '@vt/graph-model/pure/graph'

import { getMainWindow } from './app-electron-state'

interface RendererLiveStatePayload {
    readonly collapseSet?: unknown
    readonly selection?: unknown
}

export interface RendererLiveStateSnapshot {
    readonly collapseSet: ReadonlySet<string>
    readonly selection: ReadonlySet<NodeIdAndFilePath>
}

export type RendererOwnedLiveCommand = Extract<
    Command,
    { type: 'Collapse' | 'Expand' | 'Select' | 'Deselect' | 'SetZoom' | 'SetPan' | 'RequestFit' }
>

function getWebContents(): Electron.WebContents {
    const mainWindow: ReturnType<typeof getMainWindow> = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
        throw new Error('Renderer live-state proxy unavailable: main window not ready')
    }
    return mainWindow.webContents
}

function parseStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw new Error(`Renderer live-state proxy returned invalid ${field}`)
    }
    return value.map(String)
}

function parseSnapshot(value: unknown): RendererLiveStateSnapshot {
    const payload: RendererLiveStatePayload =
        typeof value === 'object' && value !== null ? (value as RendererLiveStatePayload) : {}

    return {
        collapseSet: new Set(parseStringArray(payload.collapseSet ?? [], 'collapseSet')),
        selection: new Set(
            parseStringArray(payload.selection ?? [], 'selection') as NodeIdAndFilePath[],
        ),
    }
}

function buildReadScript(): string {
    return `(() => {
  const debug = window.__vtDebug__;
  if (!debug || typeof debug.liveState !== 'function') {
    throw new Error('window.__vtDebug__.liveState unavailable');
  }
  return debug.liveState();
})()`
}

function buildApplyScript(command: RendererOwnedLiveCommand): string {
    return `(async () => {
  const debug = window.__vtDebug__;
  if (!debug || typeof debug.applyLiveCommand !== 'function') {
    throw new Error('window.__vtDebug__.applyLiveCommand unavailable');
  }
  await debug.applyLiveCommand(${JSON.stringify(command)});
  if (typeof debug.liveState !== 'function') {
    throw new Error('window.__vtDebug__.liveState unavailable');
  }
  return debug.liveState();
})()`
}

export function isRendererOwnedLiveCommand(
    command: Command,
): command is RendererOwnedLiveCommand {
    return (
        command.type === 'Collapse'
        || command.type === 'Expand'
        || command.type === 'Select'
        || command.type === 'Deselect'
        || command.type === 'SetZoom'
        || command.type === 'SetPan'
        || command.type === 'RequestFit'
    )
}

export async function readRendererLiveState(): Promise<RendererLiveStateSnapshot> {
    const raw: unknown = await getWebContents().executeJavaScript(buildReadScript())
    return parseSnapshot(raw)
}

export async function applyRendererLiveCommand(
    command: RendererOwnedLiveCommand,
): Promise<RendererLiveStateSnapshot> {
    const raw: unknown = await getWebContents().executeJavaScript(buildApplyScript(command))
    return parseSnapshot(raw)
}
