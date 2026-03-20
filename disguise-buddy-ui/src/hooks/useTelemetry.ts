import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  TimeRange,
  TelemetrySnapshot,
  ServerSnapshot,
  MetricSeries,
  AnomalyEvent,
  DataPoint,
} from '@/lib/telemetry-types'
import { METRICS, getMetricColor } from '@/lib/metric-definitions'

const BASE_URL = 'http://localhost:47100'

const MAX_POINTS = 300

// ─── Helpers ─────────────────────────────────────────────────────────────────

function downsample(points: DataPoint[], maxPoints: number): DataPoint[] {
  if (points.length <= maxPoints) return points
  const step = Math.ceil(points.length / maxPoints)
  const result: DataPoint[] = []
  for (let i = 0; i < points.length; i += step) {
    result.push(points[i])
  }
  // always include the last point
  if (result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 1])
  }
  return result
}

let anomalyCounter = 0
function nextAnomalyId(): string {
  anomalyCounter += 1
  return `anomaly-${Date.now()}-${anomalyCounter}`
}

function extractMetricSeries(
  snapshots: TelemetrySnapshot[],
  serverColorMap: Map<string, string>,
): MetricSeries[] {
  const seriesMap = new Map<string, MetricSeries>()

  for (const snap of snapshots) {
    for (const server of snap.servers) {
      const color = serverColorMap.get(server.mgmtIp) ?? '#7C3AED'

      // Temperature — average all sensors
      if (server.temperatures.length > 0) {
        const key = `${server.mgmtIp}:temperature`
        if (!seriesMap.has(key)) {
          seriesMap.set(key, {
            serverId: server.mgmtIp,
            serverName: server.hostname,
            metricKey: 'temperature',
            label: 'Temperature',
            unit: '\u00B0C',
            data: [],
            color,
          })
        }
        const avg =
          server.temperatures.reduce((sum, t) => sum + t.value, 0) /
          server.temperatures.length
        seriesMap.get(key)!.data.push({ timestamp: snap.timestamp, value: Math.round(avg * 10) / 10 })
      }

      // Voltage — average all rails
      if (server.voltages.length > 0) {
        const key = `${server.mgmtIp}:voltage`
        if (!seriesMap.has(key)) {
          seriesMap.set(key, {
            serverId: server.mgmtIp,
            serverName: server.hostname,
            metricKey: 'voltage',
            label: 'Voltage',
            unit: 'V',
            data: [],
            color,
          })
        }
        const avg =
          server.voltages.reduce((sum, v) => sum + v.value, 0) /
          server.voltages.length
        seriesMap.get(key)!.data.push({ timestamp: snap.timestamp, value: Math.round(avg * 100) / 100 })
      }

      // Fan — average RPM
      if (server.fans.length > 0) {
        const key = `${server.mgmtIp}:fan`
        if (!seriesMap.has(key)) {
          seriesMap.set(key, {
            serverId: server.mgmtIp,
            serverName: server.hostname,
            metricKey: 'fan',
            label: 'Fan Speed',
            unit: 'RPM',
            data: [],
            color,
          })
        }
        const avg =
          server.fans.reduce((sum, f) => sum + f.rpm, 0) / server.fans.length
        seriesMap.get(key)!.data.push({ timestamp: snap.timestamp, value: Math.round(avg) })
      }
    }
  }

  // Downsample large series
  const result: MetricSeries[] = []
  for (const series of seriesMap.values()) {
    result.push({ ...series, data: downsample(series.data, MAX_POINTS) })
  }
  return result
}

function detectAnomalies(snapshots: TelemetrySnapshot[]): AnomalyEvent[] {
  const anomalies: AnomalyEvent[] = []
  const tempMetric = METRICS.find((m) => m.key === 'temperature')!
  const fanMetric = METRICS.find((m) => m.key === 'fan')!

  for (const snap of snapshots) {
    for (const server of snap.servers) {
      // Temperature anomalies
      for (const sensor of server.temperatures) {
        const sev = tempMetric.severity(sensor.value)
        if (sev !== 'green') {
          anomalies.push({
            id: nextAnomalyId(),
            timestamp: snap.timestamp,
            serverId: server.mgmtIp,
            serverName: server.hostname,
            metricKey: 'temperature',
            metricLabel: sensor.label,
            value: sensor.value,
            threshold: sev === 'red' ? 75 : 60,
            severity: sev === 'red' ? 'critical' : 'warning',
            unit: '\u00B0C',
          })
        }
      }

      // Voltage anomalies
      for (const rail of server.voltages) {
        const volMetric = METRICS.find((m) => m.key === 'voltage')!
        const sev = volMetric.severity(rail.value, rail.nominal)
        if (sev !== 'green') {
          anomalies.push({
            id: nextAnomalyId(),
            timestamp: snap.timestamp,
            serverId: server.mgmtIp,
            serverName: server.hostname,
            metricKey: 'voltage',
            metricLabel: rail.label,
            value: rail.value,
            threshold: rail.nominal,
            severity: sev === 'red' ? 'critical' : 'warning',
            unit: 'V',
          })
        }
      }

      // Fan anomalies
      for (const fan of server.fans) {
        const sev = fanMetric.severity(fan.rpm)
        if (sev !== 'green') {
          anomalies.push({
            id: nextAnomalyId(),
            timestamp: snap.timestamp,
            serverId: server.mgmtIp,
            serverName: server.hostname,
            metricKey: 'fan',
            metricLabel: fan.label,
            value: fan.rpm,
            threshold: sev === 'red' ? 500 : 1000,
            severity: sev === 'red' ? 'critical' : 'warning',
            unit: 'RPM',
          })
        }
      }
    }
  }

  return anomalies
}

// ─── Hook ────────────────────────────────────────────────────────────────────

interface UseTelemetryOptions {
  timeRange: TimeRange
  liveMode: boolean
}

interface UseTelemetryReturn {
  series: MetricSeries[]
  anomalies: AnomalyEvent[]
  snapshots: TelemetrySnapshot[]
  loading: boolean
  latestSnapshot: TelemetrySnapshot | null
}

export function useTelemetry({ timeRange, liveMode }: UseTelemetryOptions): UseTelemetryReturn {
  const [snapshots, setSnapshots] = useState<TelemetrySnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const serverColorMapRef = useRef(new Map<string, string>())
  const eventSourceRef = useRef<EventSource | null>(null)

  // Assign stable colors to servers as they appear
  const assignColors = useCallback((servers: ServerSnapshot[]) => {
    for (const server of servers) {
      if (!serverColorMapRef.current.has(server.mgmtIp)) {
        const idx = serverColorMapRef.current.size
        serverColorMapRef.current.set(server.mgmtIp, getMetricColor(idx))
      }
    }
  }, [])

  // Fetch history
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function fetchHistory() {
      try {
        const res = await fetch(`${BASE_URL}/api/telemetry/history?range=${timeRange}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: TelemetrySnapshot[] = await res.json()
        if (cancelled) return
        for (const snap of data) {
          assignColors(snap.servers)
        }
        setSnapshots(data)
      } catch (err) {
        console.error('[useTelemetry] Failed to fetch history:', err)
        if (!cancelled) setSnapshots([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchHistory()
    return () => { cancelled = true }
  }, [timeRange, assignColors])

  // Live SSE stream
  useEffect(() => {
    if (!liveMode) return

    const es = new EventSource(`${BASE_URL}/api/telemetry/stream`)
    eventSourceRef.current = es

    es.onmessage = (event) => {
      try {
        const snap: TelemetrySnapshot = JSON.parse(event.data)
        assignColors(snap.servers)
        setSnapshots((prev) => [...prev.slice(-MAX_POINTS), snap])
      } catch {
        // ignore malformed events
      }
    }

    es.onerror = () => {
      // EventSource will auto-reconnect
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [liveMode, assignColors])

  const series = extractMetricSeries(snapshots, serverColorMapRef.current)
  const anomalies = detectAnomalies(snapshots)
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null

  return { series, anomalies, snapshots, loading, latestSnapshot }
}
