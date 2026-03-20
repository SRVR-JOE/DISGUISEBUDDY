import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3,
  LayoutGrid,
  Grid3x3,
  AlertTriangle,
  Play,
  Pause,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useTelemetry } from '@/hooks/useTelemetry'
import { CHART_COLORS } from '@/lib/metric-definitions'
import type { TimeRange, MetricSeries } from '@/lib/telemetry-types'

import { TimeRangeSelector } from '@/components/telemetry/TimeRangeSelector'
import { TimeSeriesChart } from '@/components/telemetry/TimeSeriesChart'
import { ServerSparklineCard } from '@/components/telemetry/ServerSparklineCard'
import { HeatmapGrid } from '@/components/telemetry/HeatmapGrid'
import { AnomalyTimeline } from '@/components/telemetry/AnomalyTimeline'

// ─── Types ──────────────────────────────────────────────────────────────────

type TabId = 'charts' | 'sparklines' | 'heatmap' | 'anomalies'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'charts', label: 'Charts', icon: <TrendingUp size={14} /> },
  { id: 'sparklines', label: 'Sparklines', icon: <LayoutGrid size={14} /> },
  { id: 'heatmap', label: 'Heatmap', icon: <Grid3x3 size={14} /> },
  { id: 'anomalies', label: 'Anomalies', icon: <AlertTriangle size={14} /> },
]

// Default 7 GX3+ MGMT IPs
const DEFAULT_IPS = Array.from({ length: 7 }, (_, i) => `192.168.100.${200 + i}`)

// ─── Component ──────────────────────────────────────────────────────────────

export function TelemetryPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('15m')
  const [liveMode, setLiveMode] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('charts')
  const [selectedServers, setSelectedServers] = useState<string[]>(DEFAULT_IPS)
  const [compareMode, setCompareMode] = useState(true)

  const { series, anomalies, snapshots, loading } = useTelemetry({ timeRange, liveMode })

  // Push default servers to backend on mount
  useEffect(() => {
    api.setTelemetryServers(DEFAULT_IPS).catch(console.error)
  }, [])

  // Known servers from snapshots
  const knownServers = useMemo(() => {
    const map = new Map<string, string>()
    for (const snap of snapshots) {
      for (const srv of snap.servers) {
        if (!map.has(srv.mgmtIp)) {
          map.set(srv.mgmtIp, srv.hostname || srv.mgmtIp)
        }
      }
    }
    // Also include default IPs that haven't responded yet
    for (const ip of DEFAULT_IPS) {
      if (!map.has(ip)) map.set(ip, ip)
    }
    return map
  }, [snapshots])

  const toggleServer = useCallback((ip: string) => {
    setSelectedServers(prev =>
      prev.includes(ip) ? prev.filter(s => s !== ip) : [...prev, ip]
    )
  }, [])

  const toggleAll = useCallback(() => {
    const allIps = Array.from(knownServers.keys())
    setSelectedServers(prev =>
      prev.length === allIps.length ? [] : allIps
    )
  }, [knownServers])

  // Filter series by selected servers
  const filteredSeries = useMemo(
    () => series.filter(s => selectedServers.includes(s.serverId)),
    [series, selectedServers]
  )

  // Group series by category (metricKey = temperature | voltage | fan)
  const seriesByCategory = useMemo(() => {
    const groups: Record<string, MetricSeries[]> = {}
    for (const s of filteredSeries) {
      const cat = s.metricKey
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(s)
    }
    return groups
  }, [filteredSeries])

  // Filter anomalies
  const filteredAnomalies = useMemo(
    () => anomalies.filter(a => selectedServers.includes(a.serverId)),
    [anomalies, selectedServers]
  )

  const handleSnapshot = async () => {
    await api.triggerSnapshot()
  }

  const categoryLabels: Record<string, string> = {
    temperature: 'Temperatures',
    voltage: 'Voltages',
    fan: 'Fan Speeds',
  }

  // Latest snapshot for heatmap
  const latestSnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null

  return (
    <div className="min-h-screen p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
          <BarChart3 size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-text">Telemetry</h1>
          <p className="text-[12px] text-textMuted">
            Historical trends, real-time charts, and anomaly detection
          </p>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />

        {/* Live mode toggle */}
        <button
          onClick={() => setLiveMode(!liveMode)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
            liveMode
              ? 'bg-success/15 text-success border-success/30'
              : 'text-textMuted hover:text-text bg-surface border-border'
          }`}
        >
          {liveMode ? <Pause size={12} /> : <Play size={12} />}
          <span>{liveMode ? 'Live' : 'Paused'}</span>
          {liveMode && (
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          )}
        </button>

        {/* Manual snapshot */}
        <button
          onClick={handleSnapshot}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-textMuted hover:text-text bg-surface rounded-lg border border-border transition-colors"
        >
          <RefreshCw size={12} />
          <span>Snapshot</span>
        </button>

        {/* Snapshot count */}
        <span className="text-[11px] text-textMuted px-2 py-0.5 bg-surface rounded-full border border-border font-mono">
          {snapshots.length} samples
        </span>

        {/* Compare toggle (charts tab only) */}
        {activeTab === 'charts' && (
          <button
            onClick={() => setCompareMode(!compareMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg border transition-colors ml-auto ${
              compareMode
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'text-textMuted hover:text-text bg-surface border-border'
            }`}
          >
            {compareMode ? 'Overlay' : 'Split'}
          </button>
        )}
      </div>

      {/* Server selector pills */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={toggleAll}
          className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-colors ${
            selectedServers.length === knownServers.size
              ? 'bg-primary/15 text-primary border-primary/30'
              : 'text-textMuted hover:text-text bg-surface border-border'
          }`}
        >
          ALL
        </button>
        {Array.from(knownServers.entries()).map(([ip, hostname], i) => {
          const color = CHART_COLORS[i % CHART_COLORS.length]
          const isSelected = selectedServers.includes(ip)
          return (
            <button
              key={ip}
              onClick={() => toggleServer(ip)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium rounded-full border transition-all ${
                isSelected
                  ? 'border-opacity-50'
                  : 'opacity-40 hover:opacity-70 bg-surface border-border'
              }`}
              style={
                isSelected
                  ? {
                      backgroundColor: `${color}20`,
                      borderColor: `${color}50`,
                      color: color,
                    }
                  : undefined
              }
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="truncate max-w-[120px]">
                {hostname !== ip ? hostname : ip}
              </span>
            </button>
          )
        })}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-surface rounded-lg border border-border p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-primary text-white'
                : 'text-textMuted hover:text-text hover:bg-hover'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'anomalies' && filteredAnomalies.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-error/20 text-error">
                {filteredAnomalies.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={20} className="animate-spin text-primary" />
          <span className="ml-2 text-sm text-textMuted">Loading telemetry data...</span>
        </div>
      )}

      {/* ── Charts tab ─────────────────────────────────────────────────────── */}
      {!loading && activeTab === 'charts' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          {Object.entries(seriesByCategory).map(([category, catSeries]) => {
            const unit = catSeries[0]?.unit ?? ''

            // Threshold values per category
            let amberThreshold: number | undefined
            let redThreshold: number | undefined
            if (category === 'temperature') { amberThreshold = 60; redThreshold = 75 }
            if (category === 'fan') { amberThreshold = 1000; redThreshold = 500 }

            if (compareMode) {
              return (
                <TimeSeriesChart
                  key={category}
                  series={catSeries}
                  timeRange={timeRange}
                  unit={unit}
                  height={280}
                  amberThreshold={amberThreshold}
                  redThreshold={redThreshold}
                />
              )
            }

            // Split: one chart per server per category
            const title = categoryLabels[category] ?? category
            const serverGroups: Record<string, MetricSeries[]> = {}
            for (const s of catSeries) {
              if (!serverGroups[s.serverId]) serverGroups[s.serverId] = []
              serverGroups[s.serverId].push(s)
            }

            return (
              <div key={category} className="space-y-3">
                <h3 className="text-sm font-semibold text-text">{title}</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {Object.entries(serverGroups).map(([serverId, sSeries]) => (
                    <TimeSeriesChart
                      key={`${category}-${serverId}`}
                      series={sSeries}
                      timeRange={timeRange}
                      unit={unit}
                      height={200}
                      amberThreshold={amberThreshold}
                      redThreshold={redThreshold}
                    />
                  ))}
                </div>
              </div>
            )
          })}
          {Object.keys(seriesByCategory).length === 0 && (
            <EmptyState message="No chart data yet. Waiting for telemetry snapshots..." />
          )}
        </motion.div>
      )}

      {/* ── Sparklines tab ─────────────────────────────────────────────────── */}
      {!loading && activeTab === 'sparklines' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
        >
          {Array.from(knownServers.entries())
            .filter(([ip]) => selectedServers.includes(ip))
            .map(([ip, hostname], i) => {
              const serverSeries = filteredSeries.filter(s => s.serverId === ip)
              return (
                <ServerSparklineCard
                  key={ip}
                  serverId={ip}
                  serverName={hostname}
                  series={serverSeries}
                  color={CHART_COLORS[i % CHART_COLORS.length]}
                />
              )
            })}
          {selectedServers.length === 0 && (
            <EmptyState message="Select servers above to view sparklines." />
          )}
        </motion.div>
      )}

      {/* ── Heatmap tab ────────────────────────────────────────────────────── */}
      {!loading && activeTab === 'heatmap' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <HeatmapGrid snapshot={latestSnap} />
        </motion.div>
      )}

      {/* ── Anomalies tab ──────────────────────────────────────────────────── */}
      {!loading && activeTab === 'anomalies' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          <AnomalyTimeline anomalies={filteredAnomalies} />
          {filteredAnomalies.length === 0 && (
            <EmptyState message="No anomalies detected in the selected time range." />
          )}
        </motion.div>
      )}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-textMuted col-span-full">
      <BarChart3 size={32} className="mx-auto mb-3 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  )
}
