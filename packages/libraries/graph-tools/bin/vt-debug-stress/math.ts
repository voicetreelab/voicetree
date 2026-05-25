export function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

export function uniqueSorted(values: readonly string[]): string[] {
  return sortStrings([...new Set(values)])
}

export function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Number(((numerator / denominator) * 100).toFixed(2))
}

export function pad(index: number): string {
  return String(index).padStart(3, '0')
}
