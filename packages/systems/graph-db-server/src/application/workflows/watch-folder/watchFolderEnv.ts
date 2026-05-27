import { promises as fs } from "fs";
import fsSync from "fs";
import {
    copyMarkdownFiles,
    pathExists,
    createDatedSubfolder,
    findExistingVoicetreeDir,
} from "@vt/app-config/project";
import { loadSettings } from "@vt/app-config/settings";
import {resolveAppSupportPath} from '@vt/app-config/app-support-path'
import { getCallbacks } from "@vt/graph-model";
import type { GraphModelCallbacks } from "@vt/graph-model";
import type { VTSettings } from "@vt/graph-model/settings";

export interface FsEffects {
    readonly access: (path: string) => Promise<void>;
    readonly mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
    readonly pathExists: (path: string) => Promise<boolean>;
    readonly existsSync: (path: string) => boolean;
    readonly statSyncIsDirectory: (path: string) => boolean;
}

export interface ProjectEffects {
    readonly copyMarkdownFiles: (sourceDir: string, targetDir: string) => Promise<number>;
    readonly createDatedSubfolder: (parent: string) => Promise<string>;
    readonly findExistingVoicetreeDir: (parent: string) => Promise<string | null>;
}

export interface WatchFolderEnv {
    readonly fs: FsEffects;
    readonly clock: { readonly nowIso: () => string };
    readonly callbacks: () => GraphModelCallbacks;
    readonly settings: () => Promise<VTSettings>;
    readonly project: ProjectEffects;
}

export const defaultWatchFolderEnv: WatchFolderEnv = {
    fs: {
        access: (path: string) => fs.access(path),
        mkdir: async (path: string, options?: { recursive?: boolean }) => {
            await fs.mkdir(path, options);
        },
        pathExists,
        existsSync: fsSync.existsSync,
        statSyncIsDirectory: (path: string) => fsSync.statSync(path).isDirectory(),
    },
    clock: { nowIso: () => new Date().toISOString() },
    callbacks: getCallbacks,
    settings: () => loadSettings(resolveAppSupportPath()),
    project: {
        copyMarkdownFiles,
        createDatedSubfolder,
        findExistingVoicetreeDir,
    },
};
