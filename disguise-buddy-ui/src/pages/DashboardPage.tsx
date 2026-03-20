import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Radio, Pause, Play } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { useTelemetry } from '@/hooks/useTelemetry'
import type { TimeRange } from '@/lib/telemetry-types'
import { SectionHeader, Button, Badge } from '@/components/ui'
import { FleetSummary } from '@/components/dashboard/FleetSummary'
import { ServerHealthGrid } from '@/components/dashboard/ServerHealthGrid'
import { RecentActivity } from '@/components/dashboard/RecentActivity'
import { TemperatureOverview } from '@/components/dashboard/TemperatureOverview'

// Default MGMT IPs for the 7 GX3+ servers
const DEFAULT_IPS = Array.from({ length: 7 }, (_, i) => `192.168.100.${200 + i}`)

export function DashboardPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('15m')
  const [liveMode, setLiveMode] = useState(true)
  const [profileCount, setProfileCount] = useState(0)

  const { snapshots, latestSnapshot, loading } = useTelemetry({ timeRange, liveMode })

  // Load profile count + push default servers on mount
  useEffect(() => {
    api.getProfiles().then(p => setProfileCount(p.length)).catch(() => {})
    api.setTelemetryServers(DEFAULT_IPS).catch(() => {})
  }, [])

  // Extract latest server states
  const servers = latestSnapshot?.servers ?? []

  // Manual refresh
  const handleRefresh = useCallback(() => {
    api.triggerSnapshot()
      .then(() => toast.success('Snapshot taken'))
      .catch(() => toast.error('Failed to take snapshot'))
  }, [])

  // Listen for F5 app-refresh event
  useEffect(() => {
    const handler = () => handleRefresh()
    window.addEventListener('app-refresh', handler)
    return () => window.removeEventListener('app-refresh', handler)
  }, [handleRefresh])

  const timeRanges: { label: string; value: TimeRange }[] = [
    { label: '5m', value: '5m' },
    { label: '15m', value: '15m' },
    { label: '1h', value: '1h' },
    { label: '6h', value: '6h' },
    { label: '24h', value: '24h' },
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
      <ServerHealthGrid servers={servers} loading={loading} />

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
