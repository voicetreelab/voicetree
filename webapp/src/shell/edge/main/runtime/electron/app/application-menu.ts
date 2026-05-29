/**
 * Application menu setup for Electron.
 */

import path from 'node:path'
import { app, Menu, dialog } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { openProject } from '@/shell/edge/main/graph/watch_folder/watchFolder'

export function setupApplicationMenu(): void {
    const template: MenuItemConstructorOptions[] = [
        {
            label: app.name,
            submenu: [
                {role: 'about'},
                {type: 'separator'},
                {role: 'quit'}
            ]
        },
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open Folder...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        void (async () => {
                            const result: Electron.OpenDialogReturnValue = await dialog.showOpenDialog({
                                properties: ['openDirectory', 'createDirectory'],
                                title: 'Select Folder to Open',
                                buttonLabel: 'Open',
                            })
                            if (result.canceled || result.filePaths.length === 0) return
                            try {
                                await openProject(result.filePaths[0])
                            } catch (err: unknown) {
                                console.error('[application-menu] openProject failed:', err)
                            }
                        })()
                    }
                },
                {
                    label: 'Open Folder in New Instance...',
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => {
                        void (async () => {
                            const result: Electron.OpenDialogReturnValue = await dialog.showOpenDialog({
                                properties: ['openDirectory', 'createDirectory'],
                                title: 'Select Directory to Open in New Instance',
                                buttonLabel: 'Open in New Instance'
                            })
                            if (result.canceled || result.filePaths.length === 0) return

                            const folderPath: string = result.filePaths[0]
                            const {spawn} = await import('child_process')

                            // Use folderPath as cwd to avoid ENOTDIR if process.cwd() is invalid
                            const spawnOptions: import('child_process').SpawnOptions = {
                                cwd: folderPath,
                                detached: true,
                                stdio: 'ignore',
                            }

                            // On packaged macOS, exec'ing the inner binary directly is unreliable
                            // for code-signed .app bundles; launch via `open -n` so LaunchServices
                            // creates a true second instance of the bundle.
                            const child: import('child_process').ChildProcess =
                                process.platform === 'darwin' && app.isPackaged
                                    ? spawn(
                                        '/usr/bin/open',
                                        ['-n', '-a', path.resolve(process.resourcesPath, '..', '..'),
                                         '--args', '--open-folder', folderPath],
                                        spawnOptions,
                                    )
                                    : spawn(
                                        process.execPath,
                                        [app.getAppPath(), '--open-folder', folderPath],
                                        spawnOptions,
                                    )

                            child.on('error', (err: Error): void => {
                                console.error('[application-menu] Failed to spawn new instance:', err)
                            })
                            child.unref()
                        })()
                    }
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                {role: 'undo'},
                {role: 'redo'},
                {type: 'separator'},
                {role: 'cut'},
                {role: 'copy'},
                {role: 'paste'},
            ]
        },
        {
            label: 'View',
            submenu: [
                {role: 'reload'},
                {role: 'forceReload'},
                {role: 'toggleDevTools'},
                {type: 'separator'},
                {role: 'resetZoom'},
                {role: 'zoomIn'},
                {role: 'zoomOut'}
            ]
        },
        {
            label: 'Window',
            submenu: [
                {role: 'minimize'},
                {role: 'zoom'},
                {role: 'togglefullscreen'},
                {type: 'separator'},
                {role: 'front'}
            ]
        }
    ]

    const menu: Menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
}
