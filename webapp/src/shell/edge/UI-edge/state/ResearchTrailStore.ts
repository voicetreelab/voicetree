/**
 * ResearchTrailStore - Tracks web searches and page fetches across agents.
 *
 * Same subscriber pattern as TerminalStore.
 * Main process pushes entries via uiAPI.syncResearchTrail().
 */

export interface ResearchTrailEntry {
    readonly type: 'search' | 'fetch';
    readonly query?: string;
    readonly url?: string;
    readonly domain?: string;
    readonly agent: string;
    readonly time: string;
}

const entries: ResearchTrailEntry[] = [];

type Callback = (entries: readonly ResearchTrailEntry[]) => void;
const subscribers: Set<Callback> = new Set();

function notify(): void {
    const snapshot: readonly ResearchTrailEntry[] = [...entries];
    for (const cb of subscribers) cb(snapshot);
}

export function syncResearchTrailFromMain(incoming: ResearchTrailEntry[]): void {
    entries.length = 0;
    entries.push(...incoming);
    notify();
}

export function subscribeToResearchTrail(cb: Callback): () => void {
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
}

export function getResearchTrailEntries(): readonly ResearchTrailEntry[] {
    return entries;
}

export function clearResearchTrail(): void {
    entries.length = 0;
    notify();
}
