let startupFolderOverride: string | null = null

export function getStartupFolderOverride(): string | null {
    return startupFolderOverride
}

export function setStartupFolderOverride(folderPath: string | null): void {
    startupFolderOverride = folderPath
}
