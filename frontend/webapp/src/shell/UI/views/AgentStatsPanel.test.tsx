import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { AgentStatsPanel } from './AgentStatsPanel';

// Test fixture matching the expected agent_metrics.json format
const TEST_METRICS = {
  sessions: [
    {
      sessionId: 'test-001',
      agentName: 'TestAgent',
      contextNode: 'friday/task.md',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 300000,
      tokens: { input: 1500, output: 800, cacheRead: 200 },
      costUsd: 0.0234,
    },
    {
      sessionId: 'test-002',
      agentName: 'OtherAgent',
      contextNode: 'monday/review.md',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 180000,
      tokens: { input: 1000, output: 500 },
      costUsd: 0.0156,
    },
  ],
};

// Mock the Electron API
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetMetrics: Mock<(...args: any[]) => any> = vi.fn();

describe('AgentStatsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMetrics.mockResolvedValue(TEST_METRICS);

    // Setup window.electronAPI mock with getMetrics
    Object.defineProperty(window, 'electronAPI', {
      value: {
        main: {
          getMetrics: mockGetMetrics,
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Reset electronAPI to avoid affecting other tests
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  describe('summary cards', () => {
    it('displays correct session count', async () => {
      render(<AgentStatsPanel />);

      await waitFor(() => {
        expect(screen.getByTestId('sessions-count')).toHaveTextContent('2');
      });
    });

    it('displays correct total cost', async () => {
      render(<AgentStatsPanel />);

      // Total cost: 0.0234 + 0.0156 = 0.039
      await waitFor(() => {
        expect(screen.getByTestId('total-cost')).toHaveTextContent('$0.0390');
      });
    });

    it('displays correct total input tokens', async () => {
      render(<AgentStatsPanel />);

      // Total input: 1500 + 1000 = 2500
      await waitFor(() => {
        expect(screen.getByTestId('tokens-input')).toHaveTextContent('2,500');
      });
    });

    it('displays correct total output tokens', async () => {
      render(<AgentStatsPanel />);

      // Total output: 800 + 500 = 1300
      await waitFor(() => {
        expect(screen.getByTestId('tokens-output')).toHaveTextContent('1,300');
      });
    });
  });

  describe('session list', () => {
    it('renders all sessions', async () => {
      render(<AgentStatsPanel />);

      await waitFor(() => {
        const sessionRows = screen.getAllByTestId('session-row');
        expect(sessionRows).toHaveLength(2);
      });
    });

    it('displays agent names correctly', async () => {
      render(<AgentStatsPanel />);

      await waitFor(() => {
        const agentNames = screen.getAllByTestId('session-agent-name');
        expect(agentNames[0]).toHaveTextContent('TestAgent');
        expect(agentNames[1]).toHaveTextContent('OtherAgent');
      });
    });

    it('displays session costs correctly', async () => {
      render(<AgentStatsPanel />);

      await waitFor(() => {
        const sessionCosts = screen.getAllByTestId('session-cost');
        expect(sessionCosts[0]).toHaveTextContent('$0.0234');
        expect(sessionCosts[1]).toHaveTextContent('$0.0156');
      });
    });

    it('displays session durations correctly', async () => {
      render(<AgentStatsPanel />);

      await waitFor(() => {
        const durations = screen.getAllByTestId('session-duration');
        expect(durations[0]).toHaveTextContent('5m 0s');
        expect(durations[1]).toHaveTextContent('3m 0s');
      });
    });
  });

  describe('empty state', () => {
    it('displays no sessions message when empty', async () => {
      mockGetMetrics.mockResolvedValue({ sessions: [] });

      render(<AgentStatsPanel />);

      await waitFor(() => {
        expect(screen.getByText('No sessions found')).toBeInTheDocument();
      });
    });

    it('displays zero session count when empty', async () => {
      mockGetMetrics.mockResolvedValue({ sessions: [] });

      render(<AgentStatsPanel />);

      await waitFor(() => {
        expect(screen.getByTestId('sessions-count')).toHaveTextContent('0');
      });
    });

    it('displays zero cost when empty', async () => {
      mockGetMetrics.mockResolvedValue({ sessions: [] });

      render(<AgentStatsPanel />);

      await waitFor(() => {
        expect(screen.getByTestId('total-cost')).toHaveTextContent('$0.0000');
      });
    });
  });

  describe('error state', () => {
    it('displays error message when API fails', async () => {
      mockGetMetrics.mockRejectedValue(new Error('Connection failed'));

      render(<AgentStatsPanel />);

      await waitFor(() => {
        expect(screen.getByText(/Error loading metrics/)).toBeInTheDocument();
      });
    });
  });

  describe('time filters', () => {
    it('renders filter buttons', async () => {
      render(<AgentStatsPanel />);

      await waitFor(() => {
        expect(screen.getByText('Today')).toBeInTheDocument();
        expect(screen.getByText('This Week')).toBeInTheDocument();
        expect(screen.getByText('All Time')).toBeInTheDocument();
      });
    });

    it('filters sessions by "Today" when clicked', async () => {
      // Create sessions with different timestamps
      const today = new Date();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

      const metricsWithMixedDates = {
        sessions: [
          {
            sessionId: 'today-session',
            agentName: 'TodayAgent',
            contextNode: 'today/task.md',
            startTime: today.toISOString(),
            durationMs: 60000,
            tokens: { input: 100, output: 50 },
            costUsd: 0.01,
          },
          {
            sessionId: 'yesterday-session',
            agentName: 'YesterdayAgent',
            contextNode: 'yesterday/task.md',
            startTime: yesterday.toISOString(),
            durationMs: 60000,
            tokens: { input: 100, output: 50 },
            costUsd: 0.01,
          },
        ],
      };

      mockGetMetrics.mockResolvedValue(metricsWithMixedDates);

      render(<AgentStatsPanel />);

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('sessions-count')).toHaveTextContent('2');
      });

      // Click "Today" filter
      fireEvent.click(screen.getByText('Today'));

      // Should only show today's session
      await waitFor(() => {
        expect(screen.getByTestId('sessions-count')).toHaveTextContent('1');
      });
    });
  });

  describe('expandable rows', () => {
    it('expands session details when clicked', async () => {
      render(<AgentStatsPanel />);

      // Wait for sessions to load
      await waitFor(() => {
        expect(screen.getAllByTestId('session-row')).toHaveLength(2);
      });

      // Click first session row to expand
      const sessionRows = screen.getAllByTestId('session-row');
      const expandButton = sessionRows[0].querySelector('button');
      if (expandButton) {
        fireEvent.click(expandButton);
      }

      // Check that expanded details show session ID
      await waitFor(() => {
        expect(screen.getByText('test-001')).toBeInTheDocument();
      });
    });
  });
});
