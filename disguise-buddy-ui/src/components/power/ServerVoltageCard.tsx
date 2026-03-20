import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Zap, AlertTriangle, CheckCircle } from 'lucide-react'
import { VoltageGauge } from './VoltageGauge'

interface VoltageReading {
  label: string
  value: number
  nominal: number
}

interface ServerVoltageCardProps {
  hostname: string
  mgmtIp: string
  voltages: VoltageReading[]
  color: string
  status: string
}

// Known nominals for deviation calculation
const KNOWN_NOMINALS: Record<string, number> = {
  'PAY_12-VOL': 12, 'PAY_5-VOL': 5, 'SB_5-VOL': 5, 'AUX_5-VOL': 5,
  'PAY_3_3-VOL': 3.3, 'SB_3_3-VOL': 3.3, 'AUX_3_3-VOL': 3.3, 'BAT_3_0-VOL': 3.0,
  'SLOT_3_3-VOL': 3.3, 'VDD_3_3_DUAL-VOL': 3.3, 'X710_1_8_AUX-VOL': 1.8,
  'VDD_1_8_DUAL-VOL': 1.8, 'AUX_1_05-VOL': 1.05, 'X710_1_AUX-VOL': 1.0,
  'X710_0_9_AUX-VOL': 0.9,
}

// Group voltages by voltage tier for visual organization
function groupByTier(voltages: VoltageReading[]): { tier: string; rails: VoltageReading[] }[] {
  const tiers: { tier: string; min: number; max: number }[] = [
    { tier: '12V Rails', min: 10, max: 15 },
    { tier: '5V Rails', min: 4, max: 6 },
    { tier: '3.3V Rails', min: 2.5, max: 4 },
    { tier: '1.8V Rails', min: 1.5, max: 2 },
    { tier: '1V Rails', min: 0.5, max: 1.49 },
  ]

  const result: { tier: string; rails: VoltageReading[] }[] = []
  const used = new Set<number>()

  for (const t of tiers) {
    const rails = voltages.filter((v, i) => {
      const nom = KNOWN_NOMINALS[v.label] ?? v.nominal ?? v.value
      if (nom >= t.min && nom <= t.max && !used.has(i)) {
        used.add(i)
        return true
      }
      return false
    })
    if (rails.length > 0) result.push({ tier: t.tier, rails })
  }

  // Catch any ungrouped
  const remaining = voltages.filter((_, i) => !used.has(i))
  if (remaining.length > 0) result.push({ tier: 'Other', rails: remaining })

  return result
}

export function ServerVoltageCard({ hostname, mgmtIp, voltages, color }: ServerVoltageCardProps) {
  const groups = useMemo(() => groupByTier(voltages), [voltages])

  // Overall health: count rails with >10% deviation
  const warnings = useMemo(() => {
    return voltages.filter(v => {
      const nom = KNOWN_NOMINALS[v.label] ?? v.nominal
      if (!nom || nom <= 0) return false
      return Math.abs((v.value - nom) / nom) > 0.10
    }).length
  }, [voltages])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="glass-card relative overflow-hidden"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-border flex items-center gap-3">
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}20` }}>
          <Zap size={16} style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text truncate">{hostname}</h3>
          <p className="text-[10px] text-textMuted font-mono">{mgmtIp}</p>
        </div>
        {/* Status badge */}
        <div className="flex items-center gap-1.5">
          {warnings > 0 ? (
            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-warning/20 text-warning border border-warning/30">
              <AlertTriangle size={10} />
              {warnings} warn
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-success/20 text-success border border-success/30">
              <CheckCircle size={10} />
              Normal
            </span>
          )}
        </div>
      </div>

      {/* Voltage groups */}
      <div className="px-4 py-3 space-y-3">
        {groups.map(({ tier, rails }) => (
          <div key={tier}>
            <h4 className="text-[10px] font-semibold text-textMuted uppercase tracking-wider mb-1">{tier}</h4>
            {rails.map(rail => (
              <VoltageGauge
                key={rail.label}
                label={rail.label}
                value={rail.value}
                nominal={rail.nominal}
              />
            ))}
          </div>
        ))}
        {voltages.length === 0 && (
          <p className="text-[11px] text-textMuted text-center py-4">No voltage data available</p>
        )}
      </div>
    </motion.div>
  )
}
