import type { JSX } from 'react';
import type { SessionMetric } from '@/shell/UI/views/hooks/useAgentMetrics';
import { DailyTokenChart } from './DailyTokenChart';

interface AvgTokensChartProps {
  readonly sessions: readonly SessionMetric[];
}

export function AvgTokensChart({ sessions }: AvgTokensChartProps): JSX.Element {
  return (
    <DailyTokenChart
      color="#8b5cf6"
      dataKey="averageTokens"
      seriesType="line"
      sessions={sessions}
      testId="avg-tokens-chart"
      tooltipLabel="Avg Tokens"
    />
  );
}
