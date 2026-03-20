import { useMemo } from 'react'
import { AlertTriangle, AlertCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import type { AnomalyEvent } from '@/lib/telemetry-types'
import { CHART_THEME } from '@/lib/metric-definitions'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${month}/${day} ${formatTime(ts)}`
}

// ─── Component ───────────────────────────────────────────────────────────────

interface AnomalyTimelineProps {
  anomalies: AnomalyEvent[]
  className?: string
  /** Max height for the scrollable event list (px) */
  maxHeight?: number
}

export function AnomalyTimeline({
  anomalies,
  className = '',
  maxHeight = 320,
}: AnomalyTimelineProps) {
  const sorted = useMemo(
    () => [...anomalies].sort((a, b) => b.timestamp - a.timestamp),
    [anomalies],
  )

  // Compute timeline bar positions
  const timelineDots = useMemo(() => {
    if (sorted.length === 0) return []
    const minTs = sorted[sorted.length - 1].timestamp
    const maxTs = sorted[0].timestamp
    const range = maxTs - minTs || 1

    return sorted.map((a) => ({
      id: a.id,
      severity: a.severity,
      pct: ((a.timestamp - minTs) / range) * 100,
    }))
  }, [sorted])

  if (anomalies.length === 0) {
    return (
      <div className={`text-textMuted text-sm font-mono text-center py-6 ${className}`}>
        No anomalies detected
      </div>
    )
  }

  return (
    <div className={className}>
      {/* Timeline bar */}
      <div className="relative h-8 mb-4 rounded-lg bg-surface border border-border overflow-hidden">
        {/* Track */}
        <div className="absolute inset-y-0 left-0 right-0 flex items-center px-2">
          <div className="w-full h-0.5 bg-border rounded" />
        </div>

        {/* Dots */}
        {timelineDots.map((dot) => (
          <div
            key={dot.id}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
            style={{ left: `${Math.max(2, Math.min(98, dot.pct))}%` }}
          >
            <div
              className="w-2.5 h-2.5 rounded-full border"
              style={{
                background: dot.severity === 'critical' ? '#EF4444' : '#F59E0B',
                borderColor: dot.severity === 'critical' ? '#EF4444' : '#F59E0B',
                boxShadow: `0 0 6px ${dot.severity === 'critical' ? 'rgba(239,68,68,0.5)' : 'rgba(245,158,11,0.5)'}`,
              }}
            />
          </div>
        ))}
      </div>

      {/* Event list */}
      <div
        className="space-y-1 overflow-y-auto pr-1"
        style={{ maxHeight, scrollbarWidth: 'thin', scrollbarColor: '#2A2A3C #1A1A24' }}
      >
        {sorted.map((event, i) => {
          const Icon = event.severity === 'critical' ? AlertCircle : AlertTriangle
          const severityColor = event.severity === 'critical' ? 'text-error' : 'text-warning'
          const bgColor = event.severity === 'critical' ? 'bg-error/5' : 'bg-warning/5'
          const borderColor = event.severity === 'critical' ? 'border-error/20' : 'border-warning/20'

          return (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.3), duration: 0.2 }}
              className={`flex items-start gap-2 rounded-lg px-3 py-2 border ${bgColor} ${borderColor}`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${severityColor}`} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-text text-xs font-bold truncate">
                    {event.serverName}
                  </span>
                  <span className="text-textMuted text-[10px] font-mono">
                    {event.metricLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className={`text-xs font-mono font-bold ${severityColor}`}
                  >
                    {event.value}{event.unit}
                  </span>
                  <span className="text-textMuted text-[10px] font-mono">
                    threshold: {event.threshold}{event.unit}
                  </span>
                </div>
              </div>

              <span
                className="text-textMuted text-[10px] font-mono shrink-0"
                style={{ fontFamily: CHART_THEME.fontFamily }}
              >
                {formatDate(event.timestamp)}
              </span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
