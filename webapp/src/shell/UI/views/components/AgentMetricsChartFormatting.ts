export interface ChartMargin {
  readonly top: number;
  readonly right: number;
  readonly left: number;
  readonly bottom: number;
}

export const AGENT_METRICS_CHART_MARGIN: ChartMargin = {
  top: 5,
  right: 10,
  left: -10,
  bottom: 5,
};

export function formatDateLabel(dateStr: string): string {
  const date: Date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}
