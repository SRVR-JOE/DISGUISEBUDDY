import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Thermometer,
  Fan,
  Power,
  Server,
  Activity,
  AlertTriangle,
  Clock,
} from 'lucide-react'
import { GlassCard, Badge, StatusDot } from '@/components/ui'
import type { ServerSnapshot } from '@/lib/telemetry-types'

// ─── Props ──────────────────────────────────────────────────────────────────────

export interface ServerHealthGridProps {
  servers: ServerSnapshot[]
  loading?: boolean
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const STATUS_ACCENT: Record<ServerSnapshot['status'], string> = {
  online: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  offline: '#64748B',
}

const STATUS_BADGE_VARIANT: Record<
  ServerSnapshot['status'],
  'success' | 'warning' | 'error' | 'neutral'
> = {
  online: 'success',
  warning: 'warning',
  error: 'error',
  offline: 'neutral',
}

const ROLE_VARIANT: Record<string, 'info' | 'neutral'> = {
  Director: 'info',
  Actor: 'neutral',
  Understudy: 'neutral',
}

// ─── Animation variants ─────────────────────────────────────────────────────────

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06 },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.2 },
  },
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getMaxTemperature(temps: ServerSnapshot['temperatures']): number | null {
  if (!temps || temps.length === 0) return null
  return Math.max(...temps.map((t) => t.value))
}

function getTempColor(value: number): string {
  if (value >= 75) return 'text-error'
  if (value >= 60) return 'text-warning'
  return 'text-success'
}

function getTempBg(value: number): string {
  if (value >= 75) return 'bg-error/15'
  if (value >= 60) return 'bg-warning/15'
  return 'bg-success/15'
}

function getFanStatusSummary(fans: ServerSnapshot['fans']): {
  count: number
  healthy: boolean
  label: string
} {
  if (!fans || fans.length === 0) return { count: 0, healthy: true, label: 'N/A' }
  const stalled = fans.filter((f) => f.rpm === 0)
  return {
    count: fans.length,
    healthy: stalled.length === 0,
    label: stalled.length > 0 ? `${stalled.length} stalled` : 'All OK',
  }
}

function formatUptime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  if (diff < 0) return 'just now'

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`

  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function getPowerVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  const lower = status.toLowerCase()
  if (lower === 'on' || lower === 'ok' || lower === 'normal') return 'success'
  if (lower === 'off' || lower === 'standby') return 'neutral'
  if (lower === 'fault' || lower === 'error') return 'error'
  return 'warning'
}

// ─── Skeleton loader ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="glass-card relative overflow-hidden border-l-4 border-l-border p-5 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-surface" />
        <div className="h-4 w-28 bg-surface rounded" />
        <div className="h-3 w-20 bg-surface rounded ml-auto" />
      </div>

      {/* Role + type skeleton */}
      <div className="flex items-center gap-2 mb-4">
        <div className="h-5 w-16 bg-surface rounded-full" />
        <div className="h-5 w-12 bg-surface rounded-full" />
      </div>

      {/* Metrics skeleton rows */}
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-4 h-4 bg-surface rounded" />
            <div className="h-3 w-16 bg-surface rounded" />
            <div className="h-3 w-12 bg-surface rounded ml-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

// ─── Server card ────────────────────────────────────────────────────────────────

interface ServerCardProps {
  server: ServerSnapshot
}

function ServerCard({ server }: ServerCardProps) {
  const maxTemp = useMemo(
    () => getMaxTemperature(server.temperatures),
    [server.temperatures],
  )
  const fanStatus = useMemo(() => getFanStatusSummary(server.fans), [server.fans])
  const uptime = useMemo(() => formatUptime(server.timestamp), [server.timestamp])

  const accent = STATUS_ACCENT[server.status]

  return (
    <motion.div variants={cardVariants} layout>
      <GlassCard accent={accent} className="h-full">
        {/* ── Header: hostname + status + IP ── */}
        <div className="flex items-start gap-2 mb-3">
          <StatusDot
            status={server.status === 'error' ? 'offline' : server.status}
            className="mt-1"
          />
          <div className="min-w-0 flex-1">
            <h4 className="text-text text-sm font-bold truncate leading-tight">
              {server.hostname}
            </h4>
            <span className="text-textMuted text-[10px] font-mono">
              {server.mgmtIp}
            </span>
          </div>
          <Badge variant={STATUS_BADGE_VARIANT[server.status]} pulse={server.status === 'online'}>
            {server.status}
          </Badge>
        </div>

        {/* ── Role + Type badges ── */}
        <div className="flex items-center gap-1.5 mb-4">
          <Badge variant={ROLE_VARIANT[server.role] ?? 'neutral'}>
            <Server className="w-2.5 h-2.5 mr-0.5 inline-block" />
            {server.role}
          </Badge>
          {server.type && (
            <Badge variant="neutral">
              {server.type}
            </Badge>
          )}
        </div>

        {/* ── Metric rows ── */}
        <div className="space-y-2.5">
          {/* Power status */}
          <div className="flex items-center gap-2 text-xs">
            <Power className="w-3.5 h-3.5 text-textMuted shrink-0" />
            <span className="text-textSecondary font-medium">Power</span>
            <Badge variant={getPowerVariant(server.powerStatus)} className="ml-auto">
              {server.powerStatus}
            </Badge>
          </div>

          {/* Temperature */}
          <div className="flex items-center gap-2 text-xs">
            <Thermometer className="w-3.5 h-3.5 text-textMuted shrink-0" />
            <span className="text-textSecondary font-medium">Temp</span>
            <div className="ml-auto flex items-center gap-1.5">
              {maxTemp !== null ? (
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-bold ${getTempColor(maxTemp)} ${getTempBg(maxTemp)}`}
                >
                  {maxTemp.toFixed(0)}&deg;C
                </span>
              ) : (
                <span className="text-textMuted font-mono text-[11px]">--</span>
              )}
            </div>
          </div>

          {/* Fans */}
          <div className="flex items-center gap-2 text-xs">
            <Fan className="w-3.5 h-3.5 text-textMuted shrink-0" />
            <span className="text-textSecondary font-medium">Fans</span>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-textMuted font-mono text-[11px]">
                {fanStatus.count}x
              </span>
              <span
                className={`text-[11px] font-semibold ${fanStatus.healthy ? 'text-success' : 'text-error'}`}
              >
                {fanStatus.label}
              </span>
            </div>
          </div>

          {/* Uptime */}
          <div className="flex items-center gap-2 text-xs">
            <Clock className="w-3.5 h-3.5 text-textMuted shrink-0" />
            <span className="text-textSecondary font-medium">Uptime</span>
            <span className="ml-auto text-text font-mono text-[11px] font-bold">
              {uptime}
            </span>
          </div>
        </div>

        {/* ── Error area ── */}
        {server.errors.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="w-3 h-3 text-error shrink-0" />
              <span className="text-error text-[10px] font-bold uppercase tracking-wider">
                {server.errors.length} error{server.errors.length > 1 ? 's' : ''}
              </span>
            </div>
            <ul className="space-y-0.5">
              {server.errors.slice(0, 3).map((err, idx) => (
                <li
                  key={idx}
                  className="text-error/80 text-[10px] font-mono leading-snug truncate"
                  title={err}
                >
                  {err}
                </li>
              ))}
              {server.errors.length > 3 && (
                <li className="text-error/60 text-[10px] font-mono">
                  +{server.errors.length - 3} more
                </li>
              )}
            </ul>
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────────

export function ServerHealthGrid({ servers, loading = false }: ServerHealthGridProps) {
  if (loading) {
    return <LoadingSkeleton />
  }

  if (servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Activity className="w-10 h-10 text-textMuted mb-3" />
        <p className="text-textSecondary text-sm font-medium">No servers detected</p>
        <p className="text-textMuted text-xs mt-1">
          Waiting for telemetry data from disguise servers...
        </p>
      </div>
    )
  }

  return (
    <motion.div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <AnimatePresence mode="popLayout">
        {servers.map((server) => (
          <ServerCard key={server.mgmtIp} server={server} />
        ))}
      </AnimatePresence>
    </motion.div>
  )
}
