/**
 * ResearchTrailSidebar - Shows a rolling log of web searches and fetches per agent.
 *
 * Follows the same mount/unmount pattern as TerminalTreeSidebar.
 */

import { createElement, useRef, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ResearchTrailEntry } from '@/shell/edge/UI-edge/state/ResearchTrailStore';
import {
    subscribeToResearchTrail,
    getResearchTrailEntries,
} from '@/shell/edge/UI-edge/state/ResearchTrailStore';
import './research-trail.css';

function useResearchTrail(): readonly ResearchTrailEntry[] {
    const [entries, setEntries] = useState<readonly ResearchTrailEntry[]>(getResearchTrailEntries);
    useEffect(() => subscribeToResearchTrail(setEntries), []);
    return entries;
}

function ResearchTrailSidebarInternal(): JSX.Element | null {
    const entries: readonly ResearchTrailEntry[] = useResearchTrail();
    const sidebarRef: React.RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
    const containerRef: React.RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);

    // Auto-scroll to bottom on new entries
    useEffect(() => {
        const el: HTMLDivElement | null = containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [entries.length]);

    if (entries.length === 0) return null;

    return (
        <div ref={sidebarRef} className="research-trail-sidebar">
            <div className="research-trail-header">Research Trail</div>
            <div ref={containerRef} className="research-trail-container">
                {entries.map((entry: ResearchTrailEntry, i: number) => (
                    <div key={i} className={`research-trail-entry ${entry.type}`}>
                        <span className="research-trail-type">{entry.type === 'search' ? 'Q' : '\u2192'}</span>
                        <span className="research-trail-content">
                            <span className="research-trail-text">
                                {entry.type === 'search' ? entry.query : entry.domain}
                            </span>
                            <span className="research-trail-meta">
                                {entry.agent} &middot; {entry.time}
                            </span>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

let reactRoot: Root | null = null;

export function createResearchTrailSidebar(container: HTMLElement): () => void {
    disposeResearchTrailSidebar();

    const mountPoint: HTMLDivElement = document.createElement('div');
    mountPoint.style.position = 'relative';
    mountPoint.style.height = '100%';
    container.appendChild(mountPoint);

    reactRoot = createRoot(mountPoint);
    reactRoot.render(createElement(ResearchTrailSidebarInternal));

    return disposeResearchTrailSidebar;
}

export function disposeResearchTrailSidebar(): void {
    if (reactRoot) {
        reactRoot.unmount();
        reactRoot = null;
    }
}
