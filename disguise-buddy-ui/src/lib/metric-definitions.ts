// ─── Metric definitions & chart theme ────────────────────────────────────────

export interface MetricDefinition {
  key: string
  label: string
  unit: string
  category: 'temperature' | 'voltage' | 'fan'
  /** Returns 'green' | 'amber' | 'red' based on value severity */
  severity: (value: number, nominal?: number) => 'green' | 'amber' | 'red'
  /** Amber threshold value (for reference lines) */
  amberThreshold?: number
  /** Red threshold value (for reference lines) */
  redThreshold?: number
}

export const METRICS: MetricDefinition[] = [
  {
    key: 'temperature',
    label: 'Temperature',
    unit: '\u00B0F',
    category: 'temperature',
    amberThreshold: 140,
    redThreshold: 167,
    severity: (value: number) => {
      if (value > 167) return 'red'
      if (value >= 140) return 'amber'
      return 'green'
    },
  },
  {
    key: 'voltage',
    label: 'Voltage',
    unit: 'V',
    category: 'voltage',
    severity: (value: number, nominal?: number) => {
      if (!nominal || nominal === 0) return 'green'
      const deviation = Math.abs((value - nominal) / nominal) * 100
      if (deviation > 10) return 'red'
      if (deviation >= 5) return 'amber'
      return 'green'
    },
  },
  {
    key: 'fan',
    label: 'Fan Speed',
    unit: 'RPM',
    category: 'fan',
    amberThreshold: 1000,
    redThreshold: 500,
    severity: (value: number) => {
      if (value < 500) return 'red'
      if (value <= 1000) return 'amber'
      return 'green'
    },
  },
]

/** One color per server — up to 8 distinguishable lines */
export const CHART_COLORS = [
  '#7C3AED', // primary purple
  '#06B6D4', // accent cyan
  '#22c55e', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#EC4899', // pink
  '#8B5CF6', // light purple
  '#14B8A6', // teal
] as const

export const CHART_THEME = {
  grid: '#2A2A3C',
  axis: '#64748B',
  tooltipBg: '#1E1E2E',
  tooltipBorder: '#2A2A3C',
  fontFamily: 'JetBrains Mono, monospace',
} as const

/** Get a color for a server by index (wraps around) */
export function getMetricColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]
}
