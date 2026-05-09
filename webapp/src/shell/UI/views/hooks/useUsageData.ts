import { useState, useEffect, useCallback, useRef } from 'react';
import type { ClaudeUsage, UsageData } from '@/shell/edge/main/usage/types';

const REFRESH_INTERVAL_MS: number = 60_000;

interface UseUsageDataReturn {
  data: UsageData | null;
  isLoading: boolean;
  isClaudeRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshClaude: () => Promise<void>;
}

export function useUsageData(): UseUsageDataReturn {
  const [data, setData] = useState<UsageData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isClaudeRefreshing, setIsClaudeRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const claudeRefreshInFlight = useRef<boolean>(false);

  const isElectron: boolean = window.electronAPI !== undefined;

  const fetchData: () => Promise<void> = useCallback(async () => {
    if (!isElectron) return;
    setIsLoading(true);
    setError(null);
    try {
      const result: UsageData = await window.electronAPI!.main.getUsageData();
      setData(result);
    } catch (err) {
      console.error('[useUsageData] failed to fetch:', err);
      setError('Failed to fetch usage data');
    } finally {
      setIsLoading(false);
    }
  }, [isElectron]);

  const refreshClaude: () => Promise<void> = useCallback(async () => {
    if (!isElectron) return;
    if (claudeRefreshInFlight.current) return;
    claudeRefreshInFlight.current = true;
    setIsClaudeRefreshing(true);
    try {
      const claude: ClaudeUsage = await window.electronAPI!.main.refreshClaudeUsageHeadless();
      setData(prev => prev === null ? prev : { ...prev, claude });
    } catch (err) {
      console.error('[useUsageData] headless refresh failed:', err);
    } finally {
      claudeRefreshInFlight.current = false;
      setIsClaudeRefreshing(false);
    }
  }, [isElectron]);

  // Initial load: fetch the cheap token-derived data, then kick off the
  // headless `claude /usage` scrape in the background.
  useEffect(() => {
    if (!isElectron) return;
    let cancelled: boolean = false;
    void (async () => {
      await fetchData();
      if (cancelled) return;
      void refreshClaude();
    })();
    return () => { cancelled = true; };
  }, [isElectron, fetchData, refreshClaude]);

  // Keep the cheap fields fresh on an interval (Codex sqlite updates, JSONL
  // tokens). Headless `/usage` only re-runs on manual refresh.
  useEffect(() => {
    if (!isElectron) return;
    const intervalId: NodeJS.Timeout = setInterval(() => {
      void fetchData();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [isElectron, fetchData]);

  return { data, isLoading, isClaudeRefreshing, error, refresh: fetchData, refreshClaude };
}
