import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Radio, Send, Wifi, Monitor, RefreshCw, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { DiscoveredServer, Profile, NetworkInterface } from '@/lib/types'
import { GlassCard, SectionHeader, Badge, Button } from '@/components/ui'

// ─── Types ────────────────────────────────────────────────────────────────────

type DeployStatus = 'idle' | 'deploying' | 'done' | 'error'

interface RowDeployState {
  status: DeployStatus
  progress: number
  message: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveSubnet(address: string): string {
  // "192.168.10.100" → "192.168.10"
  const parts = address.split('.')
  if (parts.length === 4) return parts.slice(0, 3).join('.')
  return address
}

// ─── Inline Select ────────────────────────────────────────────────────────────

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: { label: string; value: string }[]
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

function Select({
  value,
  onChange,
  options,
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
}: SelectProps) {
  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        className={[
          'w-full appearance-none pl-3 pr-8 py-2 rounded-lg text-sm outline-none transition-colors duration-150',
          'bg-surface border border-border text-text',
          'focus:border-primary focus:ring-1 focus:ring-primary/30',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
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
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 text-textMuted"
        aria-hidden="true"
      />
    </div>
  )
}

// ─── Row deploy status pill ───────────────────────────────────────────────────

function DeployStatusPill({ state }: { state: RowDeployState }) {
  if (state.status === 'idle') return null

  const variant =
    state.status === 'done'
      ? 'success'
      : state.status === 'error'
        ? 'error'
        : 'info'

  const label =
    state.status === 'deploying'
      ? state.message || 'Deploying...'
      : state.status === 'done'
        ? 'Done'
        : 'Failed'

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-2">
        <Badge variant={variant} pulse={state.status === 'deploying'}>
          {label}
        </Badge>
      </div>
      {state.status === 'deploying' && (
        <div className="h-1 w-24 bg-surface rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-primary"
            animate={{ width: `${state.progress}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Server row ───────────────────────────────────────────────────────────────

interface ServerRowProps {
  server: DiscoveredServer
  profiles: Profile[]
  selectedProfile: string
  onProfileChange: (profileName: string) => void
  onDeploy: () => void
  deployState: RowDeployState
  index: number
}

function ServerRow({
  server,
  profiles,
  selectedProfile,
  onProfileChange,
  onDeploy,
  deployState,
  index,
}: ServerRowProps) {
  const isDeploying = deployState.status === 'deploying'

  return (
    <motion.tr
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut', delay: index * 0.06 }}
      className="border-b border-border/60 last:border-0 hover:bg-surface/40 transition-colors duration-100"
    >
      {/* IP Address */}
      <td className="px-4 py-3">
        <span className="font-mono text-sm text-text">{server.IPAddress}</span>
      </td>

      {/* Hostname */}
      <td className="px-4 py-3">
        <span className="text-sm text-textSecondary">
          {server.Hostname || <span className="text-textMuted italic">unknown</span>}
        </span>
      </td>

      {/* Type */}
      <td className="px-4 py-3">
        {server.IsDisguise ? (
          <Badge variant="success">disguise</Badge>
        ) : (
          <Badge variant="neutral">other</Badge>
        )}
      </td>

      {/* Response time */}
      <td className="px-4 py-3">
        <span className="text-sm text-textSecondary font-mono">
          {server.ResponseTimeMs}
          <span className="text-textMuted ml-0.5 font-sans">ms</span>
        </span>
      </td>

      {/* Profile dropdown */}
      <td className="px-4 py-3">
        <Select
          value={selectedProfile}
          onChange={onProfileChange}
          options={
            profiles.length === 0
              ? [{ label: 'No profiles', value: '' }]
              : profiles.map((p) => ({ label: p.Name, value: p.Name }))
          }
          disabled={profiles.length === 0 || isDeploying}
          aria-label={`Profile for ${server.IPAddress}`}
          className="w-44"
        />
      </td>

      {/* Deploy status + button */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <AnimatePresence>
            {deployState.status !== 'idle' && (
              <motion.div
                key="status"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.2 }}
              >
                <DeployStatusPill state={deployState} />
              </motion.div>
            )}
          </AnimatePresence>
          <Button
            variant={deployState.status === 'done' ? 'ghost' : 'primary'}
            size="sm"
            onClick={onDeploy}
            disabled={!selectedProfile || isDeploying || profiles.length === 0}
            loading={isDeploying}
          >
            <Send size={12} className="shrink-0" />
            {deployState.status === 'done' ? 'Re-deploy' : 'Deploy'}
          </Button>
        </div>
      </td>
    </motion.tr>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  // NICs
  const [nics, setNics] = useState<NetworkInterface[]>([])
  const [selectedNic, setSelectedNic] = useState('')
  const [nicsLoading, setNicsLoading] = useState(true)

  // Profiles
  const [profiles, setProfiles] = useState<Profile[]>([])

  // Per-row profile selections: ip → profileName
  const [rowProfiles, setRowProfiles] = useState<Record<string, string>>({})

  // Scan state
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [servers, setServers] = useState<DiscoveredServer[]>([])
  const [hasScanned, setHasScanned] = useState(false)

  // Credentials
  const [credUser, setCredUser] = useState('d3')
  const [credPass, setCredPass] = useState('disguise')

  // Per-row deploy states: ip → RowDeployState
  const [deployStates, setDeployStates] = useState<Record<string, RowDeployState>>({})

  // Setup instructions panel
  const [showSetup, setShowSetup] = useState(false)
  const [setupScript, setSetupScript] = useState('')

  // Refs to keep EventSource handles so we can close them on unmount
  const scanEsRef = useRef<EventSource | null>(null)
  const deployEsRefs = useRef<Record<string, EventSource>>({})

  // Derived
  const selectedNicObj = nics.find((n) => n.name === selectedNic) ?? null
  const subnet = selectedNicObj ? deriveSubnet(selectedNicObj.address) : ''

  // ── Load NICs and profiles on mount ────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      api.getNics(),
      api.getProfiles(),
    ])
      .then(([nicList, profileList]) => {
        setNics(nicList)
        if (nicList.length > 0) setSelectedNic(nicList[0].name)
        setProfiles(profileList)
      })
      .catch(() => toast.error('Failed to load network interfaces'))
      .finally(() => setNicsLoading(false))

    api.getSetupScript().then(data => setSetupScript(data.oneLiner)).catch(() => {})

    return () => {
      scanEsRef.current?.close()
      Object.values(deployEsRefs.current).forEach((es) => es.close())
    }
  }, [])

  // ── Sync rowProfiles when new servers are discovered ───────────────────────

  const defaultProfile = profiles[0]?.Name ?? ''

  const addServerToState = useCallback(
    (server: DiscoveredServer) => {
      setServers((prev) => {
        if (prev.some((s) => s.IPAddress === server.IPAddress)) return prev
        return [...prev, server]
      })
      setRowProfiles((prev) => ({
        ...prev,
        [server.IPAddress]: prev[server.IPAddress] ?? defaultProfile,
      }))
      setDeployStates((prev) => ({
        ...prev,
        [server.IPAddress]: prev[server.IPAddress] ?? { status: 'idle', progress: 0, message: '' },
      }))
    },
    [defaultProfile],
  )

  // ── Scan ───────────────────────────────────────────────────────────────────

  const startScan = useCallback(() => {
    if (!subnet || scanning) return

    // Close any existing scan stream
    scanEsRef.current?.close()

    setScanning(true)
    setScanProgress(0)
    setServers([])
    setHasScanned(false)
    setRowProfiles({})
    setDeployStates({})

    const es = api.scanNetwork(subnet, 1, 254)
    scanEsRef.current = es

    es.addEventListener('progress', (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { percent?: number }
      if (typeof data.percent === 'number') setScanProgress(data.percent)
    })

    es.addEventListener('discovered', (e: MessageEvent) => {
      const server = JSON.parse(e.data) as DiscoveredServer
      addServerToState(server)
    })

    es.addEventListener('complete', () => {
      es.close()
      scanEsRef.current = null
      setScanning(false)
      setHasScanned(true)
      setScanProgress(100)
      toast.success(`Scan complete`)
    })

    es.onerror = () => {
      es.close()
      scanEsRef.current = null
      setScanning(false)
      setHasScanned(true)
      toast.error('Scan failed')
    }
  }, [subnet, scanning, addServerToState])

  // ── Per-row deploy ─────────────────────────────────────────────────────────

  const deployToServer = useCallback(
    (server: DiscoveredServer) => {
      const profileName = rowProfiles[server.IPAddress] ?? defaultProfile
      if (!profileName) return

      // Close any existing stream for this IP
      deployEsRefs.current[server.IPAddress]?.close()

      setDeployStates((prev) => ({
        ...prev,
        [server.IPAddress]: { status: 'deploying', progress: 0, message: 'Starting...' },
      }))

      const es = api.deployProfile(server.IPAddress, profileName, credUser, credPass)
      deployEsRefs.current[server.IPAddress] = es

      es.addEventListener('progress', (e: MessageEvent) => {
        const data = JSON.parse(e.data) as {
          stepNumber?: number
          total?: number
          message?: string
        }
        const pct =
          data.stepNumber != null && data.total
            ? Math.round((data.stepNumber / data.total) * 100)
            : 0
        setDeployStates((prev) => ({
          ...prev,
          [server.IPAddress]: {
            status: 'deploying',
            progress: pct,
            message: data.message ?? '',
          },
        }))
      })

      es.addEventListener('complete', () => {
        es.close()
        delete deployEsRefs.current[server.IPAddress]
        setDeployStates((prev) => ({
          ...prev,
          [server.IPAddress]: { status: 'done', progress: 100, message: 'Done' },
        }))
        toast.success(`Deployed to ${server.Hostname || server.IPAddress}`)
      })

      es.addEventListener('error', (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { message?: string }
        es.close()
        delete deployEsRefs.current[server.IPAddress]
        setDeployStates((prev) => ({
          ...prev,
          [server.IPAddress]: {
            status: 'error',
            progress: prev[server.IPAddress]?.progress ?? 0,
            message: data.message ?? 'Failed',
          },
        }))
        toast.error(
          `Deploy failed for ${server.Hostname || server.IPAddress}${data.message ? `: ${data.message}` : ''}`,
        )
      })

      es.onerror = () => {
        es.close()
        delete deployEsRefs.current[server.IPAddress]
        setDeployStates((prev) => ({
          ...prev,
          [server.IPAddress]: {
            status: 'error',
            progress: prev[server.IPAddress]?.progress ?? 0,
            message: 'Failed',
          },
        }))
        toast.error(`Deploy failed for ${server.Hostname || server.IPAddress}`)
      }
    },
    [rowProfiles, defaultProfile, credUser, credPass],
  )

  // ── Mass deploy ─────────────────────────────────────────────────────────────

  const deployAllServers = useCallback(() => {
    servers.forEach((server) => {
      const profileName = rowProfiles[server.IPAddress] ?? defaultProfile
      if (!profileName) return
      deployToServer(server)
    })
  }, [servers, rowProfiles, defaultProfile, deployToServer])

  // ── Render ─────────────────────────────────────────────────────────────────

  const nicOptions = nicsLoading
    ? [{ label: 'Loading...', value: '' }]
    : nics.length === 0
      ? [{ label: 'No interfaces found', value: '' }]
      : nics.map((n) => ({
          label: `${n.name} — ${n.address}`,
          value: n.name,
        }))

  const disguiseCount = servers.filter((s) => s.IsDisguise).length

  const anyDeploying = Object.values(deployStates).some((s) => s.status === 'deploying')

  const deployableCount = servers.filter((server) => {
    const profileName = rowProfiles[server.IPAddress] ?? defaultProfile
    return !!profileName
  }).length

  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="Dashboard"
        subtitle="Scan your network and deploy profiles to discovered servers"
      />

      {/* ── Toolbar ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <GlassCard>
          <div className="flex flex-wrap items-end gap-4">
            {/* NIC selector */}
            <div className="flex flex-col gap-1.5 flex-1 min-w-56">
              <label className="text-xs font-semibold text-textSecondary uppercase tracking-wider flex items-center gap-1.5">
                <Wifi size={12} aria-hidden="true" />
                Network Interface
              </label>
              <Select
                value={selectedNic}
                onChange={setSelectedNic}
                options={nicOptions}
                disabled={nicsLoading || scanning}
                aria-label="Select network interface"
              />
            </div>

            {/* Subnet preview */}
            {subnet && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-textSecondary uppercase tracking-wider">
                  Subnet
                </span>
                <span className="font-mono text-sm text-textSecondary px-3 py-2 rounded-lg bg-surface border border-border">
                  {subnet}.1–254
                </span>
              </div>
            )}

            {/* Scan button */}
            <Button
              variant="primary"
              onClick={startScan}
              disabled={!subnet || scanning || nicsLoading}
              loading={scanning}
              className="self-end"
            >
              <Radio size={14} className="shrink-0" />
              {scanning ? 'Scanning...' : 'Scan Network'}
            </Button>
          </div>

          {/* Credentials row */}
          <div className="flex flex-wrap items-end gap-4 pt-3 border-t border-border/50">
            <div className="flex flex-col gap-1.5 flex-1 min-w-40">
              <label className="text-xs font-semibold text-textSecondary uppercase tracking-wider">
                Username
              </label>
              <input
                type="text"
                value={credUser}
                onChange={(e) => setCredUser(e.target.value)}
                placeholder="Administrator"
                className="w-full px-3 py-2 rounded-lg text-sm bg-surface border border-border text-text outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors duration-150"
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-w-40">
              <label className="text-xs font-semibold text-textSecondary uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                value={credPass}
                onChange={(e) => setCredPass(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 rounded-lg text-sm bg-surface border border-border text-text outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors duration-150"
              />
            </div>
          </div>

          {/* Scan progress bar */}
          <AnimatePresence>
            {scanning && (
              <motion.div
                key="scan-progress"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden mt-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      animate={{ width: `${scanProgress}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                  <span className="text-xs text-textMuted font-mono shrink-0 w-10 text-right">
                    {scanProgress}%
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>
      </motion.div>

      {/* ── Setup instructions ── */}
      <div>
        <button
          type="button"
          onClick={() => setShowSetup(v => !v)}
          className="text-xs text-textMuted hover:text-textSecondary transition-colors duration-150 flex items-center gap-1.5"
        >
          <ChevronDown size={12} className={`transition-transform ${showSetup ? 'rotate-180' : ''}`} />
          {showSetup ? 'Hide' : 'Show'} server setup instructions
        </button>

        <AnimatePresence>
          {showSetup && (
            <motion.div
              key="setup-panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <GlassCard className="mt-3">
                <p className="text-sm text-textSecondary mb-3">
                  If deployment fails with "WinRM and DCOM both unavailable", run this command once on each target server in an <strong>Administrator PowerShell</strong>:
                </p>
                <div className="relative">
                  <pre className="text-xs font-mono bg-black/30 text-green-400 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
                    {setupScript || 'Loading...'}
                  </pre>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(setupScript)
                      toast.success('Copied to clipboard')
                    }}
                    className="absolute top-2 right-2 px-2 py-1 text-xs bg-surface/80 text-textSecondary rounded border border-border hover:bg-surface transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-xs text-textMuted mt-2">
                  This only needs to be run once per server. After that, remote deployment will work automatically.
                </p>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Results table ── */}
      <AnimatePresence>
        {(hasScanned || servers.length > 0) && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <GlassCard>
              {/* Table header */}
              <div className="flex items-center justify-between gap-4 mb-4 pb-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <h3 className="text-text font-bold text-sm tracking-wide">Discovered Servers</h3>
                  <div className="flex items-center gap-2">
                    <Badge variant={servers.length > 0 ? 'info' : 'neutral'}>
                      {servers.length} found
                    </Badge>
                    {disguiseCount > 0 && (
                      <Badge variant="success">{disguiseCount} disguise</Badge>
                    )}
                  </div>
                </div>

                {/* Re-scan shortcut + Deploy All */}
                <div className="flex items-center gap-2">
                  {hasScanned && !scanning && (
                    <Button variant="ghost" size="sm" onClick={startScan} disabled={!subnet}>
                      <RefreshCw size={13} />
                      Re-scan
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={deployAllServers}
                    disabled={
                      servers.length === 0 ||
                      profiles.length === 0 ||
                      anyDeploying ||
                      deployableCount === 0
                    }
                    loading={anyDeploying}
                  >
                    <Send size={13} className="shrink-0" />
                    Deploy All ({deployableCount})
                  </Button>
                </div>
              </div>

              {/* Empty state */}
              {servers.length === 0 && hasScanned && !scanning && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Monitor size={32} className="text-textMuted" aria-hidden="true" />
                  <p className="text-textMuted text-sm">No servers found on {subnet}.0/24</p>
                  <p className="text-textMuted/60 text-xs">
                    Check your network interface selection and try again
                  </p>
                </div>
              )}

              {/* Table */}
              {servers.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border">
                        {[
                          'IP Address',
                          'Hostname',
                          'Type',
                          'Response',
                          'Profile',
                          'Action',
                        ].map((col) => (
                          <th
                            key={col}
                            className="px-4 py-2.5 text-xs font-semibold text-textMuted uppercase tracking-wider whitespace-nowrap"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {servers.map((server, i) => (
                        <ServerRow
                          key={server.IPAddress}
                          server={server}
                          profiles={profiles}
                          selectedProfile={rowProfiles[server.IPAddress] ?? defaultProfile}
                          onProfileChange={(name) =>
                            setRowProfiles((prev) => ({ ...prev, [server.IPAddress]: name }))
                          }
                          onDeploy={() => deployToServer(server)}
                          deployState={
                            deployStates[server.IPAddress] ?? {
                              status: 'idle',
                              progress: 0,
                              message: '',
                            }
                          }
                          index={i}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
