import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Zap, RefreshCw, Play, Pause } from 'lucide-react'
import { useTelemetry } from '@/hooks/useTelemetry'
import { CHART_COLORS } from '@/lib/metric-definitions'
import type { TimeRange } from '@/lib/telemetry-types'
import { FleetVoltageSummary } from '@/components/power/FleetVoltageSummary'
import { VoltageComparisonChart } from '@/components/power/VoltageComparisonChart'
import { ServerVoltageCard } from '@/components/power/ServerVoltageCard'
import { VfcCard } from '@/components/power/VfcCard'
import { api } from '@/lib/api'
import { sortServers } from '@/lib/server-sort'

type TabId = 'overview' | 'voltages' | 'vfcs'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'voltages', label: 'Voltage Detail' },
  { id: 'vfcs', label: 'VFC Cards' },
]

export function PowerVfcPage() {
  const [timeRange] = useState<TimeRange>('15m')
  const [liveMode, setLiveMode] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  const { latestSnapshot, loading } = useTelemetry({ timeRange, liveMode })

  // Extract server data from latest snapshot
  const servers = useMemo(() => {
    if (!latestSnapshot) return []
    return sortServers(latestSnapshot.servers
      .filter(s => s.status !== 'offline'))
      .map((s, i) => ({
        hostname: s.hostname || s.mgmtIp,
        mgmtIp: s.mgmtIp,
        status: s.status,
        role: s.role || '',
        serial: s.serial || '',
        type: s.type || '',
        powerStatus: s.powerStatus || '',
        voltages: (s.voltages || []).map(v => ({
          label: v.label,
          value: v.value,
          nominal: v.nominal,
        })),
        vfcs: (s.vfcs || []).map(v => ({
          slot: v.slot,
          type: v.type,
          status: v.status,
        })),
        ledColor: s.ledColor || { r: 0, g: 0, b: 0 },
        ledMode: s.ledMode || '',
        smcFirmware: s.smcFirmware || '',
        smcPlatform: s.smcPlatform || '',
        color: CHART_COLORS[i % CHART_COLORS.length],
      }))
  }, [latestSnapshot])

  const handleSnapshot = async () => {
    try { await api.triggerSnapshot() } catch (err) { console.error('[PowerVfc] Snapshot failed:', err) }
  }

  return (
    <div className="min-h-screen p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
          <Zap size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-text">Power & VFC</h1>
          <p className="text-[12px] text-textMuted">
            Voltage rail monitoring and Video Format Converter status across the fleet
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Live toggle */}
        <button
          type="button"
          onClick={() => setLiveMode(!liveMode)}
          aria-label={liveMode ? 'Pause live updates' : 'Enable live updates'}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
            liveMode
              ? 'bg-success/15 text-success border-success/30'
              : 'text-textMuted hover:text-text bg-surface border-border'
          }`}
        >
          {liveMode ? <Pause size={12} /> : <Play size={12} />}
          <span>{liveMode ? 'Live' : 'Paused'}</span>
          {liveMode && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />}
        </button>

        {/* Snapshot */}
        <button
          type="button"
          onClick={handleSnapshot}
          aria-label="Refresh power data"
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-textMuted hover:text-text bg-surface rounded-lg border border-border transition-colors"
        >
          <RefreshCw size={12} />
          <span>Refresh</span>
        </button>

        {/* Server count */}
        <span className="text-[11px] text-textMuted px-2 py-0.5 bg-surface rounded-full border border-border font-mono">
          {servers.length} servers
        </span>

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-surface rounded-lg border border-border p-1 ml-auto">
          {TABS.map(tab => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-label={`${tab.label} tab`}
              aria-selected={activeTab === tab.id}
              role="tab"
              className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary text-white'
                  : 'text-textMuted hover:text-text hover:bg-hover'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={20} className="animate-spin text-primary" />
          <span className="ml-2 text-sm text-textMuted">Loading power data...</span>
        </div>
      )}

      {/* Overview tab */}
      {!loading && activeTab === 'overview' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          <FleetVoltageSummary servers={servers} loading={false} />
          <VoltageComparisonChart servers={servers.map(s => ({ ...s, color: s.color }))} />

          {/* VFC grid */}
          <div>
            <h2 className="text-sm font-bold text-text mb-3 flex items-center gap-2">
              <span>VFC Status</span>
              <span className="text-[10px] text-textMuted font-normal">across fleet</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {servers.map(s => (
                <VfcCard
                  key={s.mgmtIp}
                  hostname={s.hostname}
                  mgmtIp={s.mgmtIp}
                  vfcs={s.vfcs}
                  color={s.color}
                  role={s.role}
                  ledColor={s.ledColor}
                />
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Voltage detail tab */}
      {!loading && activeTab === 'voltages' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-4"
        >
          {servers.map(s => (
            <ServerVoltageCard
              key={s.mgmtIp}
              hostname={s.hostname}
              mgmtIp={s.mgmtIp}
              voltages={s.voltages}
              color={s.color}
              status={s.status}
            />
          ))}
          {servers.length === 0 && (
            <div className="text-center py-12 text-textMuted col-span-full">
              <Zap size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No voltage data yet. Waiting for telemetry snapshots...</p>
            </div>
          )}
        </motion.div>
      )}

      {/* VFC tab */}
      {!loading && activeTab === 'vfcs' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {servers.map(s => (
            <VfcCard
              key={s.mgmtIp}
              hostname={s.hostname}
              mgmtIp={s.mgmtIp}
              vfcs={s.vfcs}
              color={s.color}
              role={s.role}
              ledColor={s.ledColor}
            />
          ))}
          {servers.length === 0 && (
            <div className="text-center py-12 text-textMuted col-span-full">
              <Zap size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No VFC data yet. Waiting for telemetry snapshots...</p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
