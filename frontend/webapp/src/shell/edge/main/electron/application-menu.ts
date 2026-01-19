/**
 * Application menu setup for Electron.
 */

import { app, Menu, dialog } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { startFileWatching } from '@/shell/edge/main/graph/watch_folder/watchFolder'

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
                        void startFileWatching()
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
                            if (!result.canceled && result.filePaths.length > 0) {
                                const folderPath: string = result.filePaths[0]
                                const {spawn} = await import('child_process')
                                // Spawn new instance: electron binary + app path + args
                                // Use folderPath as cwd to avoid ENOTDIR if process.cwd() is invalid
                                spawn(process.execPath, [app.getAppPath(), '--open-folder', folderPath], {
                                    cwd: folderPath,
                                    detached: true,
                                    stdio: 'ignore'
                                }).unref()
                            }
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
