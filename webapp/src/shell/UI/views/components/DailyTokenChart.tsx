import type { ComponentType, JSX, ReactNode } from 'react';
import { useMemo } from 'react';
import { Bar, BarChart, Line, LineChart } from 'recharts';
import type { SessionMetric } from '@/shell/UI/views/hooks/useAgentMetrics';
import { aggregateTokensByDay, type DayTokenAggregation } from '@vt/graph-model/metrics';
import {
  AGENT_METRICS_CHART_MARGIN,
  formatTokenCount,
  type ChartMargin,
} from './AgentMetricsChartFormatting';
import {
  AgentChartContainer,
  AgentChartDateXAxis,
  AgentChartEmptyState,
  AgentChartGrid,
  AgentChartTooltip,
  AgentChartYAxis,
} from './AgentMetricsChartParts';

interface DailyTokenChartProps {
  readonly color: string;
  readonly dataKey: 'averageTokens' | 'totalTokens';
  readonly seriesType: 'bar' | 'line';
  readonly sessions: readonly SessionMetric[];
  readonly testId: string;
  readonly tooltipLabel: string;
}

interface TokenChartComponentProps {
  readonly children: ReactNode;
  readonly data: DayTokenAggregation[];
  readonly margin: ChartMargin;
}

function TokenChartScaffold(): JSX.Element {
  return (
    <>
      <AgentChartGrid />
      <AgentChartDateXAxis />
      <AgentChartYAxis tickFormatter={formatTokenCount} />
    </>
  );
}

function renderTokenSeries(
  color: string,
  dataKey: DailyTokenChartProps['dataKey'],
  seriesType: DailyTokenChartProps['seriesType']
): JSX.Element {
  if (seriesType === 'bar') {
    return <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />;
  }

  return (
    <Line
      type="monotone"
      dataKey={dataKey}
      stroke={color}
      strokeWidth={2}
      dot={{ fill: color, strokeWidth: 0, r: 3 }}
      activeDot={{ r: 5, fill: color }}
    />
  );
}

export function DailyTokenChart({
  color,
  dataKey,
  seriesType,
  sessions,
  testId,
  tooltipLabel,
}: DailyTokenChartProps): JSX.Element {
  const chartData: readonly DayTokenAggregation[] = useMemo(
    () => aggregateTokensByDay(sessions),
    [sessions]
  );

  if (chartData.length === 0) {
    return <AgentChartEmptyState message="No token data available" />;
  }

  const ChartComponent: ComponentType<TokenChartComponentProps> = (
    seriesType === 'bar' ? BarChart : LineChart
  ) as ComponentType<TokenChartComponentProps>;

  return (
    <AgentChartContainer testId={testId}>
      <ChartComponent
        data={chartData as DayTokenAggregation[]}
        margin={AGENT_METRICS_CHART_MARGIN}
      >
        <TokenChartScaffold />
        <AgentChartTooltip
          formatter={(value: number | undefined) => [formatTokenCount(value ?? 0), tooltipLabel]}
        />
        {renderTokenSeries(color, dataKey, seriesType)}
      </ChartComponent>
    </AgentChartContainer>
  );
}
