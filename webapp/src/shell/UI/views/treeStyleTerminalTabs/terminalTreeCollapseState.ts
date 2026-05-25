import { useCallback, useState } from 'react';
import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/anchoring/types';

/**
 * Persisted collapse/expand choices for the terminal tree sidebar.
 *
 * Auto-collapse rule: a parent with this many or more direct children starts
 * collapsed unless the user has explicitly expanded it. Explicit user choices
 * (collapse or expand) override the auto-rule and persist across sessions via
 * localStorage.
 */

const AUTO_COLLAPSE_THRESHOLD: number = 5;
const COLLAPSE_STORAGE_KEY: string = 'vt:terminalTreeCollapse:v1';

type CollapseChoice = 'collapsed' | 'expanded';
type CollapseChoiceMap = Record<TerminalId, CollapseChoice>;

function loadCollapseChoices(): CollapseChoiceMap {
    try {
        const raw: string | null = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed as CollapseChoiceMap : {};
    } catch { return {}; }
}

function saveCollapseChoices(choices: CollapseChoiceMap): void {
    try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(choices));
    } catch { /* localStorage may be unavailable (private mode); persistence is best-effort. */ }
}

export type CollapseStateHandle = {
    readonly isCollapsed: (id: TerminalId, directChildCount: number) => boolean;
    readonly toggle: (id: TerminalId, directChildCount: number) => void;
};

export function useCollapseState(): CollapseStateHandle {
    const [choices, setChoices] = useState<CollapseChoiceMap>(loadCollapseChoices);

    const isCollapsed = useCallback((id: TerminalId, directChildCount: number): boolean => {
        const choice: CollapseChoice | undefined = choices[id];
        if (choice === 'collapsed') return true;
        if (choice === 'expanded') return false;
        return directChildCount >= AUTO_COLLAPSE_THRESHOLD;
    }, [choices]);

    const toggle = useCallback((id: TerminalId, directChildCount: number): void => {
        setChoices((prev: CollapseChoiceMap): CollapseChoiceMap => {
            const next: CollapseChoiceMap = { ...prev };
            const current: CollapseChoice | undefined = prev[id];
            const autoCollapsed: boolean = directChildCount >= AUTO_COLLAPSE_THRESHOLD;
            const effective: CollapseChoice = current ?? (autoCollapsed ? 'collapsed' : 'expanded');
            next[id] = effective === 'collapsed' ? 'expanded' : 'collapsed';
            saveCollapseChoices(next);
            return next;
        });
    }, []);

    return { isCollapsed, toggle };
}
