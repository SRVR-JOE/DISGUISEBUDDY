import { motion } from 'framer-motion'
import {
  Server,
  CheckCircle,
  AlertTriangle,
  XCircle,
  WifiOff,
  Thermometer,
  FileText,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard } from '@/components/ui'
import type { ServerSnapshot } from '@/lib/telemetry-types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FleetSummaryProps {
  servers: ServerSnapshot[]
  profileCount: number
  loading?: boolean
}

// ─── Stat card definition ────────────────────────────────────────────────────

interface StatDef {
  key: string
  label: string
  icon: LucideIcon
  /** Tailwind color class for the accent border & icon tint */
  accent: string
  /** CSS color string passed to GlassCard accent prop */
  accentHex: string
  getValue: (servers: ServerSnapshot[], profileCount: number) => string
}

// ─── Temperature color helper ────────────────────────────────────────────────

function tempColor(avg: number): { accent: string; accentHex: string } {
  if (avg <= 0) return { accent: 'text-textMuted', accentHex: '#64748B' }
  if (avg < 140) return { accent: 'text-success', accentHex: '#10B981' }
  if (avg < 167) return { accent: 'text-warning', accentHex: '#F59E0B' }
  return { accent: 'text-error', accentHex: '#EF4444' }
}

function computeAvgTemp(servers: ServerSnapshot[]): number {
  // For each server, take the highest temperature reading, then average across all servers
  const maxTemps = servers
    .map((s) => {
      if (!s.temperatures || s.temperatures.length === 0) return null
      return Math.max(...s.temperatures.map((t) => t.value))
    })
    .filter((t): t is number => t !== null)

  if (maxTemps.length === 0) return 0
  return maxTemps.reduce((sum, t) => sum + t, 0) / maxTemps.length
}

// ─── Stat definitions ────────────────────────────────────────────────────────

const staticStats: StatDef[] = [
  {
    key: 'total',
    label: 'Total Servers',
    icon: Server,
    accent: 'text-accent',
    accentHex: '#06B6D4',
    getValue: (servers) => String(servers.length),
  },
  {
    key: 'online',
    label: 'Online',
    icon: CheckCircle,
    accent: 'text-success',
    accentHex: '#10B981',
    getValue: (servers) =>
      String(servers.filter((s) => s.status === 'online').length),
  },
  {
    key: 'warnings',
    label: 'Warnings',
    icon: AlertTriangle,
    accent: 'text-warning',
    accentHex: '#F59E0B',
    getValue: (servers) =>
      String(servers.filter((s) => s.status === 'warning').length),
  },
  {
    key: 'errors',
    label: 'Errors',
    icon: XCircle,
    accent: 'text-error',
    accentHex: '#EF4444',
    getValue: (servers) =>
      String(servers.filter((s) => s.status === 'error').length),
  },
  {
    key: 'offline',
    label: 'Offline',
    icon: WifiOff,
    accent: 'text-textMuted',
    accentHex: '#64748B',
    getValue: (servers) =>
      String(servers.filter((s) => s.status === 'offline').length),
  },
]

// ─── Skeleton card ───────────────────────────────────────────────────────────

function SkeletonCard({ index }: { index: number }) {
  return (
    <motion.div
      className="min-w-[140px] flex-1"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
    >
      <GlassCard>
        <div className="flex items-center gap-3">
          {/* Icon placeholder */}
          <div className="w-9 h-9 rounded-lg bg-surface animate-pulse" />
          <div className="flex flex-col gap-1.5">
            {/* Number placeholder */}
            <div className="w-10 h-6 rounded bg-surface animate-pulse" />
            {/* Label placeholder */}
            <div className="w-16 h-3 rounded bg-surface animate-pulse" />
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ─── Single stat card ────────────────────────────────────────────────────────

interface StatCardProps {
  icon: LucideIcon
  value: string
  label: string
  accent: string
  accentHex: string
  index: number
}

function StatCard({ icon: Icon, value, label, accent, accentHex, index }: StatCardProps) {
  return (
    <motion.div
      className="min-w-[140px] flex-1"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut', delay: index * 0.05 }}
    >
      <GlassCard accent={accentHex}>
        <div className="flex items-center gap-3">
          {/* Icon container */}
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${accentHex}15` }}
          >
            <Icon size={18} className={accent} />
          </div>

          {/* Value + label */}
          <div className="flex flex-col min-w-0">
            <span className="font-mono text-xl font-bold text-text leading-tight tracking-tight">
              {value}
            </span>
            <span className="text-xs text-textSecondary font-sans leading-tight truncate">
              {label}
            </span>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ─── FleetSummary ────────────────────────────────────────────────────────────

export function FleetSummary({ servers, profileCount, loading = false }: FleetSummaryProps) {
  // Total number of cards (static stats + temperature + profiles)
  const totalCards = staticStats.length + 2

  if (loading) {
    return (
      <div className="flex flex-wrap gap-3" role="status" aria-label="Loading fleet summary">
        {Array.from({ length: totalCards }).map((_, i) => (
          <SkeletonCard key={i} index={i} />
        ))}
      </div>
    )
  }

  const avgTemp = computeAvgTemp(servers)
  const { accent: tempAccent, accentHex: tempAccentHex } = tempColor(avgTemp)
  const tempDisplay = avgTemp > 0 ? `${avgTemp.toFixed(1)}\u00B0F` : '--'

  return (
    <div
      className="flex flex-wrap gap-3"
      role="region"
      aria-label="Fleet health summary"
    >
      {/* Static status cards */}
      {staticStats.map((stat, i) => (
        <StatCard
          key={stat.key}
          icon={stat.icon}
          value={stat.getValue(servers, profileCount)}
          label={stat.label}
          accent={stat.accent}
          accentHex={stat.accentHex}
          index={i}
        />
      ))}

      {/* Average temperature */}
      <StatCard
        icon={Thermometer}
        value={tempDisplay}
        label="Avg Temperature"
        accent={tempAccent}
        accentHex={tempAccentHex}
        index={staticStats.length}
      />

      {/* Profile count */}
      <StatCard
        icon={FileText}
        value={String(profileCount)}
        label="Profiles"
        accent="text-primary"
        accentHex="#7C3AED"
        index={staticStats.length + 1}
      />
    </div>
  )
}
