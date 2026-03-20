import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Radar,
  ChevronDown,
  ChevronRight,
  Zap,
  Power,
  Send,
  Server,
  Play,
  Square,
  Palette,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { Profile, Result } from '@/lib/types'
import {
  GlassCard,
  Badge,
  SectionHeader,
  Button,
  Input,
  ProgressRing,
  StatusDot,
} from '@/components/ui'

// ─── SMC-specific types ──────────────────────────────────────────────────────

interface SMCAdapter {
  name: string
  ipAddress: string
  macAddress: string
  netmask: string
}

interface SMCServer {
  ip: string
  hostname: string
  serialNumber: string
  machineType: string
  role: string // 'director' | 'actor' | 'understudy' | 'unknown'
  adapters: SMCAdapter[]
  power: Record<string, string>
  chassis: Record<string, unknown>
  session: Record<string, unknown>
}

// ─── LED color presets ───────────────────────────────────────────────────────

const LED_COLORS: { label: string; r: number; g: number; b: number; css: string }[] = [
  { label: 'Red',    r: 255, g: 0,   b: 0,   css: 'bg-red-500' },
  { label: 'Green',  r: 0,   g: 255, b: 0,   css: 'bg-green-500' },
  { label: 'Blue',   r: 0,   g: 0,   b: 255, css: 'bg-blue-500' },
  { label: 'Purple', r: 128, g: 0,   b: 255, css: 'bg-purple-500' },
  { label: 'White',  r: 255, g: 255, b: 255, css: 'bg-white border border-border' },
  { label: 'Off',    r: 0,   g: 0,   b: 0,   css: 'bg-black border border-border' },
]

// ─── LED FX presets ─────────────────────────────────────────────────────────

const FX_PRESETS: {
  id: string
  label: string
  icon: string
  description: string
  defaultColor?: { r: number; g: number; b: number }
}[] = [
  { id: 'chase',     label: 'Chase',     icon: '➡️', description: 'Light races across all servers' },
  { id: 'bounce',    label: 'Bounce',    icon: '↔️', description: 'Light bounces back and forth' },
  { id: 'rainbow',   label: 'Rainbow',   icon: '🌈', description: 'Rotating rainbow across servers' },
  { id: 'pulse',     label: 'Pulse',     icon: '💜', description: 'All servers breathe together', defaultColor: { r: 128, g: 0, b: 255 } },
  { id: 'wave',      label: 'Wave',      icon: '🌊', description: 'Brightness wave ripples across', defaultColor: { r: 0, g: 200, b: 255 } },
  { id: 'alternate', label: 'Alternate', icon: '🔀', description: 'Even/odd servers swap colors', defaultColor: { r: 255, g: 0, b: 0 } },
  { id: 'split',     label: 'Split',     icon: '↕️', description: 'Left vs right half swap colors' },
  { id: 'converge',  label: 'Converge',  icon: '🎯', description: 'Edges move inward then back out', defaultColor: { r: 255, g: 200, b: 0 } },
  { id: 'stack',     label: 'Stack',     icon: '📊', description: 'Fill up one by one, then drain', defaultColor: { r: 0, g: 255, b: 0 } },
  { id: 'flash',     label: 'Flash',     icon: '⚡', description: 'All servers flash on/off', defaultColor: { r: 255, g: 255, b: 255 } },
]

const SPEED_OPTIONS = [
  { label: 'Slow (2s)', value: '2000' },
  { label: 'Medium (1s)', value: '1000' },
  { label: 'Fast (700ms)', value: '700' },
  { label: 'Turbo (500ms)', value: '500' },
]

// ─── Role badge variant mapping ──────────────────────────────────────────────

function roleBadgeVariant(role: string): 'success' | 'info' | 'warning' | 'neutral' {
  const r = role.toLowerCase()
  if (r.includes('director'))   return 'success'
  if (r.includes('actor'))      return 'info'
  if (r.includes('understudy')) return 'warning'
  return 'neutral'
}

// ─── Inline select component (matches project design language) ───────────────

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: { label: string; value: string }[]
  disabled?: boolean
  'aria-label'?: string
}

function Select({ value, onChange, options, disabled = false, 'aria-label': ariaLabel }: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={[
        'px-3 py-2 rounded-lg text-sm transition-colors duration-150 outline-none',
        'bg-surface border border-border text-text',
        'focus:border-primary focus:ring-1 focus:ring-primary/30',
        'appearance-none cursor-pointer',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

// ─── Server Tile Component ───────────────────────────────────────────────────

interface ServerTileProps {
  server: SMCServer
  expanded: boolean
  onToggleExpand: () => void
  smcUser: string
  smcPass: string
  profiles: Profile[]
  selectedProfile: string
  onSelectProfile: (profileName: string) => void
  deploying: boolean
  onDeploy: () => void
  index: number
}

function SMCServerTile({
  server,
  expanded,
  onToggleExpand,
  smcUser,
  smcPass,
  profiles,
  selectedProfile,
  onSelectProfile,
  deploying,
  onDeploy,
  index,
}: ServerTileProps) {
  const powerVal = server.power['System Power'] ?? server.power['powerStatus'] ?? ''
  const isPoweredOn = powerVal.toLowerCase().includes('on')
  const hasFault = (server.power['Main Power Fault'] ?? server.power['Power Control Fault'] ?? 'false') !== 'false'

  const handleIdentify = async () => {
    try {
      const res: Result = await api.smcIdentify(server.ip)
      if (res.success) toast.success(`Identify sent to ${server.hostname || server.ip}`)
      else toast.error(res.message || 'Identify failed')
    } catch {
      toast.error('Failed to send identify')
    }
  }

  const handleLed = async (r: number, g: number, b: number, label: string) => {
    try {
      const res: Result = await api.smcSetLed(server.ip, 'static', r, g, b, { user: smcUser, pass: smcPass })
      if (res.success) toast.success(`LED set to ${label} on ${server.hostname || server.ip}`)
      else toast.error(res.message || 'LED control failed')
    } catch {
      toast.error('Failed to set LED')
    }
  }

  const handlePower = async (action: 'on' | 'off' | 'cycle') => {
    try {
      const res: Result = await api.smcPower(server.ip, action, { user: smcUser, pass: smcPass })
      if (res.success) toast.success(`Power ${action} sent to ${server.hostname || server.ip}`)
      else toast.error(res.message || `Power ${action} failed`)
    } catch {
      toast.error(`Failed to power ${action}`)
    }
  }

  // Find the selected profile object for comparison display
  const profile = profiles.find((p) => p.Name === selectedProfile)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05, ease: 'easeOut' }}
    >
      <GlassCard>
        {/* ── Collapsed header ── */}
        <div className="flex flex-col gap-2">
          {/* Row 1: hostname, role badge, machine type badge */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-text truncate">{server.hostname || 'Unknown'}</span>
              <Badge variant={roleBadgeVariant(server.role)}>{server.role}</Badge>
              <Badge variant="neutral">{server.machineType || 'Unknown'}</Badge>
            </div>
            <StatusDot status={isPoweredOn ? 'online' : 'offline'} />
          </div>

          {/* Row 2: IP + serial */}
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-textSecondary">{server.ip}</span>
            <span className="text-xs text-textMuted">{server.serialNumber}</span>
          </div>

          {/* Row 3: actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" onClick={handleIdentify}>
              <Zap size={12} className="shrink-0" />
              Identify
            </Button>

            {/* LED color picker */}
            <div className="flex items-center gap-1">
              {LED_COLORS.map((led) => (
                <button
                  key={led.label}
                  type="button"
                  title={`LED: ${led.label}`}
                  onClick={() => handleLed(led.r, led.g, led.b, led.label)}
                  className={[
                    'w-5 h-5 rounded-full cursor-pointer transition-transform duration-100',
                    'hover:scale-125 active:scale-95',
                    led.css,
                  ].join(' ')}
                  aria-label={`Set LED ${led.label}`}
                />
              ))}
            </div>

            {/* Expand/collapse */}
            <button
              type="button"
              onClick={onToggleExpand}
              className="ml-auto p-1.5 rounded-md text-textMuted hover:text-text hover:bg-hover transition-colors duration-150 cursor-pointer"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>
        </div>

        {/* ── Expanded section ── */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              key="expanded"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="mt-4 pt-4 border-t border-border flex flex-col gap-5">
                {/* ── Network Adapters Table ── */}
                <div>
                  <h4 className="text-xs font-semibold text-textSecondary uppercase tracking-wider mb-2">
                    Network Adapters
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-textMuted border-b border-border">
                          <th className="text-left py-1.5 pr-3 font-medium">Port</th>
                          <th className="text-left py-1.5 pr-3 font-medium">IP Address</th>
                          <th className="text-left py-1.5 pr-3 font-medium">Netmask</th>
                          <th className="text-left py-1.5 font-medium">MAC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {server.adapters.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-2 text-textMuted text-center">
                              No adapters reported
                            </td>
                          </tr>
                        ) : (
                          server.adapters.map((adapter) => (
                            <tr key={adapter.macAddress || adapter.name} className="border-b border-border/50">
                              <td className="py-1.5 pr-3 text-text">{adapter.name}</td>
                              <td className="py-1.5 pr-3 font-mono text-textSecondary">{adapter.ipAddress}</td>
                              <td className="py-1.5 pr-3 font-mono text-textSecondary">{adapter.netmask}</td>
                              <td className="py-1.5 font-mono text-textMuted">{adapter.macAddress}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Deploy Section ── */}
                <div>
                  <h4 className="text-xs font-semibold text-textSecondary uppercase tracking-wider mb-2">
                    Deploy Configuration
                  </h4>
                  <div className="flex flex-col gap-3">
                    {/* Profile selector */}
                    <div className="flex items-end gap-3 flex-wrap">
                      <div className="flex flex-col gap-1.5 flex-1 min-w-40">
                        <span className="text-textSecondary font-medium text-xs">Profile</span>
                        <Select
                          value={selectedProfile}
                          onChange={onSelectProfile}
                          options={
                            profiles.length === 0
                              ? [{ label: 'No profiles', value: '' }]
                              : [
                                  { label: 'Select profile...', value: '' },
                                  ...profiles.map((p) => ({ label: p.Name, value: p.Name })),
                                ]
                          }
                          disabled={deploying}
                          aria-label="Select profile for this server"
                        />
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={onDeploy}
                        disabled={!selectedProfile || deploying}
                        loading={deploying}
                      >
                        <Send size={12} className="shrink-0" />
                        {deploying ? 'Deploying...' : 'Deploy Config'}
                      </Button>
                    </div>

                    {/* Profile vs current comparison */}
                    {profile && (
                      <div className="p-3 bg-surface/40 rounded-lg border border-border text-xs">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          <span className="text-textMuted">Profile Hostname:</span>
                          <span className="font-mono text-text">{profile.ServerName}</span>
                          <span className="text-textMuted">Current Hostname:</span>
                          <span className="font-mono text-text">{server.hostname}</span>
                        </div>
                        {profile.NetworkAdapters.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border/50 grid grid-cols-2 gap-x-4 gap-y-1">
                            {profile.NetworkAdapters.filter((a) => a.Enabled).map((adapter) => (
                              <span key={adapter.Index} className="contents">
                                <span className="text-textMuted">{adapter.Role || adapter.DisplayName}:</span>
                                <span className="font-mono text-textSecondary">{adapter.IPAddress}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Health Panel ── */}
                <div>
                  <h4 className="text-xs font-semibold text-textSecondary uppercase tracking-wider mb-2">
                    Power & Health
                  </h4>
                  <div className="flex flex-col gap-3">
                    {/* Status display */}
                    <div className="flex items-center gap-3">
                      <StatusDot status={isPoweredOn ? 'online' : 'offline'} />
                      <span className="text-sm text-text">
                        {powerVal || 'Unknown'}
                      </span>
                      {hasFault && (
                        <Badge variant="error" pulse>Fault</Badge>
                      )}
                    </div>

                    {/* Power control buttons */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button variant="ghost" size="sm" onClick={() => handlePower('on')}>
                        <Power size={12} className="shrink-0" />
                        Power On
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handlePower('off')}>
                        <Power size={12} className="shrink-0" />
                        Power Off
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handlePower('cycle')}>
                        <Power size={12} className="shrink-0" />
                        Power Cycle
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function SMCDiscoveryPage() {
  // ── Scan state ──────────────────────────────────────────────────────────────
  const [subnet, setSubnet] = useState('192.168.100')
  const [rangeStart, setRangeStart] = useState('200')
  const [rangeEnd, setRangeEnd] = useState('254')
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [servers, setServers] = useState<SMCServer[]>([])
  const [hasScanned, setHasScanned] = useState(false)

  // Keep a ref to the latest servers length for use inside SSE callbacks
  const serversRef = useRef<SMCServer[]>([])
  serversRef.current = servers

  // ── Expand/collapse state ──────────────────────────────────────────────────
  const [expandedIPs, setExpandedIPs] = useState<Set<string>>(new Set())

  // ── SMC credentials ────────────────────────────────────────────────────────
  const [smcUser, setSmcUser] = useState('admin')
  const [smcPass, setSmcPass] = useState('Solotech1')

  // ── Profile state ──────────────────────────────────────────────────────────
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, string>>({}) // ip -> profileName
  const [deployingIPs, setDeployingIPs] = useState<Set<string>>(new Set())

  // ── LED FX state ──────────────────────────────────────────────────────────
  const [selectedFx, setSelectedFx] = useState('chase')
  const [fxSpeed, setFxSpeed] = useState('1000')
  const [fxLoops, setFxLoops] = useState('3')
  const [fxRunning, setFxRunning] = useState(false)
  const [fxProgress, setFxProgress] = useState(0)
  const [fxColorR, setFxColorR] = useState('')
  const [fxColorG, setFxColorG] = useState('')
  const [fxColorB, setFxColorB] = useState('')
  const fxEventSourceRef = useRef<EventSource | null>(null)

  // ── Load profiles on mount ─────────────────────────────────────────────────
  useEffect(() => {
    api.getProfiles().then(setProfiles).catch(() => toast.error('Failed to load profiles'))
  }, [])

  // ── Toggle expand ──────────────────────────────────────────────────────────
  const toggleExpand = useCallback((ip: string) => {
    setExpandedIPs((prev) => {
      const next = new Set(prev)
      if (next.has(ip)) {
        next.delete(ip)
      } else {
        next.add(ip)
      }
      return next
    })
  }, [])

  // ── Scan ───────────────────────────────────────────────────────────────────
  const startScan = useCallback(() => {
    const start = parseInt(rangeStart, 10)
    const end = parseInt(rangeEnd, 10)

    if (isNaN(start) || isNaN(end) || start < 1 || end > 254 || start > end) {
      toast.error('Invalid IP range -- start must be <= end, both 1-254')
      return
    }

    setScanning(true)
    setServers([])
    setHasScanned(true)
    setScanProgress(0)
    setExpandedIPs(new Set())

    const es = api.smcDiscover(subnet, start, end)

    es.addEventListener('progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { percent: number }
        setScanProgress(data.percent)
      } catch {
        console.warn('[SMCDiscoveryPage] Failed to parse scan progress event:', e.data)
      }
    })

    es.addEventListener('discovered', (e: MessageEvent) => {
      try {
        const server = JSON.parse(e.data) as SMCServer
        setServers((prev) => [...prev, server])
      } catch {
        console.warn('[SMCDiscoveryPage] Failed to parse discovered event:', e.data)
      }
    })

    es.addEventListener('complete', () => {
      setScanning(false)
      setScanProgress(100)
      es.close()
      const count = serversRef.current.length
      toast.success(`Scan complete: ${count} server${count === 1 ? '' : 's'} found`)
    })

    // Named SSE 'error' event -- application-level error sent by the server
    es.addEventListener('error', (e: MessageEvent) => {
      setScanning(false)
      es.close()
      try {
        const data = JSON.parse(e.data) as { message?: string }
        toast.error(data.message ?? 'Scan failed')
      } catch {
        toast.error('Scan failed')
      }
    })

    // Network-level onerror -- connection dropped / server unreachable
    es.onerror = () => {
      setScanning(false)
      es.close()
      toast.error('Scan connection lost')
    }
  }, [subnet, rangeStart, rangeEnd])

  // ── Deploy config to a single server ───────────────────────────────────────
  const deployToServer = useCallback(
    async (server: SMCServer) => {
      const profileName = selectedProfiles[server.ip]
      if (!profileName) return

      const profile = profiles.find((p) => p.Name === profileName)
      if (!profile) {
        toast.error('Selected profile not found')
        return
      }

      setDeployingIPs((prev) => new Set(prev).add(server.ip))

      try {
        // Step 1: Set hostname
        const hostnameRes: Result = await api.smcSetHostname(server.ip, profile.ServerName, {
          user: smcUser,
          pass: smcPass,
        })
        if (!hostnameRes.success) {
          toast.error(`Hostname set failed: ${hostnameRes.message}`)
          return
        }

        // Step 2: Set network adapters
        const adapterPayload = profile.NetworkAdapters.filter((a) => a.Enabled).map((a) => ({
          mac: '', // let the SMC API match by index
          ipAddress: a.IPAddress,
          netmask: a.SubnetMask,
        }))

        if (adapterPayload.length > 0) {
          const adapterRes: Result = await api.smcSetAdapters(server.ip, adapterPayload, {
            user: smcUser,
            pass: smcPass,
          })
          if (!adapterRes.success) {
            toast.error(`Adapter config failed: ${adapterRes.message}`)
            return
          }
        }

        toast.success(`Config deployed to ${server.hostname || server.ip}`)
      } catch {
        toast.error(`Deploy failed for ${server.hostname || server.ip}`)
      } finally {
        setDeployingIPs((prev) => {
          const next = new Set(prev)
          next.delete(server.ip)
          return next
        })
      }
    },
    [selectedProfiles, profiles, smcUser, smcPass],
  )

  // ── Run LED FX ────────────────────────────────────────────────────────────
  const runFx = useCallback(() => {
    if (servers.length === 0) {
      toast.error('No servers to run FX on')
      return
    }

    const serverIPs = servers.map(s => s.ip)
    const speed = parseInt(fxSpeed, 10) || 150
    const loops = parseInt(fxLoops, 10) || 3
    const color = (fxColorR && fxColorG && fxColorB)
      ? { r: parseInt(fxColorR, 10) || 0, g: parseInt(fxColorG, 10) || 0, b: parseInt(fxColorB, 10) || 0 }
      : undefined

    setFxRunning(true)
    setFxProgress(0)

    const es = api.smcRunFx(serverIPs, selectedFx, speed, loops, color, { user: smcUser, pass: smcPass })
    fxEventSourceRef.current = es

    es.addEventListener('frame', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { percent: number }
        setFxProgress(data.percent)
      } catch { /* ignore */ }
    })

    es.addEventListener('complete', () => {
      setFxRunning(false)
      setFxProgress(100)
      es.close()
      fxEventSourceRef.current = null
      toast.success(`FX "${selectedFx}" complete`)
    })

    es.addEventListener('error', (e: MessageEvent) => {
      setFxRunning(false)
      es.close()
      fxEventSourceRef.current = null
      try {
        toast.error(JSON.parse(e.data).message || 'FX failed')
      } catch {
        toast.error('FX failed')
      }
    })

    es.onerror = () => {
      setFxRunning(false)
      es.close()
      fxEventSourceRef.current = null
      toast.error('FX connection lost')
    }
  }, [servers, selectedFx, fxSpeed, fxLoops, fxColorR, fxColorG, fxColorB, smcUser, smcPass])

  const stopFx = useCallback(() => {
    if (fxEventSourceRef.current) {
      fxEventSourceRef.current.close()
      fxEventSourceRef.current = null
    }
    setFxRunning(false)
    setFxProgress(0)
    // Turn all LEDs off
    for (const server of servers) {
      api.smcSetLed(server.ip, 'static', 0, 0, 0, { user: smcUser, pass: smcPass }).catch(() => {})
    }
    toast('FX stopped, LEDs off')
  }, [servers, smcUser, smcPass])

  // Cleanup FX on unmount
  useEffect(() => {
    return () => {
      if (fxEventSourceRef.current) {
        fxEventSourceRef.current.close()
      }
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="SMC Discovery"
        subtitle="Discover and configure disguise servers via MGMT network"
      />

      {/* ── Card 1: MGMT Network Scan ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <GlassCard title="MGMT Network Scan">
          {/* Scan controls row */}
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="Subnet"
              value={subnet}
              onChange={setSubnet}
              placeholder="192.168.100"
              disabled={scanning}
              className="w-44"
            />

            <div className="flex flex-col gap-1.5">
              <span className="text-textSecondary font-medium text-sm">Range</span>
              <div className="flex items-center gap-2">
                <Input
                  value={rangeStart}
                  onChange={setRangeStart}
                  placeholder="200"
                  disabled={scanning}
                  className="w-16"
                  type="number"
                />
                <span className="text-textMuted text-sm">-</span>
                <Input
                  value={rangeEnd}
                  onChange={setRangeEnd}
                  placeholder="254"
                  disabled={scanning}
                  className="w-16"
                  type="number"
                />
              </div>
            </div>

            <Button
              variant="primary"
              onClick={startScan}
              loading={scanning}
              disabled={scanning}
              className="self-end"
            >
              <Radar size={14} className="shrink-0" />
              {scanning ? 'Scanning...' : 'Scan Network'}
            </Button>
          </div>

          {/* Scan progress */}
          <AnimatePresence>
            {scanning && (
              <motion.div
                key="scan-progress"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-6 mt-6 pt-5 border-t border-border">
                  <ProgressRing progress={scanProgress} size={80} strokeWidth={6} />
                  <div className="flex flex-col gap-1.5">
                    <p className="text-text font-bold text-lg">
                      {servers.length} server{servers.length === 1 ? '' : 's'} found
                    </p>
                    <p className="text-textMuted text-sm font-mono">
                      Scanning {subnet}.{rangeStart}-{rangeEnd}...
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>
      </motion.div>

      {/* ── SMC Credentials ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.05 }}
      >
        <GlassCard>
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="SMC Username"
              value={smcUser}
              onChange={setSmcUser}
              placeholder="ADMIN"
              className="w-40"
            />
            <Input
              label="SMC Password"
              value={smcPass}
              onChange={setSmcPass}
              placeholder="ADMIN"
              type="password"
              className="w-40"
            />
            <span className="text-textMuted text-xs pb-2">
              Shared credentials for BMC/IPMI operations
            </span>
          </div>
        </GlassCard>
      </motion.div>

      {/* ── LED FX Control Panel ── */}
      <AnimatePresence>
        {servers.length > 0 && (
          <motion.div
            key="fx-panel"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.35, ease: 'easeOut', delay: 0.1 }}
          >
            <GlassCard title="LED FX Control" accent="#7C3AED">
              {/* Visual rack layout showing server positions */}
              <div className="mb-5">
                <span className="text-xs text-textMuted uppercase tracking-wider font-semibold">
                  Server Rack — {servers.length} units
                </span>
                <div className="flex items-center gap-1.5 mt-2">
                  {servers.map((server, i) => {
                    // During FX, show approximate current color via progress
                    const isActive = fxRunning
                    return (
                      <div
                        key={server.ip}
                        className={[
                          'flex-1 h-10 rounded-md border flex items-center justify-center text-xs font-mono transition-all duration-150',
                          isActive
                            ? 'border-primary/50 bg-primary/20 text-primary animate-pulse-slow'
                            : 'border-border bg-surface text-textSecondary',
                        ].join(' ')}
                        title={`${server.hostname || server.ip} (Position ${i + 1})`}
                      >
                        <span className="truncate px-1">
                          {server.hostname ? server.hostname.slice(0, 8) : `S${i + 1}`}
                        </span>
                      </div>
                    )
                  })}
                </div>
                {servers.length >= 4 && (
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-textMuted">← Left side</span>
                    <span className="text-[10px] text-textMuted">Right side →</span>
                  </div>
                )}
              </div>

              {/* FX preset grid */}
              <div className="grid grid-cols-5 gap-2 mb-4">
                {FX_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedFx(preset.id)}
                    disabled={fxRunning}
                    title={preset.description}
                    className={[
                      'flex flex-col items-center gap-1 p-2.5 rounded-lg text-xs font-medium',
                      'transition-all duration-150 cursor-pointer select-none',
                      selectedFx === preset.id
                        ? 'bg-primary/20 border border-primary/50 text-primary ring-1 ring-primary/20'
                        : 'bg-surface border border-border text-textSecondary hover:bg-hover hover:text-text',
                      fxRunning ? 'opacity-50 cursor-not-allowed' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <span className="text-base leading-none">{preset.icon}</span>
                    <span className="truncate w-full text-center">{preset.label}</span>
                  </button>
                ))}
              </div>

              {/* Controls row */}
              <div className="flex flex-wrap items-end gap-3">
                {/* Speed */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-textSecondary font-medium text-xs">Speed</span>
                  <Select
                    value={fxSpeed}
                    onChange={setFxSpeed}
                    options={SPEED_OPTIONS}
                    disabled={fxRunning}
                    aria-label="FX speed"
                  />
                </div>

                {/* Loops */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-textSecondary font-medium text-xs">Loops</span>
                  <Input
                    value={fxLoops}
                    onChange={setFxLoops}
                    placeholder="3"
                    disabled={fxRunning}
                    className="w-16"
                    type="number"
                  />
                </div>

                {/* Custom color override (optional) */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-textSecondary font-medium text-xs">Color (optional)</span>
                  <div className="flex items-center gap-1">
                    <Input value={fxColorR} onChange={setFxColorR} placeholder="R" disabled={fxRunning} className="w-12" type="number" />
                    <Input value={fxColorG} onChange={setFxColorG} placeholder="G" disabled={fxRunning} className="w-12" type="number" />
                    <Input value={fxColorB} onChange={setFxColorB} placeholder="B" disabled={fxRunning} className="w-12" type="number" />
                  </div>
                </div>

                {/* Play / Stop buttons */}
                <div className="flex items-center gap-2 self-end">
                  {!fxRunning ? (
                    <Button variant="primary" onClick={runFx} disabled={servers.length === 0}>
                      <Play size={14} className="shrink-0" />
                      Run FX
                    </Button>
                  ) : (
                    <Button variant="destructive" onClick={stopFx}>
                      <Square size={14} className="shrink-0" />
                      Stop
                    </Button>
                  )}
                </div>

                {/* All Off shortcut */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-end"
                  onClick={() => {
                    for (const server of servers) {
                      api.smcSetLed(server.ip, 'static', 0, 0, 0, { user: smcUser, pass: smcPass }).catch(() => {})
                    }
                    toast('All LEDs off')
                  }}
                  disabled={fxRunning}
                >
                  <Palette size={12} />
                  All Off
                </Button>
              </div>

              {/* FX progress bar */}
              <AnimatePresence>
                {fxRunning && (
                  <motion.div
                    key="fx-progress"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 pt-3 border-t border-border">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-textSecondary">
                          Running: <span className="text-primary font-semibold">{FX_PRESETS.find(p => p.id === selectedFx)?.label}</span>
                        </span>
                        <span className="text-xs text-textMuted font-mono">{fxProgress}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${fxProgress}%` }}
                          transition={{ duration: 0.15, ease: 'easeOut' }}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* FX description */}
              <p className="mt-3 text-xs text-textMuted">
                {FX_PRESETS.find(p => p.id === selectedFx)?.description ?? ''}
                {' '} — Across {servers.length} server{servers.length === 1 ? '' : 's'}
              </p>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Discovered Servers Grid ── */}
      <AnimatePresence>
        {hasScanned && (
          <motion.div
            key="servers-section"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            {/* Section header with count */}
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-text font-bold text-sm tracking-wide">
                Discovered Servers
              </h3>
              <Badge variant={servers.length > 0 ? 'info' : 'neutral'}>
                {servers.length}
              </Badge>
            </div>

            {/* Empty state */}
            {servers.length === 0 && !scanning && (
              <GlassCard>
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Server size={32} className="text-textMuted" aria-hidden="true" />
                  <p className="text-textMuted text-sm">No servers discovered</p>
                  <p className="text-textMuted/60 text-xs">
                    Check your subnet and range settings, then scan again
                  </p>
                </div>
              </GlassCard>
            )}

            {/* Server grid */}
            {servers.length > 0 && (
              <div
                className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4"
                role="group"
                aria-label="Discovered SMC servers"
              >
                {servers.map((server, i) => (
                  <SMCServerTile
                    key={server.ip}
                    server={server}
                    expanded={expandedIPs.has(server.ip)}
                    onToggleExpand={() => toggleExpand(server.ip)}
                    smcUser={smcUser}
                    smcPass={smcPass}
                    profiles={profiles}
                    selectedProfile={selectedProfiles[server.ip] ?? ''}
                    onSelectProfile={(name) =>
                      setSelectedProfiles((prev) => ({ ...prev, [server.ip]: name }))
                    }
                    deploying={deployingIPs.has(server.ip)}
                    onDeploy={() => deployToServer(server)}
                    index={i}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
