// ─── Telemetry types ─────────────────────────────────────────────────────────

/** Server snapshot from SMC polling */
export interface ServerSnapshot {
  mgmtIp: string
  hostname: string
  timestamp: number
  serial: string
  type: string
  role: string
  powerStatus: string
  powerFault: string
  chassisStats: any
  temperatures: { label: string; value: number }[]
  voltages: { label: string; value: number; nominal: number }[]
  fans: { label: string; rpm: number }[]
  status: 'online' | 'warning' | 'error' | 'offline'
  errors: string[]
}

export interface TelemetrySnapshot {
  timestamp: number
  servers: ServerSnapshot[]
}

export interface DataPoint {
  timestamp: number
  value: number
}

export interface MetricSeries {
  serverId: string   // mgmtIp
  serverName: string // hostname
  metricKey: string
  label: string
  unit: string
  data: DataPoint[]
  color: string
}

export type AnomalySeverity = 'warning' | 'critical'

export interface AnomalyEvent {
  id: string
  timestamp: number
  serverId: string
  serverName: string
  metricKey: string
  metricLabel: string
  value: number
  threshold: number
  severity: AnomalySeverity
  unit: string
}

export type TimeRange = '30s' | '1m' | '5m' | '15m' | '1h'
