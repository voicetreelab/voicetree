import type { JSX } from 'react';
import { useMemo } from 'react';
import {
  LineChart,
  Line,
} from 'recharts';
import type { SessionMetric } from '@/shell/UI/views/hooks/useAgentMetrics';
import { aggregateSessionsByDay, type DayAggregation } from '@vt/graph-model/metrics';
import { AGENT_METRICS_CHART_MARGIN } from './AgentMetricsChartFormatting';
import {
  AgentChartContainer,
  AgentChartDateXAxis,
  AgentChartEmptyState,
  AgentChartGrid,
  AgentChartTooltip,
  AgentChartYAxis,
} from './AgentMetricsChartParts';

interface SessionDurationChartProps {
  readonly sessions: readonly SessionMetric[];
}

export function SessionDurationChart({ sessions }: SessionDurationChartProps): JSX.Element {
  const chartData: readonly DayAggregation[] = useMemo(
    () => aggregateSessionsByDay(sessions),
    [sessions]
  );

  if (chartData.length === 0) {
    return <AgentChartEmptyState message="No session duration data available" />;
  }

  return (
    <AgentChartContainer testId="session-duration-chart">
      <LineChart
        data={chartData as DayAggregation[]}
        margin={AGENT_METRICS_CHART_MARGIN}
      >
        <AgentChartGrid />
        <AgentChartDateXAxis />
        <AgentChartYAxis tickFormatter={(value: number) => `${value}m`} />
        <AgentChartTooltip
          formatter={(value: number | undefined) => [`${value ?? 0} min`, 'Avg Duration']}
        />
        <Line
          type="monotone"
          dataKey="avgDurationMinutes"
          stroke="#2563eb"
          strokeWidth={2}
          dot={{ fill: '#2563eb', strokeWidth: 0, r: 3 }}
          activeDot={{ r: 5, fill: '#2563eb' }}
        />
      </LineChart>
    </AgentChartContainer>
  );
}
