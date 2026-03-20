import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Power,
  PowerOff,
  RotateCcw,
  Locate,
  MonitorPlay,
  Zap,
  Thermometer,
  Fan,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'

interface VfcSlot {
  slot: number
  type: string
  status: string
}

interface ServerData {
  hostname: string
  mgmtIp: string
  status: string
  role: string
  serial: string
  type: string
  powerStatus: string
  temperatures: { label: string; value: number }[]
  fans: { label: string; rpm: number }[]
  vfcs: VfcSlot[]
  ledColor: { r: number; g: number; b: number }
  ledMode: string
  smcFirmware: string
  smcPlatform: string
}

interface DashboardServerCardProps {
  server: ServerData
  color: string
}

function statusBadge(status: string) {
  switch (status) {
    case 'online': return { bg: 'bg-success/15 border-success/30', text: 'text-success', dot: 'bg-success' }
    case 'warning': return { bg: 'bg-warning/15 border-warning/30', text: 'text-warning', dot: 'bg-warning' }
    case 'error': return { bg: 'bg-error/15 border-error/30', text: 'text-error', dot: 'bg-error' }
    default: return { bg: 'bg-surface border-border', text: 'text-textMuted', dot: 'bg-textMuted' }
  }
}

export function DashboardServerCard({ server, color }: DashboardServerCardProps) {
  const [acting, setActing] = useState(false)
  const sb = statusBadge(server.status)

  const cpuTemp = server.temperatures.find(t => t.label === 'CPU-TMP')?.value
  const sysTemp = server.temperatures.find(t => t.label === 'SYS-TMP')?.value
  const cpuFan = server.fans.find(f => f.label === 'CPU_FAN0-SPEED')?.rpm
  const activeVfcs = server.vfcs.filter(v => v.status.toLowerCase() === 'active').length
  const ledCss = `rgb(${server.ledColor.r},${server.ledColor.g},${server.ledColor.b})`

  const handlePower = async (action: 'on' | 'off' | 'cycle') => {
    const labels = { on: 'Power On', off: 'Power Off', cycle: 'Power Cycle' }
    if (!confirm(`${labels[action]} ${server.hostname} (${server.mgmtIp})?`)) return
    setActing(true)
    try {
      await api.powerAction(server.mgmtIp, action)
      toast.success(`${labels[action]}: ${server.hostname}`)
    } catch (err: any) {
      toast.error(err?.message ?? `${labels[action]} failed`)
    } finally {
      setActing(false)
    }
  }

  const handleIdentify = async () => {
    setActing(true)
    try {
      await api.identifyServer(server.mgmtIp)
      toast.success(`Identifying ${server.hostname}`)
    } catch (err: any) {
      toast.error(err?.message ?? 'Identify failed')
    } finally {
      setActing(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="glass-card relative overflow-hidden"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      {/* Header row */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-3 border-b border-border">
        {/* LED color indicator */}
        <div
          className="w-3 h-3 rounded-full shrink-0 border border-white/20"
          style={{ backgroundColor: ledCss }}
          title={`LED: ${ledCss} (${server.ledMode})`}
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-text truncate">{server.hostname}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-textMuted font-mono">{server.mgmtIp}</span>
            <span className="text-[10px] text-textMuted">·</span>
            <span className="text-[10px] text-textMuted">{server.role}</span>
          </div>
        </div>
        {/* Status badge */}
        <span className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full border ${sb.bg} ${sb.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${sb.dot} animate-pulse`} />
          {server.status}
        </span>
      </div>

      {/* Stats grid */}
      <div className="px-4 py-2.5 grid grid-cols-4 gap-2">
        {/* CPU Temp */}
        <div className="text-center">
          <Thermometer size={12} className="mx-auto text-textMuted mb-0.5" />
          <div className="text-[13px] font-bold font-mono text-text">{cpuTemp ?? '—'}°</div>
          <div className="text-[9px] text-textMuted">CPU</div>
        </div>
        {/* SYS Temp */}
        <div className="text-center">
          <Thermometer size={12} className="mx-auto text-textMuted mb-0.5" />
          <div className="text-[13px] font-bold font-mono text-text">{sysTemp ?? '—'}°</div>
          <div className="text-[9px] text-textMuted">SYS</div>
        </div>
        {/* CPU Fan */}
        <div className="text-center">
          <Fan size={12} className="mx-auto text-textMuted mb-0.5" />
          <div className="text-[13px] font-bold font-mono text-text">{cpuFan ?? '—'}</div>
          <div className="text-[9px] text-textMuted">RPM</div>
        </div>
        {/* VFCs */}
        <div className="text-center">
          <MonitorPlay size={12} className="mx-auto text-textMuted mb-0.5" />
          <div className="text-[13px] font-bold font-mono text-text">{activeVfcs}/{server.vfcs.length}</div>
          <div className="text-[9px] text-textMuted">VFC</div>
        </div>
      </div>

      {/* VFC slot pills */}
      {server.vfcs.length > 0 && (
        <div className="px-4 pb-2 flex items-center gap-1.5">
          {server.vfcs.map(vfc => {
            const active = vfc.status.toLowerCase() === 'active'
            return (
              <span
                key={vfc.slot}
                className={`px-2 py-0.5 text-[9px] font-bold rounded-full border ${
                  active
                    ? 'bg-success/10 text-success border-success/30'
                    : 'bg-surface text-textMuted border-border'
                }`}
              >
                S{vfc.slot} {vfc.type}
              </span>
            )
          })}
        </div>
      )}

      {/* Info row */}
      <div className="px-4 py-1.5 border-t border-border flex items-center gap-3 text-[9px] text-textMuted">
        <span>{server.type}</span>
        <span>·</span>
        <span>SN: {server.serial}</span>
        {server.smcFirmware && (
          <>
            <span>·</span>
            <span>SMC {server.smcFirmware}</span>
          </>
        )}
        {server.smcPlatform && (
          <>
            <span>·</span>
            <span>{server.smcPlatform}</span>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 py-2 border-t border-border flex items-center gap-1.5">
        <button
          onClick={handleIdentify}
          disabled={acting}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-textMuted hover:text-accent bg-surface hover:bg-hover rounded border border-border transition-colors"
          title="Blink OLED to identify this server"
        >
          <Locate size={11} />
          Identify
        </button>
        <button
          onClick={() => handlePower('on')}
          disabled={acting}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-textMuted hover:text-success bg-surface hover:bg-hover rounded border border-border transition-colors"
          title="Power On"
        >
          <Power size={11} />
          On
        </button>
        <button
          onClick={() => handlePower('off')}
          disabled={acting}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-textMuted hover:text-error bg-surface hover:bg-hover rounded border border-border transition-colors"
          title="Power Off (IPMI — not graceful)"
        >
          <PowerOff size={11} />
          Off
        </button>
        <button
          onClick={() => handlePower('cycle')}
          disabled={acting}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-textMuted hover:text-warning bg-surface hover:bg-hover rounded border border-border transition-colors"
          title="Power Cycle (IPMI — not graceful)"
        >
          <RotateCcw size={11} />
          Cycle
        </button>
        <span className="ml-auto flex items-center gap-1">
          <Zap size={10} className="text-success" />
          <span className="text-[10px] text-textMuted">{server.powerStatus}</span>
        </span>
      </div>
    </motion.div>
  )
}
