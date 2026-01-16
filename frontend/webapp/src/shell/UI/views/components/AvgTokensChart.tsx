import type { JSX } from 'react';
import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { SessionMetric } from '@/shell/UI/views/hooks/useAgentMetrics';
import { aggregateTokensByDay, type DayTokenAggregation } from '@/pure/metrics/aggregateTokensByDay';

interface AvgTokensChartProps {
  readonly sessions: readonly SessionMetric[];
}

function formatDateLabel(dateStr: string): string {
  const date: Date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

export function AvgTokensChart({ sessions }: AvgTokensChartProps): JSX.Element {
  const chartData: readonly DayTokenAggregation[] = useMemo(
    () => aggregateTokensByDay(sessions),
    [sessions]
  );

  if (chartData.length === 0) {
    return (
      <div className="text-gray-500 text-center py-4 text-xs">
        No token data available
      </div>
    );
  }

  return (
    <div className="w-full h-40" data-testid="avg-tokens-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData as DayTokenAggregation[]}
          margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateLabel}
            tick={{ fontSize: 10, fill: '#6b7280' }}
            stroke="#e5e7eb"
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#6b7280' }}
            stroke="#e5e7eb"
            tickFormatter={formatTokenCount}
          />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              backgroundColor: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 4,
            }}
            formatter={(value: number | undefined) => [formatTokenCount(value ?? 0), 'Avg Tokens']}
            labelFormatter={(label: string) => formatDateLabel(label)}
          />
          <Line
            type="monotone"
            dataKey="averageTokens"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={{ fill: '#8b5cf6', strokeWidth: 0, r: 3 }}
            activeDot={{ r: 5, fill: '#8b5cf6' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
