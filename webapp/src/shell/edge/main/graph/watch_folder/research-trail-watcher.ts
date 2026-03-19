/**
 * Research trail watcher - watches .research-trail.jsonl in the vault
 * and pushes entries to the renderer via uiAPI.
 */

import fs from 'fs';
import path from 'path';
import { uiAPI } from '@/shell/edge/main/ui-api-proxy';

let watcher: fs.FSWatcher | null = null;
let watchedFile: string | null = null;

export function startResearchTrailWatcher(vaultWritePath: string): void {
    stopResearchTrailWatcher();

    const filePath: string = path.join(vaultWritePath, '.research-trail.jsonl');
    watchedFile = filePath;

    // Push current contents (if file exists)
    pushEntries(filePath);

    // Watch for changes
    try {
        watcher = fs.watch(filePath, { persistent: false }, () => {
            pushEntries(filePath);
        });
        watcher.on('error', () => {
            // File may not exist yet — that's fine, we'll pick it up on creation
        });
    } catch {
        // File doesn't exist yet. Use watchFile (polling) to detect creation.
        fs.watchFile(filePath, { interval: 2000 }, () => {
            if (fs.existsSync(filePath)) {
                fs.unwatchFile(filePath);
                startResearchTrailWatcher(vaultWritePath);
            }
        });
    }
}

export function stopResearchTrailWatcher(): void {
    if (watcher) {
        watcher.close();
        watcher = null;
    }
    if (watchedFile) {
        fs.unwatchFile(watchedFile);
        watchedFile = null;
    }
}

function pushEntries(filePath: string): void {
    try {
        const raw: string = fs.readFileSync(filePath, 'utf8');
        const entries: unknown[] = raw.trim().split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
        uiAPI.syncResearchTrail(entries as Parameters<typeof uiAPI.syncResearchTrail>[0]);
    } catch {
        // File doesn't exist or is empty
    }
}
