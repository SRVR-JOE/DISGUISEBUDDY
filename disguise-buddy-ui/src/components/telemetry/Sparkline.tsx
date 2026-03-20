import { LineChart, Line, ResponsiveContainer } from 'recharts'
import type { DataPoint } from '@/lib/telemetry-types'

interface SparklineProps {
  data: DataPoint[]
  color?: string
  width?: number
  height?: number
}

export function Sparkline({
  data,
  color = '#7C3AED',
  width = 120,
  height = 32,
}: SparklineProps) {
  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-textMuted text-[9px] font-mono"
        style={{ width, height }}
      >
        --
      </div>
    )
  }

  const gradientId = `spark-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 6)}`

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
