import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, Radio, Pause, Play, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { useTelemetry } from '@/hooks/useTelemetry'
import type { TimeRange } from '@/lib/telemetry-types'
import { SectionHeader, Button, Badge } from '@/components/ui'
import { FleetSummary } from '@/components/dashboard/FleetSummary'
import { DashboardFleetGrid } from '@/components/dashboard/DashboardFleetGrid'
import { RecentActivity } from '@/components/dashboard/RecentActivity'
import { TemperatureOverview } from '@/components/dashboard/TemperatureOverview'
import { sortServers } from '@/lib/server-sort'

export function DashboardPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('15m')
  const [liveMode, setLiveMode] = useState(true)
  const [profileCount, setProfileCount] = useState(0)
  const [discovering, setDiscovering] = useState(false)

  const { snapshots, latestSnapshot, loading } = useTelemetry({ timeRange, liveMode })

  // Load profile count on mount (servers are auto-discovered by the backend)
  useEffect(() => {
    api.getProfiles().then(p => setProfileCount(p.length)).catch(err => console.warn('[Dashboard]', err))
  }, [])

  // Extract latest server states — sorted: Director → Actor → Understudy
  const servers = useMemo(
    () => sortServers(latestSnapshot?.servers ?? []),
    [latestSnapshot],
  )

  // Manual refresh
  const handleRefresh = useCallback(() => {
    api.triggerSnapshot()
      .then(() => toast.success('Snapshot taken'))
      .catch(() => toast.error('Failed to take snapshot'))
  }, [])

  // Re-discover servers on the MGMT network
  const handleDiscover = useCallback(() => {
    setDiscovering(true)
    api.triggerDiscovery()
      .then(r => toast.success(`Found ${r.servers.length} servers`))
      .catch(() => toast.error('Discovery failed'))
      .finally(() => setDiscovering(false))
  }, [])

  // Listen for F5 app-refresh event
  useEffect(() => {
    const handler = () => handleRefresh()
    window.addEventListener('app-refresh', handler)
    return () => window.removeEventListener('app-refresh', handler)
  }, [handleRefresh])

  const timeRanges: { label: string; value: TimeRange }[] = [
    { label: '30s', value: '30s' },
    { label: '1m', value: '1m' },
    { label: '5m', value: '5m' },
    { label: '15m', value: '15m' },
    { label: '1h', value: '1h' },
  ]

  const lastUpdated = latestSnapshot
    ? new Date(latestSnapshot.timestamp).toLocaleTimeString()
    : '—'

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <SectionHeader
        title="Dashboard"
        subtitle="Real-time fleet health and telemetry from disguise servers"
        action={
          <div className="flex items-center gap-2">
            {/* Live indicator */}
            {liveMode && (
              <Badge variant="success" pulse>
                <Radio size={10} className="mr-1" />
                Live
              </Badge>
            )}

            {/* Last updated */}
            <span className="text-xs text-textMuted font-mono">
              {lastUpdated}
            </span>

            {/* Time range selector */}
            <div className="flex items-center bg-surface rounded-lg border border-border overflow-hidden">
              {timeRanges.map(tr => (
                <button
                  key={tr.value}
                  onClick={() => setTimeRange(tr.value)}
                  className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    timeRange === tr.value
                      ? 'bg-primary text-white'
                      : 'text-textMuted hover:text-textSecondary hover:bg-hover'
                  }`}
                >
                  {tr.label}
                </button>
              ))}
            </div>

            {/* Live toggle */}
            <Button
              variant={liveMode ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setLiveMode(prev => !prev)}
            >
              {liveMode ? <Pause size={13} /> : <Play size={13} />}
              {liveMode ? 'Pause' : 'Live'}
            </Button>

            {/* Re-discover servers */}
            <Button variant="ghost" size="sm" onClick={handleDiscover} disabled={discovering}>
              <Search size={13} className={discovering ? 'animate-pulse' : ''} />
              {discovering ? 'Scanning...' : 'Discover'}
            </Button>

            {/* Manual refresh */}
            <Button variant="ghost" size="sm" onClick={handleRefresh}>
              <RefreshCw size={13} />
            </Button>
          </div>
        }
      />

      {/* Fleet summary stats */}
      <FleetSummary
        servers={servers}
        profileCount={profileCount}
        loading={loading}
      />

      {/* Server health grid */}
      <DashboardFleetGrid servers={servers} loading={loading} />

      {/* Bottom row: temperature chart + activity feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <TemperatureOverview snapshots={snapshots} loading={loading} />
        </div>
        <div className="lg:col-span-1">
          <RecentActivity snapshots={snapshots} maxItems={15} />
        </div>
      </div>
    </div>
  )
}
