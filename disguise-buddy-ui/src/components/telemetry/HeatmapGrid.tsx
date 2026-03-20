import { useState, useMemo } from 'react'
import type { TelemetrySnapshot } from '@/lib/telemetry-types'
import { METRICS } from '@/lib/metric-definitions'
import { CHART_THEME } from '@/lib/metric-definitions'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function severityToHsl(severity: 'green' | 'amber' | 'red'): string {
  switch (severity) {
    case 'green': return 'hsl(152, 69%, 31%)'   // #10B981-ish
    case 'amber': return 'hsl(38, 92%, 50%)'    // #F59E0B-ish
    case 'red':   return 'hsl(0, 84%, 60%)'     // #EF4444-ish
  }
}

interface CellData {
  serverId: string
  serverName: string
  metricKey: string
  metricLabel: string
  value: number
  unit: string
  severity: 'green' | 'amber' | 'red'
  nominal?: number
}

function buildGrid(snapshot: TelemetrySnapshot | null): {
  servers: { id: string; name: string }[]
  metrics: { key: string; label: string }[]
  cells: Map<string, CellData>
} {
  const servers: { id: string; name: string }[] = []
  const metrics = [
    { key: 'temperature', label: 'Temp' },
    { key: 'voltage', label: 'Voltage' },
    { key: 'fan', label: 'Fan' },
  ]
  const cells = new Map<string, CellData>()

  if (!snapshot) return { servers, metrics, cells }

  for (const server of snapshot.servers) {
    servers.push({ id: server.mgmtIp, name: server.hostname })

    const tempMetric = METRICS.find((m) => m.key === 'temperature')!
    const voltMetric = METRICS.find((m) => m.key === 'voltage')!
    const fanMetric = METRICS.find((m) => m.key === 'fan')!

    // Temperature: average
    if (server.temperatures.length > 0) {
      const avg = server.temperatures.reduce((s, t) => s + t.value, 0) / server.temperatures.length
      const rounded = Math.round(avg * 10) / 10
      cells.set(`${server.mgmtIp}:temperature`, {
        serverId: server.mgmtIp,
        serverName: server.hostname,
        metricKey: 'temperature',
        metricLabel: 'Temperature',
        value: rounded,
        unit: '\u00B0C',
        severity: tempMetric.severity(rounded),
      })
    }

    // Voltage: average
    if (server.voltages.length > 0) {
      const avg = server.voltages.reduce((s, v) => s + v.value, 0) / server.voltages.length
      const nomAvg = server.voltages.reduce((s, v) => s + v.nominal, 0) / server.voltages.length
      const rounded = Math.round(avg * 100) / 100
      cells.set(`${server.mgmtIp}:voltage`, {
        serverId: server.mgmtIp,
        serverName: server.hostname,
        metricKey: 'voltage',
        metricLabel: 'Voltage',
        value: rounded,
        unit: 'V',
        severity: voltMetric.severity(rounded, nomAvg),
        nominal: Math.round(nomAvg * 100) / 100,
      })
    }

    // Fan: average
    if (server.fans.length > 0) {
      const avg = server.fans.reduce((s, f) => s + f.rpm, 0) / server.fans.length
      const rounded = Math.round(avg)
      cells.set(`${server.mgmtIp}:fan`, {
        serverId: server.mgmtIp,
        serverName: server.hostname,
        metricKey: 'fan',
        metricLabel: 'Fan Speed',
        value: rounded,
        unit: 'RPM',
        severity: fanMetric.severity(rounded),
      })
    }
  }

  return { servers, metrics, cells }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface HeatmapGridProps {
  snapshot: TelemetrySnapshot | null
  className?: string
}

export function HeatmapGrid({ snapshot, className = '' }: HeatmapGridProps) {
  const [hoveredCell, setHoveredCell] = useState<string | null>(null)
  const { servers, metrics, cells } = useMemo(() => buildGrid(snapshot), [snapshot])

  if (servers.length === 0) {
    return (
      <div className={`text-textMuted text-sm font-mono text-center py-8 ${className}`}>
        No server data available
      </div>
    )
  }

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th
              className="text-left text-textMuted text-[10px] font-mono font-normal px-2 py-1"
              style={{ fontFamily: CHART_THEME.fontFamily }}
            >
              Server
            </th>
            {metrics.map((m) => (
              <th
                key={m.key}
                className="text-center text-textMuted text-[10px] font-mono font-normal px-2 py-1"
                style={{ fontFamily: CHART_THEME.fontFamily }}
              >
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => (
            <tr key={server.id}>
              <td className="text-text text-xs font-mono px-2 py-1 whitespace-nowrap">
                {server.name}
              </td>
              {metrics.map((metric) => {
                const cellKey = `${server.id}:${metric.key}`
                const cell = cells.get(cellKey)
                const isHovered = hoveredCell === cellKey

                return (
                  <td
                    key={cellKey}
                    className="px-1 py-1 relative"
                    onMouseEnter={() => setHoveredCell(cellKey)}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <div
                      className="rounded px-2 py-1.5 text-center text-xs font-mono font-bold transition-all cursor-default"
                      style={{
                        background: cell ? severityToHsl(cell.severity) : '#1A1A24',
                        color: '#E2E8F0',
                        opacity: cell ? 1 : 0.3,
                        transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                      }}
                    >
                      {cell ? `${cell.value}${cell.unit}` : '--'}
                    </div>

                    {/* Hover tooltip */}
                    {isHovered && cell && (
                      <div
                        className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 rounded-lg px-3 py-2 text-[10px] whitespace-nowrap pointer-events-none"
                        style={{
                          background: CHART_THEME.tooltipBg,
                          border: `1px solid ${CHART_THEME.tooltipBorder}`,
                          boxShadow: '0 0 20px rgba(124, 58, 237, 0.15)',
                          fontFamily: CHART_THEME.fontFamily,
                        }}
                      >
                        <p className="text-text font-bold">{cell.serverName}</p>
                        <p className="text-textSecondary">
                          {cell.metricLabel}: {cell.value}{cell.unit}
                        </p>
                        {cell.nominal !== undefined && (
                          <p className="text-textMuted">Nominal: {cell.nominal}{cell.unit}</p>
                        )}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
