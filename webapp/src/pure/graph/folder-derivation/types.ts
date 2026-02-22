/** A folder path like 'auth/' or 'auth/oauth/' — always ends with '/' */
export type FolderPath = string;

export interface FolderGroup {
    readonly folderPath: FolderPath;
    readonly childNodeIds: readonly string[];
    readonly parentFolderPath: FolderPath | null;
    readonly depth: number;
}

export interface FolderStructure {
    readonly folders: ReadonlyMap<FolderPath, FolderGroup>;
    readonly nodeToFolder: ReadonlyMap<string, FolderPath>;
    readonly rootNodeIds: readonly string[];
}
