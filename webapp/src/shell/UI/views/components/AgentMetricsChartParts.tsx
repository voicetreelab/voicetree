import type { JSX, ReactNode } from 'react';
import {
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDateLabel } from './AgentMetricsChartFormatting';

interface AgentChartContainerProps {
  readonly children: ReactNode;
  readonly testId: string;
}

interface AgentChartEmptyStateProps {
  readonly message: string;
}

interface AgentChartYAxisProps {
  readonly tickFormatter: (value: number) => string;
}

interface AgentChartTooltipProps {
  readonly formatter: (value: number | undefined) => [string, string];
}

export function AgentChartEmptyState({ message }: AgentChartEmptyStateProps): JSX.Element {
  return (
    <div className="text-gray-500 text-center py-4 text-xs">
      {message}
    </div>
  );
}

export function AgentChartContainer({ children, testId }: AgentChartContainerProps): JSX.Element {
  return (
    <div className="w-full h-40" data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export function AgentChartGrid(): JSX.Element {
  return <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />;
}

export function AgentChartDateXAxis(): JSX.Element {
  return (
    <XAxis
      dataKey="date"
      tickFormatter={formatDateLabel}
      tick={{ fontSize: 10, fill: '#6b7280' }}
      stroke="#e5e7eb"
    />
  );
}

export function AgentChartYAxis({ tickFormatter }: AgentChartYAxisProps): JSX.Element {
  return (
    <YAxis
      tick={{ fontSize: 10, fill: '#6b7280' }}
      stroke="#e5e7eb"
      tickFormatter={tickFormatter}
    />
  );
}

export function AgentChartTooltip({ formatter }: AgentChartTooltipProps): JSX.Element {
  return (
    <Tooltip
      contentStyle={{
        fontSize: 11,
        backgroundColor: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 4,
      }}
      formatter={(value: number | string | readonly [number | string, number | string] | undefined) => {
        if (typeof value === 'number') {
          return formatter(value);
        }
        return formatter(undefined);
      }}
      labelFormatter={(label: string) => formatDateLabel(label)}
    />
  );
}
