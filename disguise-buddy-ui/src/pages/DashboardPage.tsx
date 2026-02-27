import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, Network, Server, Send, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import type { DashboardData, DiscoveredServer, Profile } from '@/lib/types'
import {
  GlassCard,
  SectionHeader,
  Badge,
  Button,
} from '@/components/ui'
import { ServerTile } from '@/components/deploy/ServerTile'

// -- Props --------------------------------------------------------------------

interface DashboardPageProps {
  onViewChange: (view: string) => void
}

// -- Deploy progress per-server -----------------------------------------------

interface ServerDeployState {
  status: 'pending' | 'deploying' | 'done' | 'error'
  progress: number
  message: string
}

// -- Inline select (matches project design language) --------------------------

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

// -- Deploy progress bar ------------------------------------------------------

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

// -- Skeleton -----------------------------------------------------------------

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
    <div className="flex flex-col gap-6" aria-label="Loading dashboard..." aria-busy="true">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass-card p-5 flex flex-col gap-3">
            <SkeletonBlock className="w-8 h-8" />
            <SkeletonBlock className="w-16 h-7" />
            <SkeletonBlock className="w-24 h-3.5" />
          </div>
        ))}
      </div>
      {/* Server grid */}
      <div className="glass-card p-5 flex flex-col gap-3">
        <SkeletonBlock className="w-40 h-5 mb-2" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonBlock key={i} className="w-full h-36" />
          ))}
        </div>
      </div>
    </div>
  )
}

// -- Stat card ----------------------------------------------------------------

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
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${accent}22` }}
            aria-hidden="true"
          >
            <span style={{ color: accent }}>{icon}</span>
          </div>
          <p
            className="text-2xl font-bold text-text leading-none tracking-tight truncate"
            title={value}
          >
            {value}
          </p>
          <p className="text-xs text-textMuted font-medium uppercase tracking-wider">
            {label}
          </p>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// -- Page ---------------------------------------------------------------------

export function DashboardPage({ onViewChange }: DashboardPageProps) {
  // -- Dashboard stats
  const [dashData, setDashData] = useState<DashboardData | null>(null)

  // -- Server fleet
  const [servers, setServers] = useState<DiscoveredServer[]>([])
  const [selectedIPs, setSelectedIPs] = useState<Set<string>>(new Set())

  // -- Profiles
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [profilesLoading, setProfilesLoading] = useState(true)

  // -- Deploy
  const [deploying, setDeploying] = useState(false)
  const [deployStates, setDeployStates] = useState<Record<string, ServerDeployState>>({})

  // -- Loading
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Ref for deploy completion tracking
  const completedRef = useRef(0)

  // -- Load all data on mount
  useEffect(() => {
    Promise.all([
      api.getDashboard(),
      api.getDiscovery(),
      api.getProfiles(),
    ])
      .then(([dash, disc, profs]) => {
        setDashData(dash)
        setServers(disc)
        setProfiles(profs)
        if (profs.length > 0) setSelectedProfile(profs[0].Name)
      })
      .catch(() => toast.error('Failed to load dashboard data'))
      .finally(() => {
        setLoading(false)
        setProfilesLoading(false)
      })
  }, [])

  // -- Refresh fleet
  const refreshFleet = useCallback(() => {
    setRefreshing(true)
    Promise.all([api.getDashboard(), api.getDiscovery()])
      .then(([dash, disc]) => {
        setDashData(dash)
        setServers(disc)
        toast.success(`Fleet refreshed: ${disc.length} servers`)
      })
      .catch(() => toast.error('Failed to refresh'))
      .finally(() => setRefreshing(false))
  }, [])

  // -- Server selection
  const toggleServer = useCallback((ip: string) => {
    setSelectedIPs((prev) => {
      const next = new Set(prev)
      if (next.has(ip)) next.delete(ip)
      else next.add(ip)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    if (selectedIPs.size === servers.length) {
      setSelectedIPs(new Set())
    } else {
      setSelectedIPs(new Set(servers.map((s) => s.IPAddress)))
    }
  }, [selectedIPs.size, servers])

  // -- Deploy
  const startDeploy = useCallback(() => {
    if (selectedIPs.size === 0 || !selectedProfile) return

    const targets = servers.filter((s) => selectedIPs.has(s.IPAddress))
    const initialStates: Record<string, ServerDeployState> = {}
    for (const s of targets) {
      initialStates[s.IPAddress] = { status: 'pending', progress: 0, message: '' }
    }
    setDeployStates(initialStates)
    setDeploying(true)
    completedRef.current = 0

    const total = targets.length

    for (const server of targets) {
      setDeployStates((prev) => ({
        ...prev,
        [server.IPAddress]: { status: 'deploying', progress: 0, message: 'Starting...' },
      }))

      const es = api.deployProfile(server.IPAddress, selectedProfile)

      es.addEventListener('progress', (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { stepNumber?: number; total?: number; message?: string }
        const pct = data.stepNumber && data.total ? Math.round((data.stepNumber / data.total) * 100) : 0
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
        setDeployStates((prev) => ({
          ...prev,
          [server.IPAddress]: { status: 'done', progress: 100, message: 'Done' },
        }))
        toast.success(`Deployed to ${server.Hostname || server.IPAddress}`)
        completedRef.current++
        if (completedRef.current === total) setDeploying(false)
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
        completedRef.current++
        if (completedRef.current === total) setDeploying(false)
      }
    }
  }, [selectedIPs, selectedProfile, servers])

  // -- Derived
  const selectedServers = servers.filter((s) => selectedIPs.has(s.IPAddress))
  const canDeploy = selectedIPs.size > 0 && !!selectedProfile && !deploying
  const hasDeployProgress = Object.keys(deployStates).length > 0

  return (
    <div className="p-6 flex flex-col gap-6">
      <SectionHeader
        title="Dashboard"
        subtitle="Fleet overview and profile deployment"
      />

      {loading || dashData === null ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* -- Stat cards row -- */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              icon={<Users size={18} />}
              value={dashData.activeProfile}
              label="Active Profile"
              accent="#7C3AED"
              index={0}
            />
            <StatCard
              icon={<Network size={18} />}
              value={dashData.adapterCount}
              label="Network Adapters"
              accent="#10B981"
              index={1}
            />
            <StatCard
              icon={<Server size={18} />}
              value={`${servers.length} Server${servers.length !== 1 ? 's' : ''}`}
              label="Fleet Size"
              accent="#3B82F6"
              index={2}
            />
          </div>

          {/* -- Server Fleet -- */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut', delay: 0.35 }}
          >
            <GlassCard>
              {/* Card header */}
              <div className="flex items-center justify-between gap-4 mb-5 pb-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <h3 className="text-text font-bold text-sm tracking-wide">
                    Media Servers
                  </h3>
                  <Badge variant={servers.length > 0 ? 'info' : 'neutral'}>
                    {servers.length}
                  </Badge>
                </div>

                <div className="flex items-center gap-3">
                  {servers.length > 0 && (
                    <button
                      type="button"
                      onClick={selectAll}
                      className="text-xs text-textMuted hover:text-textSecondary transition-colors duration-150 cursor-pointer select-none"
                    >
                      {selectedIPs.size === servers.length ? 'Deselect all' : 'Select all'}
                    </button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={refreshFleet}
                    disabled={refreshing}
                    loading={refreshing}
                  >
                    <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                    Refresh
                  </Button>
                </div>
              </div>

              {/* Empty state */}
              {servers.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Server size={32} className="text-textMuted" aria-hidden="true" />
                  <p className="text-textMuted text-sm">No servers discovered</p>
                  <p className="text-textMuted/60 text-xs">
                    Check your network configuration or run a network scan
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => onViewChange('deploy')}
                    className="mt-2"
                  >
                    Go to Network Scan
                  </Button>
                </div>
              )}

              {/* Server grid */}
              {servers.length > 0 && (
                <div
                  className="grid grid-cols-3 gap-3"
                  role="group"
                  aria-label="Media servers"
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

              {/* -- Deploy section -- */}
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
                            ? [{ label: 'Loading...', value: '' }]
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
                      {deploying ? 'Deploying...' : 'Deploy to Selected'}
                    </Button>
                  </div>

                  {/* Per-server deploy progress */}
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
        </>
      )}
    </div>
  )
}
