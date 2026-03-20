import { motion } from 'framer-motion'
import { MonitorPlay } from 'lucide-react'

interface VfcSlot {
  slot: number
  type: string
  status: string
}

interface VfcCardProps {
  hostname: string
  mgmtIp: string
  vfcs: VfcSlot[]
  color: string
  role?: string
  ledColor?: { r: number; g: number; b: number }
}

function statusColor(status: string): { dot: string; text: string; bg: string } {
  const s = status.toLowerCase()
  if (s === 'active') return { dot: 'bg-success', text: 'text-success', bg: 'bg-success/10 border-success/30' }
  if (s === 'inactive' || s === 'disabled') return { dot: 'bg-textMuted', text: 'text-textMuted', bg: 'bg-surface border-border' }
  if (s === 'error' || s === 'fault') return { dot: 'bg-error', text: 'text-error', bg: 'bg-error/10 border-error/30' }
  return { dot: 'bg-warning', text: 'text-warning', bg: 'bg-warning/10 border-warning/30' }
}

export function VfcCard({ hostname, mgmtIp, vfcs, color, role, ledColor }: VfcCardProps) {
  const allActive = vfcs.length > 0 && vfcs.every(v => v.status.toLowerCase() === 'active')
  const hasError = vfcs.some(v => ['error', 'fault'].includes(v.status.toLowerCase()))

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
          <MonitorPlay size={16} style={{ color }} />
        </div>
        {ledColor && (
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
            style={{ backgroundColor: `rgb(${ledColor.r},${ledColor.g},${ledColor.b})` }}
            title="LED strip color"
          />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text truncate">{hostname}</h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-textMuted font-mono">{mgmtIp}</span>
            {role && <span className="text-[10px] text-textMuted">· {role}</span>}
          </div>
        </div>
        {/* Summary badge */}
        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
          hasError ? 'bg-error/20 text-error border-error/30' :
          allActive ? 'bg-success/20 text-success border-success/30' :
          'bg-warning/20 text-warning border-warning/30'
        }`}>
          {vfcs.filter(v => v.status.toLowerCase() === 'active').length}/{vfcs.length} Active
        </span>
      </div>

      {/* VFC Slots */}
      <div className="px-4 py-3">
        <div className="grid grid-cols-3 gap-2">
          {vfcs.map(vfc => {
            const sc = statusColor(vfc.status)
            return (
              <div
                key={vfc.slot}
                className={`rounded-lg border p-3 text-center transition-colors ${sc.bg}`}
              >
                {/* Slot number */}
                <div className="text-[10px] text-textMuted font-medium mb-1">
                  Slot {vfc.slot}
                </div>
                {/* VFC type */}
                <div className="text-lg font-bold text-text leading-tight">
                  {vfc.type}
                </div>
                {/* Status with dot */}
                <div className={`flex items-center justify-center gap-1.5 mt-1.5 ${sc.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} ${vfc.status.toLowerCase() === 'active' ? 'animate-pulse' : ''}`} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">{vfc.status}</span>
                </div>
              </div>
            )
          })}
        </div>
        {vfcs.length === 0 && (
          <p className="text-[11px] text-textMuted text-center py-4">No VFC cards detected</p>
        )}
      </div>
    </motion.div>
  )
}
