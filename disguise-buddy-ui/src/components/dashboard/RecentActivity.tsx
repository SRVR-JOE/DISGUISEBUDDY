import { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUpCircle,
  ArrowDownCircle,
  Thermometer,
  Zap,
  RefreshCw,
  Activity,
} from 'lucide-react'
import type { TelemetrySnapshot, ServerSnapshot } from '@/lib/telemetry-types'
import { GlassCard, Badge } from '@/components/ui'

// ─── Types ──────────────────────────────────────────────────────────────────

type EventType =
  | 'server-online'
  | 'server-offline'
  | 'temp-warning'
  | 'temp-critical'
  | 'power-fault'
  | 'status-change'

interface ActivityEvent {
  id: string
  timestamp: number
  serverIp: string
  serverName: string
  type: EventType
  description: string
}

interface RecentActivityProps {
  snapshots: TelemetrySnapshot[]
  maxItems?: number
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TEMP_WARNING_THRESHOLD = 60
const TEMP_CRITICAL_THRESHOLD = 75

const EVENT_CONFIG: Record<
  EventType,
  {
    icon: typeof ArrowUpCircle
    colorClass: string
    bgClass: string
    borderClass: string
    badgeVariant: 'success' | 'warning' | 'error' | 'info' | 'neutral'
    label: string
  }
> = {
  'server-online': {
    icon: ArrowUpCircle,
    colorClass: 'text-success',
    bgClass: 'bg-success/5',
    borderClass: 'border-success/20',
    badgeVariant: 'success',
    label: 'Online',
  },
  'server-offline': {
    icon: ArrowDownCircle,
    colorClass: 'text-error',
    bgClass: 'bg-error/5',
    borderClass: 'border-error/20',
    badgeVariant: 'error',
    label: 'Offline',
  },
  'temp-warning': {
    icon: Thermometer,
    colorClass: 'text-warning',
    bgClass: 'bg-warning/5',
    borderClass: 'border-warning/20',
    badgeVariant: 'warning',
    label: 'Temp',
  },
  'temp-critical': {
    icon: Thermometer,
    colorClass: 'text-error',
    bgClass: 'bg-error/5',
    borderClass: 'border-error/20',
    badgeVariant: 'error',
    label: 'Temp',
  },
  'power-fault': {
    icon: Zap,
    colorClass: 'text-error',
    bgClass: 'bg-error/5',
    borderClass: 'border-error/20',
    badgeVariant: 'error',
    label: 'Power',
  },
  'status-change': {
    icon: RefreshCw,
    colorClass: 'text-accent',
    bgClass: 'bg-accent/5',
    borderClass: 'border-accent/20',
    badgeVariant: 'info',
    label: 'Status',
  },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function serverDisplayName(server: ServerSnapshot): string {
  return server.hostname || server.mgmtIp
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`

  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

/**
 * Build a lookup map of servers keyed by mgmtIp for O(1) access.
 */
function buildServerMap(
  servers: ServerSnapshot[],
): Map<string, ServerSnapshot> {
  const map = new Map<string, ServerSnapshot>()
  for (const s of servers) {
    map.set(s.mgmtIp, s)
  }
  return map
}

/**
 * Compare two consecutive snapshots and emit activity events for any detected
 * changes. The "previous" snapshot is the older one; "current" is newer.
 */
function detectChanges(
  prev: TelemetrySnapshot,
  curr: TelemetrySnapshot,
): ActivityEvent[] {
  const events: ActivityEvent[] = []
  const prevMap = buildServerMap(prev.servers)
  const currMap = buildServerMap(curr.servers)
  const ts = curr.timestamp

  // Check every server in the current snapshot against the previous one
  for (const server of curr.servers) {
    const prevServer = prevMap.get(server.mgmtIp)
    const name = serverDisplayName(server)

    // ── Server came online ────────────────────────────────────────────
    if (
      prevServer &&
      prevServer.status === 'offline' &&
      server.status !== 'offline'
    ) {
      events.push({
        id: `${ts}-${server.mgmtIp}-online`,
        timestamp: ts,
        serverIp: server.mgmtIp,
        serverName: name,
        type: 'server-online',
        description: `Server came online`,
      })
    }

    // ── Server went offline ───────────────────────────────────────────
    if (
      prevServer &&
      prevServer.status !== 'offline' &&
      server.status === 'offline'
    ) {
      events.push({
        id: `${ts}-${server.mgmtIp}-offline`,
        timestamp: ts,
        serverIp: server.mgmtIp,
        serverName: name,
        type: 'server-offline',
        description: `Server went offline`,
      })
    }

    // ── Temperature threshold crossings ───────────────────────────────
    for (const temp of server.temperatures) {
      const prevTemp = prevServer?.temperatures.find(
        (t) => t.label === temp.label,
      )
      const prevVal = prevTemp?.value ?? 0

      // Crossed critical threshold (75C)
      if (prevVal < TEMP_CRITICAL_THRESHOLD && temp.value >= TEMP_CRITICAL_THRESHOLD) {
        events.push({
          id: `${ts}-${server.mgmtIp}-temp-crit-${temp.label}`,
          timestamp: ts,
          serverIp: server.mgmtIp,
          serverName: name,
          type: 'temp-critical',
          description: `${temp.label} reached ${temp.value.toFixed(0)}°C (critical)`,
        })
      }
      // Crossed warning threshold (60C) but not yet critical
      else if (
        prevVal < TEMP_WARNING_THRESHOLD &&
        temp.value >= TEMP_WARNING_THRESHOLD &&
        temp.value < TEMP_CRITICAL_THRESHOLD
      ) {
        events.push({
          id: `${ts}-${server.mgmtIp}-temp-warn-${temp.label}`,
          timestamp: ts,
          serverIp: server.mgmtIp,
          serverName: name,
          type: 'temp-warning',
          description: `${temp.label} reached ${temp.value.toFixed(0)}°C (warning)`,
        })
      }
    }

    // ── Power fault detected ──────────────────────────────────────────
    if (
      server.powerFault &&
      server.powerFault !== 'None' &&
      server.powerFault !== '' &&
      (!prevServer ||
        prevServer.powerFault !== server.powerFault)
    ) {
      events.push({
        id: `${ts}-${server.mgmtIp}-power-fault`,
        timestamp: ts,
        serverIp: server.mgmtIp,
        serverName: name,
        type: 'power-fault',
        description: `Power fault: ${server.powerFault}`,
      })
    }

    // ── Generic status change (catch-all for any transition) ──────────
    if (
      prevServer &&
      prevServer.status !== server.status &&
      // Skip if already covered by online/offline events
      !(prevServer.status === 'offline' && server.status !== 'offline') &&
      !(prevServer.status !== 'offline' && server.status === 'offline')
    ) {
      events.push({
        id: `${ts}-${server.mgmtIp}-status-${server.status}`,
        timestamp: ts,
        serverIp: server.mgmtIp,
        serverName: name,
        type: 'status-change',
        description: `Status changed: ${prevServer.status} → ${server.status}`,
      })
    }
  }

  // Check for servers that disappeared entirely (present in prev, absent in curr)
  for (const prevServer of prev.servers) {
    if (!currMap.has(prevServer.mgmtIp)) {
      const name = serverDisplayName(prevServer)
      events.push({
        id: `${ts}-${prevServer.mgmtIp}-disappeared`,
        timestamp: ts,
        serverIp: prevServer.mgmtIp,
        serverName: name,
        type: 'server-offline',
        description: `Server disappeared from telemetry`,
      })
    }
  }

  return events
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RecentActivity({
  snapshots,
  maxItems = 20,
}: RecentActivityProps) {
  const events = useMemo(() => {
    if (snapshots.length < 2) return []

    // Sort snapshots by timestamp ascending so we compare older → newer
    const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp)

    const all: ActivityEvent[] = []
    for (let i = 1; i < sorted.length; i++) {
      const changes = detectChanges(sorted[i - 1], sorted[i])
      all.push(...changes)
    }

    // Deduplicate by id (in case snapshots overlap)
    const seen = new Set<string>()
    const unique: ActivityEvent[] = []
    for (const e of all) {
      if (!seen.has(e.id)) {
        seen.add(e.id)
        unique.push(e)
      }
    }

    // Sort newest-first, then cap at maxItems
    unique.sort((a, b) => b.timestamp - a.timestamp)
    return unique.slice(0, maxItems)
  }, [snapshots, maxItems])

  return (
    <GlassCard title="Recent Activity">
      <div
        className="overflow-y-auto pr-1 -mr-1"
        style={{
          maxHeight: 400,
          scrollbarWidth: 'thin',
          scrollbarColor: '#2A2A3C #1A1A24',
        }}
      >
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Activity className="w-8 h-8 text-textMuted opacity-40" />
            <p className="text-textMuted text-sm font-mono">
              No recent activity
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* Vertical timeline track */}
            <div
              className="absolute left-[15px] top-2 bottom-2 w-px bg-border"
              aria-hidden="true"
            />

            <AnimatePresence initial={false}>
              {events.map((event) => {
                const config = EVENT_CONFIG[event.type]
                const Icon = config.icon

                return (
                  <motion.div
                    key={event.id}
                    layout
                    initial={{ opacity: 0, y: -12, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.95 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className={[
                      'relative flex items-start gap-3 rounded-lg px-3 py-2.5 mb-1',
                      'border',
                      config.bgClass,
                      config.borderClass,
                    ].join(' ')}
                  >
                    {/* Icon circle on the timeline */}
                    <div
                      className={[
                        'relative z-10 flex items-center justify-center',
                        'w-[30px] h-[30px] rounded-full shrink-0',
                        'bg-bg border border-border',
                      ].join(' ')}
                    >
                      <Icon
                        className={`w-4 h-4 ${config.colorClass}`}
                        strokeWidth={2}
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-text text-xs font-bold truncate">
                          {event.serverName}
                        </span>
                        <Badge variant={config.badgeVariant}>
                          {config.label}
                        </Badge>
                      </div>
                      <p className="text-textSecondary text-xs mt-0.5 leading-relaxed">
                        {event.description}
                      </p>
                    </div>

                    {/* Timestamp */}
                    <span className="text-textMuted text-[10px] font-mono shrink-0 pt-1 tabular-nums">
                      {formatRelativeTime(event.timestamp)}
                    </span>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </GlassCard>
  )
}
