import { CHART_THEME } from '@/lib/metric-definitions'

// ─── Custom Recharts tooltip ─────────────────────────────────────────────────

interface PayloadEntry {
  dataKey?: string | number
  name?: string
  value?: number | string
  color?: string
}

interface ChartTooltipProps {
  active?: boolean
  payload?: PayloadEntry[]
  label?: number | string
  unit?: string
}

export function ChartTooltip({ active, payload, label, unit = '' }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const time = typeof label === 'number'
    ? new Date(label).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : label

  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        background: CHART_THEME.tooltipBg,
        border: `1px solid ${CHART_THEME.tooltipBorder}`,
        boxShadow: '0 0 20px rgba(124, 58, 237, 0.15)',
        fontFamily: CHART_THEME.fontFamily,
      }}
    >
      <p className="text-textMuted mb-1">{time}</p>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: entry.color }}
          />
          <span className="text-textSecondary">{entry.name}</span>
          <span className="text-text font-bold ml-auto">
            {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
            {unit && <span className="text-textMuted ml-0.5">{unit}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Glowing active dot for anomalous points ─────────────────────────────────

interface GlowDotProps {
  cx?: number
  cy?: number
  fill?: string
  isAnomaly?: boolean
}

export function GlowDot({ cx, cy, fill = '#7C3AED', isAnomaly = false }: GlowDotProps) {
  if (cx === undefined || cy === undefined) return null

  if (!isAnomaly) {
    return <circle cx={cx} cy={cy} r={3} fill={fill} stroke="none" />
  }

  return (
    <g>
      <circle cx={cx} cy={cy} r={8} fill={fill} opacity={0.2}>
        <animate
          attributeName="r"
          values="6;10;6"
          dur="1.5s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.3;0.1;0.3"
          dur="1.5s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx={cx} cy={cy} r={4} fill={fill} stroke="#0F0F14" strokeWidth={1.5} />
    </g>
  )
}
