import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { MetricSeries, TimeRange } from '@/lib/telemetry-types'
import { CHART_THEME } from '@/lib/metric-definitions'
import { ChartTooltip } from './ChartTooltip'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeTick(timestamp: number, timeRange: TimeRange): string {
  const d = new Date(timestamp)
  if (timeRange === '24h') {
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hour = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${month}/${day} ${hour}:${min}`
  }
  const hour = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${hour}:${min}`
}

// ─── Component ───────────────────────────────────────────────────────────────

interface ThresholdLine {
  value: number
  color: string
  label?: string
  strokeDasharray?: string
}

interface TimeSeriesChartProps {
  series: MetricSeries[]
  timeRange: TimeRange
  unit?: string
  height?: number
  /** Amber threshold (dashed amber line) */
  amberThreshold?: number
  /** Red threshold (dashed red line) */
  redThreshold?: number
  /** Nominal value (dotted white line) */
  nominal?: number
  /** Extra reference lines */
  referenceLines?: ThresholdLine[]
}

export function TimeSeriesChart({
  series,
  timeRange,
  unit = '',
  height = 280,
  amberThreshold,
  redThreshold,
  nominal,
  referenceLines = [],
}: TimeSeriesChartProps) {
  // Merge all series data into a single array keyed by timestamp
  const chartData = useMemo(() => {
    const timeMap = new Map<number, Record<string, number>>()

    for (const s of series) {
      for (const point of s.data) {
        if (!timeMap.has(point.timestamp)) {
          timeMap.set(point.timestamp, { timestamp: point.timestamp })
        }
        timeMap.get(point.timestamp)![s.serverId] = point.value
      }
    }

    return Array.from(timeMap.values()).sort((a, b) => a.timestamp - b.timestamp)
  }, [series])

  if (series.length === 0 || chartData.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-textMuted text-sm font-mono"
        style={{ height }}
      >
        No data available
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={`grad-${s.serverId}`} id={`grad-${s.serverId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        <CartesianGrid stroke={CHART_THEME.grid} strokeDasharray="3 3" vertical={false} />

        <XAxis
          dataKey="timestamp"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(ts: number) => formatTimeTick(ts, timeRange)}
          tick={{ fill: CHART_THEME.axis, fontSize: 10, fontFamily: CHART_THEME.fontFamily }}
          stroke={CHART_THEME.grid}
          tickLine={false}
          axisLine={false}
        />

        <YAxis
          tick={{ fill: CHART_THEME.axis, fontSize: 10, fontFamily: CHART_THEME.fontFamily }}
          stroke={CHART_THEME.grid}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => `${v}${unit}`}
        />

        <Tooltip content={<ChartTooltip unit={unit} />} />

        {/* Nominal reference line (white dotted) */}
        {nominal !== undefined && (
          <ReferenceLine
            y={nominal}
            stroke="#E2E8F0"
            strokeDasharray="2 4"
            strokeOpacity={0.5}
            label={{
              value: `nom ${nominal}${unit}`,
              position: 'right',
              fill: '#64748B',
              fontSize: 9,
              fontFamily: CHART_THEME.fontFamily,
            }}
          />
        )}

        {/* Amber threshold */}
        {amberThreshold !== undefined && (
          <ReferenceLine
            y={amberThreshold}
            stroke="#F59E0B"
            strokeDasharray="6 3"
            strokeOpacity={0.6}
            label={{
              value: `${amberThreshold}${unit}`,
              position: 'right',
              fill: '#F59E0B',
              fontSize: 9,
              fontFamily: CHART_THEME.fontFamily,
            }}
          />
        )}

        {/* Red threshold */}
        {redThreshold !== undefined && (
          <ReferenceLine
            y={redThreshold}
            stroke="#EF4444"
            strokeDasharray="6 3"
            strokeOpacity={0.6}
            label={{
              value: `${redThreshold}${unit}`,
              position: 'right',
              fill: '#EF4444',
              fontSize: 9,
              fontFamily: CHART_THEME.fontFamily,
            }}
          />
        )}

        {/* Extra reference lines */}
        {referenceLines.map((rl, i) => (
          <ReferenceLine
            key={`ref-${rl.value}-${i}`}
            y={rl.value}
            stroke={rl.color}
            strokeDasharray={rl.strokeDasharray ?? '6 3'}
            strokeOpacity={0.6}
            label={
              rl.label
                ? {
                    value: rl.label,
                    position: 'right' as const,
                    fill: rl.color,
                    fontSize: 9,
                    fontFamily: CHART_THEME.fontFamily,
                  }
                : undefined
            }
          />
        ))}

        {/* Data lines with gradient fills */}
        {series.map((s) => (
          <Line
            key={s.serverId}
            type="monotone"
            dataKey={s.serverId}
            name={s.serverName}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: s.color, strokeWidth: 2, fill: '#0F0F14' }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
