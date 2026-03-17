export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatLabel(value: number): string {
  return `理论 ${formatPercent(value)}`;
}
