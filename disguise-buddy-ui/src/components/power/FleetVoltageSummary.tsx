import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Zap, MonitorPlay, AlertTriangle, CheckCircle, Server } from 'lucide-react'

interface ServerData {
  hostname: string
  mgmtIp: string
  status: string
  voltages: { label: string; value: number; nominal: number }[]
  vfcs: { slot: number; type: string; status: string }[]
  [key: string]: any  // allow extra fields from expanded snapshot
}

interface FleetVoltageSummaryProps {
  servers: ServerData[]
  loading: boolean
}

const KNOWN_NOMINALS: Record<string, number> = {
  'PAY_12-VOL': 12, 'PAY_5-VOL': 5, 'SB_5-VOL': 5, 'AUX_5-VOL': 5,
  'PAY_3_3-VOL': 3.3, 'SB_3_3-VOL': 3.3, 'AUX_3_3-VOL': 3.3, 'BAT_3_0-VOL': 3.0,
  'SLOT_3_3-VOL': 3.3, 'VDD_3_3_DUAL-VOL': 3.3, 'X710_1_8_AUX-VOL': 1.8,
  'VDD_1_8_DUAL-VOL': 1.8, 'AUX_1_05-VOL': 1.05, 'X710_1_AUX-VOL': 1.0,
  'X710_0_9_AUX-VOL': 0.9,
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-4 flex items-center gap-3"
    >
      <div className="p-2 rounded-lg" style={{ backgroundColor: `${color}20`, border: `1px solid ${color}30` }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div>
        <p className="text-[10px] text-textMuted uppercase tracking-wider font-medium">{label}</p>
        <p className="text-xl font-bold text-text leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-textMuted mt-0.5">{sub}</p>}
      </div>
    </motion.div>
  )
}

export function FleetVoltageSummary({ servers, loading }: FleetVoltageSummaryProps) {
  const stats = useMemo(() => {
    const online = servers.filter(s => s.status !== 'offline')
    const totalRails = online.reduce((sum, s) => sum + s.voltages.length, 0)
    const totalVfcs = online.reduce((sum, s) => sum + s.vfcs.length, 0)
    const activeVfcs = online.reduce((sum, s) => sum + s.vfcs.filter(v => v.status.toLowerCase() === 'active').length, 0)

    // Count rails with >10% deviation
    let warningRails = 0
    for (const s of online) {
      for (const v of s.voltages) {
        const nom = KNOWN_NOMINALS[v.label] ?? v.nominal
        if (nom > 0 && Math.abs((v.value - nom) / nom) > 0.10) warningRails++
      }
    }

    // Find worst deviation
    let worstDev = 0
    let worstLabel = ''
    for (const s of online) {
      for (const v of s.voltages) {
        const nom = KNOWN_NOMINALS[v.label] ?? v.nominal
        if (nom > 0) {
          const dev = Math.abs((v.value - nom) / nom) * 100
          if (dev > worstDev) { worstDev = dev; worstLabel = `${s.hostname} ${v.label}` }
        }
      }
    }

    return { online: online.length, totalRails, totalVfcs, activeVfcs, warningRails, worstDev, worstLabel }
  }, [servers])

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => (
          <div key={i} className="glass-card p-4 h-[76px] animate-pulse bg-surface" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        icon={Server}
        label="Servers Online"
        value={stats.online}
        sub={`${stats.totalRails} voltage rails monitored`}
        color="#7C3AED"
      />
      <StatCard
        icon={Zap}
        label="Voltage Health"
        value={stats.warningRails === 0 ? 'Normal' : `${stats.warningRails} Alerts`}
        sub={stats.worstDev > 0 ? `Worst: ${stats.worstDev.toFixed(1)}% dev` : 'All rails within tolerance'}
        color={stats.warningRails === 0 ? '#10B981' : '#F59E0B'}
      />
      <StatCard
        icon={MonitorPlay}
        label="VFC Cards"
        value={`${stats.activeVfcs}/${stats.totalVfcs}`}
        sub="Active / Total"
        color="#3B82F6"
      />
      <StatCard
        icon={stats.warningRails === 0 ? CheckCircle : AlertTriangle}
        label="Fleet Status"
        value={stats.warningRails === 0 ? 'Healthy' : 'Warning'}
        sub={stats.warningRails === 0 ? 'All systems nominal' : `${stats.warningRails} rails out of tolerance`}
        color={stats.warningRails === 0 ? '#10B981' : '#EF4444'}
      />
    </div>
  )
}
