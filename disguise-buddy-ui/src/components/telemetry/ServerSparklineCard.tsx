import { useMemo } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { GlassCard } from '@/components/ui/Card'
import { Sparkline } from './Sparkline'
import type { MetricSeries } from '@/lib/telemetry-types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTrend(data: { value: number }[]): 'up' | 'down' | 'flat' {
  if (data.length < 5) return 'flat'
  const recent = data.slice(-5)
  const first = recent[0].value
  const last = recent[recent.length - 1].value
  const diff = last - first
  const threshold = Math.abs(first) * 0.02 || 0.5
  if (diff > threshold) return 'up'
  if (diff < -threshold) return 'down'
  return 'flat'
}

function currentValue(data: { value: number }[]): number | null {
  if (data.length === 0) return null
  return data[data.length - 1].value
}

const TREND_ICONS = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
} as const

const TREND_COLORS = {
  up: 'text-warning',
  down: 'text-accent',
  flat: 'text-textMuted',
} as const

// ─── Component ───────────────────────────────────────────────────────────────

interface ServerSparklineCardProps {
  serverId: string
  serverName: string
  color: string
  series: MetricSeries[]
  className?: string
}

export function ServerSparklineCard({
  serverId,
  serverName,
  color,
  series,
  className = '',
}: ServerSparklineCardProps) {
  const metricRows = useMemo(() => {
    const metrics = ['temperature', 'voltage', 'fan'] as const
    return metrics.map((key) => {
      const s = series.find((ms) => ms.serverId === serverId && ms.metricKey === key)
      return {
        key,
        label: key === 'temperature' ? 'Temp' : key === 'voltage' ? 'Voltage' : 'Fan',
        unit: key === 'temperature' ? '\u00B0C' : key === 'voltage' ? 'V' : 'RPM',
        data: s?.data ?? [],
        color: s?.color ?? color,
      }
    })
  }, [series, serverId, color])

  return (
    <GlassCard accent={color} className={className}>
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: color }}
        />
        <h4 className="text-text text-sm font-bold truncate">{serverName}</h4>
        <span className="text-textMuted text-[10px] font-mono ml-auto">{serverId}</span>
      </div>

      <div className="space-y-2">
        {metricRows.map((metric) => {
          const val = currentValue(metric.data)
          const trend = getTrend(metric.data)
          const TrendIcon = TREND_ICONS[trend]

          return (
            <div key={metric.key} className="flex items-center gap-2">
              <span className="text-textSecondary text-[10px] font-mono w-14 shrink-0">
                {metric.label}
              </span>
              <Sparkline data={metric.data} color={metric.color} width={100} height={24} />
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-text text-xs font-mono font-bold">
                  {val !== null ? `${val}` : '--'}
                </span>
                <span className="text-textMuted text-[9px] font-mono">{metric.unit}</span>
                <TrendIcon className={`w-3 h-3 ${TREND_COLORS[trend]}`} />
              </div>
            </div>
          )
        })}
      </div>
    </GlassCard>
  )
}
