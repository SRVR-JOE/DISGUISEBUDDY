import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Server,
  Cpu,
  Thermometer,
  AlertTriangle,
  RefreshCw,
  Activity,
  Zap,
  Fan,
  Network,
  ChevronRight,
  Monitor,
  Power,
  CircleDot,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { GlassCard, SectionHeader, Badge, Button, StatusDot, Toggle } from '@/components/ui'
import { sortServers } from '@/lib/server-sort'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardServer {
  ip: string
  hostname: string
  role: string
  adapters: { name: string; ipAddress: string; macAddress: string; netmask: string }[]
  power: Record<string, string>
  chassis: Record<string, string>
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

function parseTemp(val: string | undefined): number {
  if (!val) return 0
  const match = val.match(/(\d+)/)
  if (!match) return 0
  const c = parseInt(match[1], 10)
  return Math.round(c * 9 / 5 + 32) // Convert C to F
}

function parseVoltage(val: string | undefined): number {
  if (!val) return 0
  const match = val.match(/([\d.]+)/)
  return match ? parseFloat(match[1]) : 0
}

function parseRPM(val: string | undefined): number {
  if (!val) return 0
  const match = val.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function tempColor(value: number): string {
  if (value < 140) return '#22c55e'
  if (value < 167) return '#f59e0b'
  return '#ef4444'
}

function voltageColor(actual: number, nominal: number): string {
  if (actual === 0) return '#6b7280'
  const pctDiff = Math.abs(actual - nominal) / nominal * 100
  if (pctDiff < 5) return '#22c55e'
  if (pctDiff < 10) return '#f59e0b'
  return '#ef4444'
}

function fanColor(rpm: number): string {
  if (rpm === 0) return '#6b7280'
  if (rpm > 1000) return '#22c55e'
  if (rpm > 500) return '#f59e0b'
  return '#ef4444'
}

function roleColor(role: string): string {
  const r = role.toLowerCase()
  if (r === 'director') return '#22c55e'
  if (r === 'actor') return '#06b6d4'
  if (r === 'understudy') return '#f59e0b'
  return '#7c3aed'
}

function roleVariant(role: string): 'success' | 'info' | 'warning' | 'neutral' {
  const r = role.toLowerCase()
  if (r === 'director') return 'success'
  if (r === 'actor') return 'info'
  if (r === 'understudy') return 'warning'
  return 'neutral'
}

// ─── Anomaly detection ────────────────────────────────────────────────────────

function countAnomalies(servers: DashboardServer[]): number {
  let count = 0
  for (const s of servers) {
    if (parseTemp(s.chassis['CPU-TMP']) > 167) count++
    if (parseTemp(s.chassis['SYS-TMP']) > 122) count++
    const v12 = parseVoltage(s.chassis['PAY_12-VOL'])
    if (v12 > 0 && Math.abs(v12 - 12) / 12 > 0.1) count++
    const v5 = parseVoltage(s.chassis['PAY_5-VOL'])
    if (v5 > 0 && Math.abs(v5 - 5) / 5 > 0.1) count++
    const v3 = parseVoltage(s.chassis['PAY_3_3-VOL'])
    if (v3 > 0 && Math.abs(v3 - 3.3) / 3.3 > 0.1) count++
    const fans = Object.entries(s.chassis).filter(([k]) => k.includes('FAN') && k.includes('SPEED'))
    for (const [, v] of fans) {
      const rpm = parseRPM(v)
      if (rpm > 0 && rpm < 500) count++
    }
    if (s.power['Main Power Fault'] === 'true') count++
    if (s.power['Power Overload'] === 'true') count++
  }
  return count
}

// ─── TempGauge (inline SVG) ──────────────────────────────────────────────────

function TempGauge({ value, max = 212, label, size = 80 }: { value: number; max?: number; label: string; size?: number }) {
  const pct = Math.min(100, (value / max) * 100)
  const color = tempColor(value)
  const strokeWidth = size * 0.1
  const radius = (size - strokeWidth) / 2 - 2
  const circumference = 2 * Math.PI * radius
  const arcLength = circumference * 0.75
  const offset = arcLength * (1 - pct / 100)
  const center = size / 2

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#1e1e2e"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          strokeLinecap="round"
          style={{ rotate: '135deg', transformOrigin: `${center}px ${center}px` }}
        />
        {/* Value arc */}
        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          strokeLinecap="round"
          initial={{ strokeDashoffset: arcLength }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          style={{
            rotate: '135deg',
            transformOrigin: `${center}px ${center}px`,
            filter: `drop-shadow(0 0 6px ${color}80)`,
          }}
        />
        {/* Glow */}
        <circle
          cx={center}
          cy={center}
          r={radius * 0.55}
          fill="none"
          stroke={color}
          strokeWidth={1}
          opacity={0.15}
        />
        {/* Center text */}
        <text
          x={center}
          y={center - 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={color}
          fontSize={size * 0.22}
          fontWeight="700"
          fontFamily="'JetBrains Mono', monospace"
        >
          {value}°F
        </text>
        <text
          x={center}
          y={center + size * 0.16}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#94a3b8"
          fontSize={size * 0.12}
          fontFamily="Inter, system-ui, sans-serif"
        >
          {label}
        </text>
      </svg>
    </div>
  )
}

// ─── VoltageBar ──────────────────────────────────────────────────────────────

function VoltageBar({ actual, nominal, label }: { actual: number; nominal: number; label: string }) {
  const pctDiff = nominal > 0 ? Math.abs(actual - nominal) / nominal * 100 : 0
  const color = voltageColor(actual, nominal)
  const fillPct = nominal > 0 ? Math.min(100, (actual / (nominal * 1.15)) * 100) : 0
  const nominalPct = nominal > 0 ? (nominal / (nominal * 1.15)) * 100 : 0

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-textMuted">{label}</span>
        <span className="text-xs font-mono" style={{ color }}>
          {actual > 0 ? `${actual.toFixed(2)}V` : 'N/A'}
          {actual > 0 && (
            <span className="text-textMuted ml-1">
              ({pctDiff < 1 ? '<1' : pctDiff.toFixed(1)}%)
            </span>
          )}
        </span>
      </div>
      <div className="relative h-2 bg-[#1e1e2e] rounded-full overflow-hidden">
        {/* Nominal marker */}
        <div
          className="absolute top-0 h-full w-px bg-white/30 z-10"
          style={{ left: `${nominalPct}%` }}
        />
        {/* Actual bar */}
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${fillPct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

// ─── FanIndicator ────────────────────────────────────────────────────────────

function FanIndicator({ rpm, label }: { rpm: number; label: string }) {
  const color = fanColor(rpm)
  return (
    <div className="flex items-center gap-2">
      <motion.div
        animate={{ rotate: rpm > 0 ? 360 : 0 }}
        transition={{ duration: rpm > 3000 ? 0.5 : rpm > 1000 ? 1 : 2, repeat: Infinity, ease: 'linear' }}
      >
        <Fan size={14} style={{ color }} />
      </motion.div>
      <div className="flex flex-col">
        <span className="text-xs text-textMuted">{label}</span>
        <span className="text-xs font-mono" style={{ color }}>
          {rpm > 0 ? `${rpm} RPM` : 'OFF'}
        </span>
      </div>
    </div>
  )
}

// ─── StatCard ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  glowColor,
  pulse = false,
}: {
  icon: React.ComponentType<any>
  label: string
  value: number | string
  glowColor: string
  pulse?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="glass-card relative overflow-hidden"
      style={{ boxShadow: `0 0 30px ${glowColor}25, inset 0 1px 0 rgba(255,255,255,0.05)` }}
    >
      <div className="flex items-center gap-4 p-4">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${glowColor}20` }}
        >
          <Icon size={20} color={glowColor} />
        </div>
        <div className="flex flex-col">
          <motion.span
            key={String(value)}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-2xl font-bold font-mono text-text ${pulse ? 'animate-pulse' : ''}`}
          >
            {value}
          </motion.span>
          <span className="text-xs text-textMuted uppercase tracking-wider">{label}</span>
        </div>
      </div>
      {/* Subtle top glow line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${glowColor}60, transparent)` }}
      />
    </motion.div>
  )
}

// ─── RackUnit ────────────────────────────────────────────────────────────────

function RackUnit({
  server,
  isExpanded,
  onToggle,
  index,
}: {
  server: DashboardServer
  isExpanded: boolean
  onToggle: () => void
  index: number
}) {
  const cpuTemp = parseTemp(server.chassis['CPU-TMP'])
  const sysTemp = parseTemp(server.chassis['SYS-TMP'])
  const powerOn = server.power['System Power'] === 'on'
  const hasFault = server.power['Main Power Fault'] === 'true' || server.power['Power Overload'] === 'true'

  const fans = Object.entries(server.chassis)
    .filter(([k]) => k.includes('FAN') && k.includes('SPEED'))
    .map(([k, v]) => ({ name: k.replace(/-SPEED/, ''), rpm: parseRPM(v) }))

  const v12 = parseVoltage(server.chassis['PAY_12-VOL'])
  const v5 = parseVoltage(server.chassis['PAY_5-VOL'])
  const sb5 = parseVoltage(server.chassis['SB_5-VOL'])
  const aux5 = parseVoltage(server.chassis['AUX_5-VOL'])
  const v3 = parseVoltage(server.chassis['PAY_3_3-VOL'])

  const borderColor = roleColor(server.role)

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      {/* Rack unit header */}
      <button
        type="button"
        onClick={onToggle}
        className={`w-full text-left border-l-4 rounded-lg transition-all duration-200 hover:bg-surface/60 ${
          isExpanded ? 'bg-surface/40' : 'bg-surface/20'
        }`}
        style={{ borderLeftColor: borderColor }}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Power LED */}
          <StatusDot status={powerOn ? (hasFault ? 'warning' : 'online') : 'offline'} />

          {/* Hostname & IP */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-text truncate">
                {server.hostname || server.ip}
              </span>
              <Badge variant={roleVariant(server.role)}>
                {server.role || 'Unknown'}
              </Badge>
            </div>
            <span className="text-xs font-mono text-textMuted">{server.ip}</span>
          </div>

          {/* CPU temp mini bar */}
          <div className="flex items-center gap-2 shrink-0">
            <Thermometer size={12} style={{ color: tempColor(cpuTemp) }} />
            <div className="w-20 h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: tempColor(cpuTemp) }}
                animate={{ width: `${Math.min(100, (cpuTemp / 212) * 100)}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <span className="text-xs font-mono w-10 text-right" style={{ color: tempColor(cpuTemp) }}>
              {cpuTemp}°F
            </span>
          </div>

          {/* Mini fan indicators */}
          <div className="flex items-center gap-1 shrink-0">
            {fans.slice(0, 4).map((f, i) => (
              <motion.div
                key={i}
                animate={{ rotate: f.rpm > 0 ? 360 : 0 }}
                transition={{ duration: f.rpm > 3000 ? 0.5 : 1.5, repeat: Infinity, ease: 'linear' }}
              >
                <Fan size={10} style={{ color: fanColor(f.rpm) }} />
              </motion.div>
            ))}
          </div>

          {/* Expand arrow */}
          <motion.div
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronRight size={16} className="text-textMuted" />
          </motion.div>
        </div>
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div
              className="mx-4 mb-4 p-5 rounded-lg border border-border/50 bg-[#0d0d1a]/60"
              style={{ borderLeftColor: borderColor, borderLeftWidth: '2px' }}
            >
              {/* Temperature gauges */}
              <div className="flex flex-wrap gap-8 mb-6">
                <div>
                  <h4 className="text-xs font-semibold text-textSecondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Thermometer size={12} /> Temperatures
                  </h4>
                  <div className="flex items-center gap-6">
                    <TempGauge value={cpuTemp} label="CPU" size={90} />
                    <TempGauge value={sysTemp} label="SYS" size={90} />
                  </div>
                </div>

                {/* Voltage rails */}
                <div className="flex-1 min-w-60">
                  <h4 className="text-xs font-semibold text-textSecondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Zap size={12} /> Voltage Rails
                  </h4>
                  <div className="flex flex-col gap-2.5">
                    <VoltageBar actual={v12} nominal={12} label="12V Main" />
                    <VoltageBar actual={v5} nominal={5} label="5V Payload" />
                    <VoltageBar actual={sb5} nominal={5} label="5V Standby" />
                    <VoltageBar actual={aux5} nominal={5} label="5V Aux" />
                    <VoltageBar actual={v3} nominal={3.3} label="3.3V" />
                  </div>
                </div>
              </div>

              {/* Fan speeds */}
              <div className="mb-6">
                <h4 className="text-xs font-semibold text-textSecondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Fan size={12} /> Fan Speeds
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {fans.map((f, i) => (
                    <FanIndicator key={i} rpm={f.rpm} label={f.name} />
                  ))}
                </div>
              </div>

              {/* Power status */}
              <div className="mb-6">
                <h4 className="text-xs font-semibold text-textSecondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Power size={12} /> Power Status
                </h4>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(server.power).map(([key, val]) => {
                    const isOk = key === 'System Power' ? val === 'on' : val === 'false'
                    return (
                      <div key={key} className="flex items-center gap-1.5">
                        <StatusDot status={isOk ? 'online' : 'warning'} />
                        <span className="text-xs text-textSecondary">{key}</span>
                        <span className={`text-xs font-mono ${isOk ? 'text-success' : 'text-error'}`}>
                          {val}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Network adapters */}
              {server.adapters && server.adapters.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-textSecondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Network size={12} /> Network Adapters
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-border/40">
                          {['Name', 'IP Address', 'MAC Address', 'Netmask'].map(h => (
                            <th key={h} className="px-3 py-1.5 text-xs font-semibold text-textMuted uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {server.adapters.map((a, i) => (
                          <tr key={i} className="border-b border-border/20 last:border-0">
                            <td className="px-3 py-1.5 text-xs text-textSecondary">{a.name}</td>
                            <td className="px-3 py-1.5 text-xs font-mono text-text">{a.ipAddress}</td>
                            <td className="px-3 py-1.5 text-xs font-mono text-textMuted">{a.macAddress}</td>
                            <td className="px-3 py-1.5 text-xs font-mono text-textMuted">{a.netmask}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── HealthMatrixCell ────────────────────────────────────────────────────────

function MatrixCell({ color, value, tooltip }: { color: string; value: string; tooltip?: string }) {
  return (
    <td className="px-2 py-1.5 text-center border border-border/20" title={tooltip}>
      <span
        className="inline-block w-3 h-3 rounded-full mr-1.5 align-middle"
        style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}50` }}
      />
      <span className="text-xs font-mono text-textSecondary align-middle">{value}</span>
    </td>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function DashboardPage() {
  const [servers, setServers] = useState<DashboardServer[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [expandedIp, setExpandedIp] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const esRef = useRef<EventSource | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Auto-scan on mount ─────────────────────────────────────────────────────

  const startScan = useCallback(() => {
    if (scanning) return
    esRef.current?.close()

    setScanning(true)
    setScanProgress(0)
    setServers([])
    setExpandedIp(null)

    const es = api.smcDiscover('192.168.100', 200, 254)
    esRef.current = es

    es.addEventListener('discovered', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const server: DashboardServer = {
          ip: data.ip ?? '',
          hostname: data.hostname ?? '',
          role: data.role ?? '',
          adapters: data.adapters ?? [],
          power: data.power ?? {},
          chassis: data.chassis ?? {},
        }
        setServers(prev => {
          if (prev.some(s => s.ip === server.ip)) return prev
          return sortServers([...prev, server] as any) as any
        })
      } catch { /* skip malformed */ }
    })

    es.addEventListener('progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        if (typeof data.percent === 'number') setScanProgress(data.percent)
      } catch { /* skip */ }
    })

    es.addEventListener('complete', () => {
      es.close()
      esRef.current = null
      setScanning(false)
      setScanProgress(100)
      toast.success('Scan complete')
    })

    es.addEventListener('error', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        toast.error(data.message || 'Scan error')
      } catch { /* skip */ }
    })

    es.onerror = () => {
      es.close()
      esRef.current = null
      setScanning(false)
      toast.error('Scan connection lost')
    }
  }, [scanning])

  useEffect(() => {
    startScan()
    return () => {
      esRef.current?.close()
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Refresh all servers ────────────────────────────────────────────────────

  const refreshAll = useCallback(async () => {
    if (servers.length === 0 || refreshing) return
    setRefreshing(true)
    try {
      const updated = await Promise.all(
        servers.map(s =>
          api.smcProbe(s.ip)
            .then((data: any) => ({
              ip: data.ip ?? s.ip,
              hostname: data.hostname ?? s.hostname,
              role: data.role ?? s.role,
              adapters: data.adapters ?? s.adapters,
              power: data.power ?? s.power,
              chassis: data.chassis ?? s.chassis,
            } as DashboardServer))
            .catch(() => s)
        )
      )
      setServers(sortServers(updated as any) as any)
      toast.success('Refreshed all servers')
    } finally {
      setRefreshing(false)
    }
  }, [servers, refreshing])

  // ── Auto-refresh toggle ────────────────────────────────────────────────────

  useEffect(() => {
    if (autoRefresh && servers.length > 0) {
      refreshTimerRef.current = setInterval(() => {
        refreshAll()
      }, 30000)
    } else {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
  }, [autoRefresh, refreshAll, servers.length])

  // ── Derived stats ──────────────────────────────────────────────────────────

  const totalServers = servers.length
  const onlineServers = servers.filter(s => s.power['System Power'] === 'on').length
  const alerts = useMemo(() => countAnomalies(servers), [servers])
  const avgCpuTemp = useMemo(() => {
    if (servers.length === 0) return 0
    const sum = servers.reduce((acc, s) => acc + parseTemp(s.chassis['CPU-TMP']), 0)
    return Math.round(sum / servers.length)
  }, [servers])

  const avgTempGlowColor = avgCpuTemp < 140 ? '#22c55e' : avgCpuTemp < 167 ? '#f59e0b' : '#ef4444'

  // ── Health matrix data ─────────────────────────────────────────────────────

  const voltageRows = useMemo(() => [
    { label: 'CPU Temp', key: 'CPU-TMP', type: 'temp' as const },
    { label: 'SYS Temp', key: 'SYS-TMP', type: 'temp' as const },
    { label: '12V Rail', key: 'PAY_12-VOL', type: 'voltage' as const, nominal: 12 },
    { label: '5V Rail', key: 'PAY_5-VOL', type: 'voltage' as const, nominal: 5 },
    { label: '3.3V Rail', key: 'PAY_3_3-VOL', type: 'voltage' as const, nominal: 3.3 },
    { label: 'CPU Fan', key: 'CPU_FAN0-SPEED', type: 'fan' as const },
    { label: 'SYS Fan 1', key: 'SYS_FAN1-SPEED', type: 'fan' as const },
    { label: 'SYS Fan 2', key: 'SYS_FAN2-SPEED', type: 'fan' as const },
    { label: 'SYS Fan 3', key: 'SYS_FAN3-SPEED', type: 'fan' as const },
  ], [])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <SectionHeader
          title="Health Center"
          subtitle="Real-time server health monitoring across the MGMT subnet"
        />
        <div className="flex items-center gap-3">
          <Toggle
            checked={autoRefresh}
            onChange={setAutoRefresh}
            label="Auto-refresh (30s)"
            disabled={servers.length === 0}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={refreshAll}
            disabled={servers.length === 0 || refreshing}
            loading={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={startScan}
            disabled={scanning}
            loading={scanning}
          >
            <Activity size={14} />
            {scanning ? 'Scanning...' : 'Re-scan'}
          </Button>
        </div>
      </div>

      {/* Scan progress */}
      <AnimatePresence>
        {scanning && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-4">
              <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-purple-500 to-cyan-400"
                  animate={{ width: `${scanProgress}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  style={{ boxShadow: '0 0 12px rgba(124, 58, 237, 0.5)' }}
                />
              </div>
              <span className="text-xs font-mono text-textMuted w-12 text-right">{scanProgress}%</span>
              <Badge variant="info" pulse>Scanning</Badge>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Stats bar ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Server}
          label="Total Servers"
          value={totalServers}
          glowColor="#7c3aed"
          pulse={scanning}
        />
        <StatCard
          icon={Monitor}
          label="Servers Online"
          value={onlineServers}
          glowColor="#22c55e"
        />
        <StatCard
          icon={AlertTriangle}
          label="Alerts"
          value={alerts}
          glowColor={alerts > 0 ? '#ef4444' : '#f59e0b'}
        />
        <StatCard
          icon={Cpu}
          label="Avg CPU Temp"
          value={servers.length > 0 ? `${avgCpuTemp}°F` : '--'}
          glowColor={avgTempGlowColor}
        />
      </div>

      {/* ── Rack View ─────────────────────────────────────────────────────────── */}
      {servers.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <GlassCard>
            <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border/50">
              <Server size={16} className="text-primary" />
              <h3 className="text-sm font-bold text-text uppercase tracking-wider">Server Rack</h3>
              <Badge variant="info">{servers.length} units</Badge>
            </div>

            {/* Rack frame */}
            <div
              className="relative rounded-lg border border-border/30 bg-[#0a0a14]/50 p-2"
              style={{ boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.3)' }}
            >
              {/* Rack rails (visual) */}
              <div className="absolute top-0 bottom-0 left-0 w-1 bg-gradient-to-b from-border/40 via-border/20 to-border/40 rounded-l" />
              <div className="absolute top-0 bottom-0 right-0 w-1 bg-gradient-to-b from-border/40 via-border/20 to-border/40 rounded-r" />

              <div className="flex flex-col gap-1 pl-3 pr-3">
                {servers.map((server, i) => (
                  <RackUnit
                    key={server.ip}
                    server={server}
                    isExpanded={expandedIp === server.ip}
                    onToggle={() => setExpandedIp(prev => prev === server.ip ? null : server.ip)}
                    index={i}
                  />
                ))}
              </div>
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* ── Health Matrix ──────────────────────────────────────────────────────── */}
      {servers.length > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <GlassCard>
            <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border/50">
              <CircleDot size={16} className="text-accent" />
              <h3 className="text-sm font-bold text-text uppercase tracking-wider">Health Matrix</h3>
              <span className="text-xs text-textMuted">Spot inconsistencies across servers</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="px-3 py-2 text-xs font-semibold text-textMuted uppercase tracking-wider sticky left-0 bg-card z-10 min-w-28">
                      Metric
                    </th>
                    {servers.map(s => (
                      <th key={s.ip} className="px-2 py-2 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-xs font-bold text-text truncate max-w-20">
                            {s.hostname || s.ip.split('.').pop()}
                          </span>
                          <Badge variant={roleVariant(s.role)} className="text-[9px] px-1 py-0">
                            {s.role || '?'}
                          </Badge>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {voltageRows.map(row => (
                    <tr key={row.key} className="border-b border-border/20 last:border-0">
                      <td className="px-3 py-1.5 text-xs text-textSecondary font-medium sticky left-0 bg-card z-10">
                        {row.label}
                      </td>
                      {servers.map(s => {
                        const rawVal = s.chassis[row.key]
                        if (row.type === 'temp') {
                          const val = parseTemp(rawVal)
                          return (
                            <MatrixCell
                              key={s.ip}
                              color={tempColor(val)}
                              value={val > 0 ? `${val}°F` : '--'}
                              tooltip={`${row.label}: ${rawVal || 'N/A'}`}
                            />
                          )
                        }
                        if (row.type === 'voltage') {
                          const val = parseVoltage(rawVal)
                          return (
                            <MatrixCell
                              key={s.ip}
                              color={voltageColor(val, row.nominal!)}
                              value={val > 0 ? `${val.toFixed(2)}V` : '--'}
                              tooltip={`${row.label}: ${rawVal || 'N/A'} (nominal ${row.nominal}V)`}
                            />
                          )
                        }
                        // fan
                        const val = parseRPM(rawVal)
                        return (
                          <MatrixCell
                            key={s.ip}
                            color={fanColor(val)}
                            value={val > 0 ? `${val}` : '--'}
                            tooltip={`${row.label}: ${rawVal || 'N/A'}`}
                          />
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-6 mt-4 pt-3 border-t border-border/30">
              <span className="text-xs text-textMuted">Legend:</span>
              {[
                { color: '#22c55e', label: 'Normal' },
                { color: '#f59e0b', label: 'Warning' },
                { color: '#ef4444', label: 'Critical' },
                { color: '#6b7280', label: 'N/A' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: item.color, boxShadow: `0 0 4px ${item.color}40` }}
                  />
                  <span className="text-xs text-textMuted">{item.label}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* ── Empty state ────────────────────────────────────────────────────────── */}
      {!scanning && servers.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <GlassCard>
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center">
                <Server size={28} className="text-textMuted" />
              </div>
              <p className="text-textMuted text-sm">No servers discovered on 192.168.100.200-254</p>
              <p className="text-textMuted/60 text-xs">
                Ensure servers are powered on and connected to the MGMT subnet
              </p>
              <Button variant="primary" size="sm" onClick={startScan}>
                <Activity size={14} />
                Scan Again
              </Button>
            </div>
          </GlassCard>
        </motion.div>
      )}
    </div>
  )
}
