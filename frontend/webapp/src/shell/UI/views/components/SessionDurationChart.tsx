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
import { aggregateSessionsByDay, type DayAggregation } from '@/pure/metrics/aggregateSessionsByDay';

interface SessionDurationChartProps {
  readonly sessions: readonly SessionMetric[];
}

function formatDateLabel(dateStr: string): string {
  const date: Date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function SessionDurationChart({ sessions }: SessionDurationChartProps): JSX.Element {
  const chartData: readonly DayAggregation[] = useMemo(
    () => aggregateSessionsByDay(sessions),
    [sessions]
  );

  if (chartData.length === 0) {
    return (
      <div className="text-gray-500 text-center py-4 text-xs">
        No session duration data available
      </div>
    );
  }

  return (
    <div className="w-full h-40" data-testid="session-duration-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData as DayAggregation[]}
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
            tickFormatter={(value: number) => `${value}m`}
          />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              backgroundColor: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 4,
            }}
            formatter={(value: number | undefined) => [`${value ?? 0} min`, 'Avg Duration']}
            labelFormatter={(label: string) => formatDateLabel(label)}
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
      </ResponsiveContainer>
    </div>
  );
}
