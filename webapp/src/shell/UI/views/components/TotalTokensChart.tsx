import type { JSX } from 'react';
import type { SessionMetric } from '@/shell/UI/views/hooks/useAgentMetrics';
import { DailyTokenChart } from './DailyTokenChart';

interface TotalTokensChartProps {
  readonly sessions: readonly SessionMetric[];
}

export function TotalTokensChart({ sessions }: TotalTokensChartProps): JSX.Element {
  return (
    <DailyTokenChart
      color="#10b981"
      dataKey="totalTokens"
      seriesType="bar"
      sessions={sessions}
      testId="total-tokens-chart"
      tooltipLabel="Total Tokens"
    />
  );
}
