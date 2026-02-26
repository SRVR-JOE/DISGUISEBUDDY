import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Users, Network, FolderOpen, Server } from 'lucide-react'
import { api } from '@/lib/api'
import type { DashboardData } from '@/lib/types'
import {
  GlassCard,
  SectionHeader,
  Badge,
  Button,
  DataTable,
} from '@/components/ui'
import type { Column } from '@/components/ui'

// ─── Props ────────────────────────────────────────────────────────────────────

interface DashboardPageProps {
  onViewChange: (view: string) => void
}

// ─── Role dot color map ───────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  d3Net:   '#7C3AED',
  sACN:    '#06B6D4',
  Media:   '#10B981',
  NDI:     '#3B82F6',
  Control: '#F59E0B',
  '100G':  '#EC4899',
}

function getRoleColor(role: string): string {
  return ROLE_COLORS[role] ?? '#64748B'
}

// ─── Status badge helper ──────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

function statusVariant(status: string): BadgeVariant {
  const s = status.toLowerCase()
  if (s === 'online' || s === 'up' || s === 'active') return 'success'
  if (s === 'warning' || s === 'degraded') return 'warning'
  if (s === 'offline' || s === 'down' || s === 'error') return 'error'
  if (s === 'scanning') return 'info'
  return 'neutral'
}

// ─── Adapter table columns ────────────────────────────────────────────────────

// AdapterSummaryRow lacks an index signature, so we type columns against the
// looser Record<string, unknown> and cast the data array at the call site.
const adapterColumns: Column<Record<string, unknown>>[] = [
  {
    key: 'role',
    header: 'Role',
    width: '120px',
    render: (value) => {
      const role = String(value)
      const color = getRoleColor(role)
      return (
        <span className="inline-flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className="text-text font-medium">{role}</span>
        </span>
      )
    },
  },
  {
    key: 'displayName',
    header: 'Display Name',
  },
  {
    key: 'ip',
    header: 'IP Address',
    render: (value) => (
      <span className="font-mono text-textSecondary">{String(value)}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: '130px',
    render: (value) => {
      const status = String(value)
      return (
        <Badge variant={statusVariant(status)} pulse={statusVariant(status) === 'success'}>
          {status}
        </Badge>
      )
    },
  },
]

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-surface/50 animate-pulse rounded-lg ${className}`}
      aria-hidden="true"
    />
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading dashboard…" aria-busy="true">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass-card p-5 flex flex-col gap-3">
            <SkeletonBlock className="w-8 h-8" />
            <SkeletonBlock className="w-16 h-7" />
            <SkeletonBlock className="w-24 h-3.5" />
          </div>
        ))}
      </div>
      {/* Table */}
      <div className="glass-card p-5 flex flex-col gap-3">
        <SkeletonBlock className="w-40 h-5 mb-2" />
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="w-full h-10" />
        ))}
      </div>
      {/* Actions */}
      <div className="flex gap-3">
        <SkeletonBlock className="w-32 h-9" />
        <SkeletonBlock className="w-32 h-9" />
        <SkeletonBlock className="w-36 h-9" />
      </div>
    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode
  value: string
  label: string
  accent: string
  index: number
}

function StatCard({ icon, value, label, accent, index }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut', delay: index * 0.1 }}
    >
      <GlassCard accent={accent} className="h-full">
        <div className="flex flex-col gap-3">
          {/* Icon */}
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${accent}22` }}
            aria-hidden="true"
          >
            <span style={{ color: accent }}>{icon}</span>
          </div>

          {/* Value */}
          <p
            className="text-2xl font-bold text-text leading-none tracking-tight truncate"
            title={value}
          >
            {value}
          </p>

          {/* Label */}
          <p className="text-xs text-textMuted font-medium uppercase tracking-wider">
            {label}
          </p>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ─── Stat card data ───────────────────────────────────────────────────────────

interface StatCardDef {
  icon: React.ReactNode
  getValue: (d: DashboardData) => string
  label: string
  accent: string
}

const STAT_CARDS: StatCardDef[] = [
  {
    icon: <Users size={18} />,
    getValue: (d) => d.activeProfile,
    label: 'Active Profile',
    accent: '#7C3AED',
  },
  {
    icon: <Network size={18} />,
    getValue: (d) => d.adapterCount,
    label: 'Network Adapters',
    accent: '#10B981',
  },
  {
    icon: <FolderOpen size={18} />,
    getValue: (d) => d.shareCount,
    label: 'File Shares',
    accent: '#06B6D4',
  },
  {
    icon: <Server size={18} />,
    getValue: (d) => d.hostname,
    label: 'Hostname',
    accent: '#3B82F6',
  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage({ onViewChange }: DashboardPageProps) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getDashboard().then(setData).finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="Dashboard"
        subtitle="System overview at a glance"
      />

      {loading || data === null ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* ── Stat cards ── */}
          <div className="grid grid-cols-4 gap-4">
            {STAT_CARDS.map((card, i) => (
              <StatCard
                key={card.label}
                icon={card.icon}
                value={card.getValue(data)}
                label={card.label}
                accent={card.accent}
                index={i}
              />
            ))}
          </div>

          {/* ── Adapter summary table ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut', delay: 0.45 }}
          >
            <GlassCard title="Network Adapters">
              <DataTable
                columns={adapterColumns}
                data={data.adapterSummary as unknown as Record<string, unknown>[]}
              />
            </GlassCard>
          </motion.div>

          {/* ── Quick actions ── */}
          <motion.div
            className="flex gap-3"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut', delay: 0.55 }}
          >
            <Button
              variant="primary"
              onClick={() => onViewChange('profiles')}
            >
              Apply Profile
            </Button>
            <Button
              variant="outline"
              onClick={() => onViewChange('network')}
            >
              Scan Network
            </Button>
            <Button
              variant="ghost"
              onClick={() => onViewChange('profiles')}
            >
              Manage Profiles
            </Button>
          </motion.div>
        </>
      )}
    </div>
  )
}
