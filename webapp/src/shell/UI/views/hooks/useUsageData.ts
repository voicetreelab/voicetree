import { useState, useEffect, useCallback, useRef } from 'react';
import type { ClaudeUsage, UsageData } from '@/shell/edge/main/observability/usage/types';

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

  const isElectron: boolean = window.hostAPI !== undefined;

  const fetchData: () => Promise<void> = useCallback(async () => {
    if (!isElectron) return;
    setIsLoading(true);
    setError(null);
    try {
      const result: UsageData = await window.hostAPI!.main.getUsageData();
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
      const claude: ClaudeUsage = await window.hostAPI!.main.refreshClaudeUsageHeadless();
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

  useEffect(() => {
    if (!isElectron) return;

    let intervalId: NodeJS.Timeout | null = null;

    function startPolling(): void {
      if (intervalId !== null) clearInterval(intervalId);
      intervalId = setInterval(() => void fetchData(), REFRESH_INTERVAL_MS);
    }

    function handleVisibilityChange(): void {
      if (document.hidden) {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
      } else {
        void fetchData();
        startPolling();
      }
    }

    if (!document.hidden) startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalId !== null) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isElectron, fetchData]);

  return { data, isLoading, isClaudeRefreshing, error, refresh: fetchData, refreshClaude };
}
