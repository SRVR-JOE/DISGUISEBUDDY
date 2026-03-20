import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts'
import { GlassCard } from '@/components/ui'
import type { TelemetrySnapshot } from '@/lib/telemetry-types'

// ─── Types ──────────────────────────────────────────────────────────────────

interface TemperatureOverviewProps {
  snapshots: TelemetrySnapshot[]
  loading?: boolean
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PALETTE = [
  '#7C3AED',
  '#06B6D4',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
] as const

const GRID_COLOR = '#2A2A3C'
const TEXT_COLOR = '#94A3B8'
const FONT_FAMILY = 'JetBrains Mono, monospace'
const WARNING_TEMP = 140
const CRITICAL_TEMP = 167

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTimeTick(timestamp: number): string {
  const d = new Date(timestamp)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getServerColor(index: number): string {
  return PALETTE[index % PALETTE.length]
}

/**
 * Derive the highest temperature reading for a server at a given snapshot.
 * Returns `undefined` when the server has no temperature data.
 */
function peakTemp(temps: { label: string; value: number }[]): number | undefined {
  if (temps.length === 0) return undefined
  return Math.max(...temps.map((t) => t.value))
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

const SKELETON_HEIGHTS = [45, 72, 38, 65, 55, 82, 48, 70]

function TemperatureSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {/* Fake axis + bars */}
      <div className="flex gap-3 items-end h-48">
        <div className="w-8 h-full bg-white/[0.04] rounded" />
        <div className="flex-1 flex items-end gap-1.5">
          {SKELETON_HEIGHTS.map((height, i) => (
            <div
              key={i}
              className="flex-1 bg-white/[0.04] rounded-t"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </div>
      {/* Fake legend */}
      <div className="flex gap-4 justify-center">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-white/[0.06]" />
            <div className="w-16 h-3 bg-white/[0.06] rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Custom Tooltip ─────────────────────────────────────────────────────────

interface PayloadEntry {
  dataKey?: string | number
  name?: string
  value?: number | string
  color?: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: PayloadEntry[]
  label?: number | string
}

function TemperatureTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const time =
    typeof label === 'number'
      ? new Date(label).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : label

  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        background: '#1E1E2E',
        border: `1px solid ${GRID_COLOR}`,
        boxShadow: '0 0 20px rgba(124, 58, 237, 0.15)',
        fontFamily: FONT_FAMILY,
      }}
    >
      <p style={{ color: TEXT_COLOR }} className="mb-1">
        {time}
      </p>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: entry.color }}
          />
          <span style={{ color: TEXT_COLOR }}>{entry.name}</span>
          <span className="text-white font-bold ml-auto">
            {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
            <span style={{ color: TEXT_COLOR }} className="ml-0.5">
              °F
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Custom Legend ───────────────────────────────────────────────────────────

interface LegendPayloadEntry {
  value?: string
  color?: string
}

function TemperatureLegend({ payload }: { payload?: LegendPayloadEntry[] }) {
  if (!payload || payload.length === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2">
      {payload.map((entry) => (
        <div key={entry.value} className="flex items-center gap-1.5 text-xs" style={{ fontFamily: FONT_FAMILY }}>
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: entry.color }}
          />
          <span style={{ color: TEXT_COLOR }}>{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center py-12 text-sm"
      style={{ color: TEXT_COLOR, fontFamily: FONT_FAMILY }}
    >
      <svg
        className="w-10 h-10 mb-3 opacity-30"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
        />
      </svg>
      <span>No temperature data available</span>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function TemperatureOverview({ snapshots, loading = false }: TemperatureOverviewProps) {
  // Collect unique servers (preserving first-seen order) and build chart data
  const { chartData, servers } = useMemo(() => {
    const serverMap = new Map<string, { hostname: string; color: string }>()
    const data: Record<string, number | undefined>[] = []

    for (const snap of snapshots) {
      const point: Record<string, number | undefined> = { timestamp: snap.timestamp } as Record<string, number | undefined>

      for (const srv of snap.servers) {
        // Register server on first encounter
        if (!serverMap.has(srv.mgmtIp)) {
          serverMap.set(srv.mgmtIp, {
            hostname: srv.hostname,
            color: getServerColor(serverMap.size),
          })
        }

        const peak = peakTemp(srv.temperatures)
        if (peak !== undefined) {
          point[srv.mgmtIp] = peak
        }
      }

      data.push(point)
    }

    // Sort chronologically
    data.sort((a, b) => (a.timestamp as number) - (b.timestamp as number))

    return {
      chartData: data,
      servers: Array.from(serverMap.entries()).map(([ip, info]) => ({
        mgmtIp: ip,
        ...info,
      })),
    }
  }, [snapshots])

  const isEmpty = snapshots.length === 0 || servers.length === 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <GlassCard title="Temperature Trend">
        {loading ? (
          <TemperatureSkeleton />
        ) : isEmpty ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={formatTimeTick}
                tick={{ fill: TEXT_COLOR, fontSize: 10, fontFamily: FONT_FAMILY }}
                stroke={GRID_COLOR}
                tickLine={false}
                axisLine={false}
              />

              <YAxis
                tick={{ fill: TEXT_COLOR, fontSize: 10, fontFamily: FONT_FAMILY }}
                stroke={GRID_COLOR}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v: number) => `${v}°F`}
              />

              <Tooltip content={<TemperatureTooltip />} />

              {/* Warning threshold – 60 °F */}
              <ReferenceLine
                y={WARNING_TEMP}
                stroke="#F59E0B"
                strokeDasharray="6 3"
                strokeOpacity={0.6}
                label={{
                  value: `${WARNING_TEMP}°F`,
                  position: 'right' as const,
                  fill: '#F59E0B',
                  fontSize: 9,
                  fontFamily: FONT_FAMILY,
                }}
              />

              {/* Critical threshold – 75 °F */}
              <ReferenceLine
                y={CRITICAL_TEMP}
                stroke="#EF4444"
                strokeDasharray="6 3"
                strokeOpacity={0.6}
                label={{
                  value: `${CRITICAL_TEMP}°F`,
                  position: 'right' as const,
                  fill: '#EF4444',
                  fontSize: 9,
                  fontFamily: FONT_FAMILY,
                }}
              />

              <Legend content={<TemperatureLegend />} />

              {servers.map((srv) => (
                <Line
                  key={srv.mgmtIp}
                  type="monotone"
                  dataKey={srv.mgmtIp}
                  name={srv.hostname}
                  stroke={srv.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{
                    r: 4,
                    stroke: srv.color,
                    strokeWidth: 2,
                    fill: '#0F0F14',
                  }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </GlassCard>
    </motion.div>
  )
}
