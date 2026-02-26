import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Radio, Send, Wifi } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { DiscoveredServer, Profile } from '@/lib/types'
import {
  GlassCard,
  Badge,
  SectionHeader,
  Button,
  Input,
  ProgressRing,
} from '@/components/ui'
import { ServerTile } from '@/components/deploy/ServerTile'

// ─── Deploy progress per-server ───────────────────────────────────────────────

interface ServerDeployState {
  status: 'pending' | 'deploying' | 'done' | 'error'
  progress: number
  message: string
}

// ─── Timeout options ──────────────────────────────────────────────────────────

const TIMEOUT_OPTIONS = [
  { label: '100ms', value: '100' },
  { label: '200ms', value: '200' },
  { label: '500ms', value: '500' },
]

// ─── Inline select component (matches project's design language) ──────────────

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

// ─── Deploy progress bar ──────────────────────────────────────────────────────

interface DeployProgressRowProps {
  ip: string
  hostname: string
  state: ServerDeployState
}

function DeployProgressRow({ ip, hostname, state }: DeployProgressRowProps) {
  const statusColors: Record<ServerDeployState['status'], string> = {
    pending: 'bg-textMuted',
    deploying: 'bg-primary',
    done: 'bg-success',
    error: 'bg-error',
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-textSecondary shrink-0">{ip}</span>
          <span className="text-xs text-textMuted truncate">{hostname || 'Unknown'}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {state.message && (
            <span className="text-xs text-textMuted">{state.message}</span>
          )}
          <Badge
            variant={
              state.status === 'done'
                ? 'success'
                : state.status === 'error'
                  ? 'error'
                  : state.status === 'deploying'
                    ? 'info'
                    : 'neutral'
            }
          >
            {state.status}
          </Badge>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 bg-surface rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${statusColors[state.status]}`}
          initial={{ width: 0 }}
          animate={{ width: `${state.progress}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DeployPage() {
  // ── Scan state ──────────────────────────────────────────────────────────────
  const [subnet, setSubnet] = useState('192.168.10')
  const [rangeStart, setRangeStart] = useState('1')
  const [rangeEnd, setRangeEnd] = useState('254')
  const [timeout, setTimeout_] = useState('200')
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [scanStatus, setScanStatus] = useState('')
  const [servers, setServers] = useState<DiscoveredServer[]>([])
  const [hasScanned, setHasScanned] = useState(false)

  // Keep a ref to the latest servers length for use inside SSE callbacks
  const serversRef = useRef<DiscoveredServer[]>([])
  serversRef.current = servers

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectedIPs, setSelectedIPs] = useState<Set<string>>(new Set())

  // ── Profile state ───────────────────────────────────────────────────────────
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [profilesLoading, setProfilesLoading] = useState(true)

  // ── Deploy state ────────────────────────────────────────────────────────────
  const [deploying, setDeploying] = useState(false)
  const [deployStates, setDeployStates] = useState<Record<string, ServerDeployState>>({})

  // ── Load profiles on mount ──────────────────────────────────────────────────
  useEffect(() => {
    api
      .getProfiles()
      .then((data) => {
        setProfiles(data)
        if (data.length > 0) setSelectedProfile(data[0].Name)
      })
      .catch(() => toast.error('Failed to load profiles'))
      .finally(() => setProfilesLoading(false))
  }, [])

  // ── Scan ────────────────────────────────────────────────────────────────────
  const startScan = useCallback(() => {
    const start = parseInt(rangeStart, 10)
    const end = parseInt(rangeEnd, 10)

    if (isNaN(start) || isNaN(end) || start < 1 || end > 254 || start > end) {
      toast.error('Invalid IP range — start must be ≤ end, both 1–254')
      return
    }

    setScanning(true)
    setHasScanned(true)
    setServers([])
    setSelectedIPs(new Set())
    setDeployStates({})
    setScanProgress(0)
    setScanStatus(`Scanning ${subnet}.${start}–${end}…`)

    const es = api.scanNetwork(subnet, start, end)

    es.addEventListener('progress', (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { percent: number; current?: number }
      setScanProgress(data.percent)
      if (data.current !== undefined) {
        setScanStatus(`Scanning ${subnet}.${data.current}…`)
      }
    })

    es.addEventListener('discovered', (e: MessageEvent) => {
      const server = JSON.parse(e.data) as DiscoveredServer
      setServers((prev) => [...prev, server])
    })

    es.addEventListener('complete', () => {
      setScanning(false)
      setScanProgress(100)
      setScanStatus('')
      es.close()
      const count = serversRef.current.length
      toast.success(`Scan complete: ${count} server${count === 1 ? '' : 's'} found`)
    })

    es.onerror = () => {
      setScanning(false)
      setScanStatus('')
      es.close()
      toast.error('Scan failed')
    }
  }, [subnet, rangeStart, rangeEnd])

  // ── Server tile selection ───────────────────────────────────────────────────
  const toggleServer = useCallback((ip: string) => {
    setSelectedIPs((prev) => {
      const next = new Set(prev)
      if (next.has(ip)) {
        next.delete(ip)
      } else {
        next.add(ip)
      }
      return next
    })
  }, [])

  // ── Deploy ──────────────────────────────────────────────────────────────────
  const startDeploy = useCallback(() => {
    if (selectedIPs.size === 0 || !selectedProfile) return

    const targets = servers.filter((s) => selectedIPs.has(s.IPAddress))

    // Initialise all servers to pending
    const initialStates: Record<string, ServerDeployState> = {}
    for (const s of targets) {
      initialStates[s.IPAddress] = { status: 'pending', progress: 0, message: '' }
    }
    setDeployStates(initialStates)
    setDeploying(true)

    let completed = 0
    const total = targets.length

    for (const server of targets) {
      // Mark as deploying immediately
      setDeployStates((prev) => ({
        ...prev,
        [server.IPAddress]: { status: 'deploying', progress: 0, message: 'Starting…' },
      }))

      const es = api.deployProfile(server.IPAddress, selectedProfile)

      es.addEventListener('progress', (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { percent: number; message?: string }
        setDeployStates((prev) => ({
          ...prev,
          [server.IPAddress]: {
            status: 'deploying',
            progress: data.percent,
            message: data.message ?? '',
          },
        }))
      })

      es.addEventListener('complete', () => {
        es.close()
        setDeployStates((prev) => ({
          ...prev,
          [server.IPAddress]: { status: 'done', progress: 100, message: 'Done' },
        }))
        toast.success(`Deployed to ${server.Hostname || server.IPAddress}`)
        completed++
        if (completed === total) setDeploying(false)
      })

      es.onerror = () => {
        es.close()
        setDeployStates((prev) => ({
          ...prev,
          [server.IPAddress]: {
            status: 'error',
            progress: prev[server.IPAddress]?.progress ?? 0,
            message: 'Failed',
          },
        }))
        toast.error(`Deploy failed for ${server.Hostname || server.IPAddress}`)
        completed++
        if (completed === total) setDeploying(false)
      }
    }
  }, [selectedIPs, selectedProfile, servers])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const selectedServers = servers.filter((s) => selectedIPs.has(s.IPAddress))
  const canDeploy = selectedIPs.size > 0 && !!selectedProfile && !deploying && !scanning
  const hasDeployProgress = Object.keys(deployStates).length > 0

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="Network Deploy"
        subtitle="Discover disguise servers and deploy profiles"
      />

      {/* ── Card 1: Network Scan ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <GlassCard title="Network Scan">
          {/* Scan controls row */}
          <div className="flex flex-wrap items-end gap-3">
            {/* Subnet base */}
            <Input
              label="Subnet"
              value={subnet}
              onChange={setSubnet}
              placeholder="192.168.10"
              disabled={scanning}
              className="w-44"
            />

            {/* Range: start */}
            <div className="flex flex-col gap-1.5">
              <span className="text-textSecondary font-medium text-sm">Range</span>
              <div className="flex items-center gap-2">
                <Input
                  value={rangeStart}
                  onChange={setRangeStart}
                  placeholder="1"
                  disabled={scanning}
                  className="w-16"
                  type="number"
                />
                <span className="text-textMuted text-sm">–</span>
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

            {/* Timeout */}
            <div className="flex flex-col gap-1.5">
              <span className="text-textSecondary font-medium text-sm">Timeout</span>
              <Select
                value={timeout}
                onChange={setTimeout_}
                options={TIMEOUT_OPTIONS}
                disabled={scanning}
                aria-label="Scan timeout"
              />
            </div>

            {/* Scan button */}
            <Button
              variant="primary"
              onClick={startScan}
              loading={scanning}
              disabled={scanning}
              className="self-end"
            >
              <Radio size={14} className="shrink-0" />
              {scanning ? 'Scanning…' : 'Scan Network'}
            </Button>
          </div>

          {/* Scan progress (visible during scan) */}
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
                    {scanStatus && (
                      <p className="text-textMuted text-sm font-mono">{scanStatus}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>
      </motion.div>

      {/* ── Card 2: Discovered Servers (visible after first scan) ── */}
      <AnimatePresence>
        {hasScanned && (
          <motion.div
            key="servers-card"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <GlassCard>
              {/* Card header */}
              <div className="flex items-center justify-between gap-4 mb-5 pb-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <h3 className="text-text font-bold text-sm tracking-wide">
                    Discovered Servers
                  </h3>
                  <Badge variant={servers.length > 0 ? 'info' : 'neutral'}>
                    {servers.length}
                  </Badge>
                </div>

                {servers.length > 0 && !scanning && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedIPs.size === servers.length) {
                        setSelectedIPs(new Set())
                      } else {
                        setSelectedIPs(new Set(servers.map((s) => s.IPAddress)))
                      }
                    }}
                    className="text-xs text-textMuted hover:text-textSecondary transition-colors duration-150 cursor-pointer select-none"
                  >
                    {selectedIPs.size === servers.length ? 'Deselect all' : 'Select all'}
                  </button>
                )}
              </div>

              {/* Empty state */}
              {servers.length === 0 && !scanning && (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Wifi size={32} className="text-textMuted" aria-hidden="true" />
                  <p className="text-textMuted text-sm">No servers discovered</p>
                  <p className="text-textMuted/60 text-xs">
                    Check your subnet settings and run the scan again
                  </p>
                </div>
              )}

              {/* Server grid */}
              {servers.length > 0 && (
                <div
                  className="grid grid-cols-3 gap-3"
                  role="group"
                  aria-label="Discovered servers"
                >
                  {servers.map((server, i) => (
                    <ServerTile
                      key={server.IPAddress}
                      server={server}
                      selected={selectedIPs.has(server.IPAddress)}
                      onSelect={() => toggleServer(server.IPAddress)}
                      index={i}
                    />
                  ))}
                </div>
              )}

              {/* ── Deploy section ── */}
              {servers.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.2 }}
                  className="mt-6 pt-5 border-t border-border flex flex-col gap-4"
                >
                  {/* Profile selector + deploy button */}
                  <div className="flex flex-wrap items-end gap-3">
                    {/* Profile dropdown */}
                    <div className="flex flex-col gap-1.5 flex-1 min-w-48">
                      <span className="text-textSecondary font-medium text-sm">Profile</span>
                      <Select
                        value={selectedProfile}
                        onChange={setSelectedProfile}
                        options={
                          profilesLoading
                            ? [{ label: 'Loading…', value: '' }]
                            : profiles.length === 0
                              ? [{ label: 'No profiles', value: '' }]
                              : profiles.map((p) => ({ label: p.Name, value: p.Name }))
                        }
                        disabled={profilesLoading || deploying}
                        aria-label="Select profile"
                      />
                    </div>

                    {/* Selection summary */}
                    <div className="flex items-center gap-2 self-end pb-2">
                      <span className="text-textMuted text-sm">
                        {selectedIPs.size > 0
                          ? `${selectedIPs.size} server${selectedIPs.size === 1 ? '' : 's'} selected`
                          : 'No servers selected'}
                      </span>
                    </div>

                    {/* Deploy button */}
                    <Button
                      variant="primary"
                      onClick={startDeploy}
                      disabled={!canDeploy}
                      loading={deploying}
                      className="self-end"
                    >
                      <Send size={14} className="shrink-0" />
                      {deploying ? 'Deploying…' : 'Deploy to Selected'}
                    </Button>
                  </div>

                  {/* Per-server deploy progress bars */}
                  <AnimatePresence>
                    {hasDeployProgress && (
                      <motion.div
                        key="deploy-progress"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-col gap-3 p-4 bg-surface/40 rounded-lg border border-border">
                          <h4 className="text-xs font-semibold text-textSecondary uppercase tracking-wider">
                            Deploy Progress
                          </h4>
                          {selectedServers.map((server) => {
                            const state = deployStates[server.IPAddress]
                            if (!state) return null
                            return (
                              <DeployProgressRow
                                key={server.IPAddress}
                                ip={server.IPAddress}
                                hostname={server.Hostname}
                                state={state}
                              />
                            )
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

