/**
 * electron/services/telemetry.ts
 *
 * Polls disguise server BMC endpoints on the MGMT network at a configurable
 * interval, stores a ring-buffer of snapshots, and pushes updates to SSE
 * clients in real time.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { querySmc } from './smc-client.ts'

// ─── Resolve data directory ──────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const _require = createRequire(import.meta.url)

function getDataDir(): string {
  try {
    const { app } = _require('electron') as { app: any }
    if (app?.isPackaged) {
      return path.join(process.resourcesPath, 'data')
    }
  } catch {
    // Not running inside Electron
  }
  return path.resolve(__dirname, '..', '..', 'data')
}

const DATA_DIR = getDataDir()
const PERSIST_PATH = path.join(DATA_DIR, 'telemetry-data.json')

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ServerSnapshot {
  mgmtIp: string
  hostname: string
  timestamp: number
  // from localmachine
  serial: string
  type: string
  // from session
  role: string
  // from chassis/power/status
  powerStatus: string
  powerFault: string
  // from chassis/stats — raw object
  chassisStats: any
  // parsed metrics for charting
  temperatures: { label: string; value: number }[]
  voltages: { label: string; value: number; nominal: number }[]
  fans: { label: string; rpm: number }[]
  // status
  status: 'online' | 'warning' | 'error' | 'offline'
  errors: string[]
}

export interface TelemetrySnapshot {
  timestamp: number
  servers: ServerSnapshot[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse the chassis/stats response to extract temperature, voltage, and fan
 * readings.  The BMC returns an object whose keys are sensor labels and whose
 * values contain numeric readings.  The exact shape varies by firmware version
 * so we use heuristic matching on key names.
 */
function parseChassisStats(stats: any): {
  temperatures: { label: string; value: number }[]
  voltages: { label: string; value: number; nominal: number }[]
  fans: { label: string; rpm: number }[]
} {
  const temperatures: { label: string; value: number }[] = []
  const voltages: { label: string; value: number; nominal: number }[] = []
  const fans: { label: string; rpm: number }[] = []

  if (!stats || typeof stats !== 'object') return { temperatures, voltages, fans }

  for (const [key, val] of Object.entries(stats)) {
    const keyLower = key.toLowerCase()

    if (typeof val === 'number') {
      // Simple numeric value — classify by key name
      if (keyLower.includes('temp') || keyLower.includes('thermal')) {
        temperatures.push({ label: key, value: val })
      } else if (keyLower.includes('fan')) {
        fans.push({ label: key, rpm: val })
      } else if (keyLower.includes('volt') || keyLower.includes('vcc') || keyLower.includes('vnn') || keyLower.includes('vcore')) {
        voltages.push({ label: key, value: val, nominal: 0 })
      }
      continue
    }

    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, any>

      // Object with a 'reading' or 'value' field
      const reading = obj['reading'] ?? obj['value'] ?? obj['Reading'] ?? obj['Value']
      const readingNum = typeof reading === 'number' ? reading : parseFloat(String(reading ?? ''))

      if (Number.isNaN(readingNum)) continue

      if (keyLower.includes('temp') || keyLower.includes('thermal') || obj['unit']?.toLowerCase?.()?.includes('c')) {
        temperatures.push({ label: key, value: readingNum })
      } else if (keyLower.includes('fan') || obj['unit']?.toLowerCase?.()?.includes('rpm')) {
        fans.push({ label: key, rpm: readingNum })
      } else if (
        keyLower.includes('volt') || keyLower.includes('vcc') || keyLower.includes('vnn') || keyLower.includes('vcore') ||
        obj['unit']?.toLowerCase?.()?.includes('v')
      ) {
        const nominal = typeof obj['nominal'] === 'number' ? obj['nominal'] : 0
        voltages.push({ label: key, value: readingNum, nominal })
      }
    }
  }

  return { temperatures, voltages, fans }
}

function determineStatus(
  reachable: boolean,
  powerFault: string,
  temperatures: { label: string; value: number }[],
): { status: 'online' | 'warning' | 'error' | 'offline'; errors: string[] } {
  const errors: string[] = []

  if (!reachable) return { status: 'offline', errors: ['Host unreachable'] }

  const faultLower = (powerFault || '').toLowerCase().trim()
  const noFaultValues = ['', 'false', 'no fault', 'none', 'no', '0', 'ok']
  if (faultLower && !noFaultValues.includes(faultLower)) {
    errors.push(`Power fault: ${powerFault}`)
  }

  const highTemp = temperatures.find(t => t.value > 75)
  if (highTemp) {
    errors.push(`High temperature: ${highTemp.label} = ${highTemp.value}C`)
  }

  if (errors.some(e => e.startsWith('Power fault'))) return { status: 'error', errors }
  if (errors.length > 0) return { status: 'warning', errors }
  return { status: 'online', errors }
}

// ─── SSE callback type ───────────────────────────────────────────────────────

type SnapshotCallback = (snapshot: TelemetrySnapshot) => void

// ─── TelemetryService ────────────────────────────────────────────────────────

const MAX_SNAPSHOTS = 2880 // 24 h at 30 s intervals
const DEFAULT_POLL_MS = 30_000
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000
const PERSIST_INTERVAL_MS = 5 * 60 * 1000

export class TelemetryService {
  servers: string[]
  snapshots: TelemetrySnapshot[] = []
  pollIntervalMs: number = DEFAULT_POLL_MS
  retentionMs: number = DEFAULT_RETENTION_MS

  private pollTimer: ReturnType<typeof setInterval> | null = null
  private persistTimer: ReturnType<typeof setInterval> | null = null
  private sseCallbacks: Set<SnapshotCallback> = new Set()
  private snapshotInProgress = false

  constructor(servers?: string[]) {
    this.servers = servers ?? [
      '192.168.100.200',
      '192.168.100.201',
      '192.168.100.202',
      '192.168.100.203',
      '192.168.100.204',
      '192.168.100.205',
      '192.168.100.206',
    ]
    this.loadFromDisk()
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start(): void {
    if (this.pollTimer) return // already running
    console.log(`[telemetry] Starting — polling ${this.servers.length} servers every ${this.pollIntervalMs}ms`)

    // Take an initial snapshot immediately
    this.takeSnapshot().catch(err => console.error('[telemetry] Initial snapshot failed:', err))

    this.pollTimer = setInterval(() => {
      this.takeSnapshot().catch(err => console.error('[telemetry] Snapshot failed:', err))
    }, this.pollIntervalMs)

    this.persistTimer = setInterval(() => {
      this.persistToDisk()
    }, PERSIST_INTERVAL_MS)
  }

  stop(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.persistTimer) { clearInterval(this.persistTimer); this.persistTimer = null }
    this.persistToDisk()
    console.log('[telemetry] Stopped')
  }

  // ── Configuration ────────────────────────────────────────────────────────

  setServers(ips: string[]): void {
    this.servers = ips
    console.log(`[telemetry] Server list updated: ${ips.join(', ')}`)
  }

  // ── Snapshot ─────────────────────────────────────────────────────────────

  async takeSnapshot(): Promise<TelemetrySnapshot> {
    if (this.snapshotInProgress) return this.snapshots[this.snapshots.length - 1] ?? { timestamp: Date.now(), servers: [] }
    this.snapshotInProgress = true
    try {
      const timestamp = Date.now()
      const serverSnapshots = await Promise.all(this.servers.map(ip => this.probeServer(ip, timestamp)))

      const snapshot: TelemetrySnapshot = { timestamp, servers: serverSnapshots }

      // Append to ring buffer
      this.snapshots.push(snapshot)
      if (this.snapshots.length > MAX_SNAPSHOTS) {
        this.snapshots = this.snapshots.slice(this.snapshots.length - MAX_SNAPSHOTS)
      }

      // Evict entries older than retention window
      const cutoff = Date.now() - this.retentionMs
      const firstValid = this.snapshots.findIndex(s => s.timestamp >= cutoff)
      if (firstValid > 0) {
        this.snapshots = this.snapshots.slice(firstValid)
      }

      // Broadcast to SSE clients
      for (const cb of this.sseCallbacks) {
        try { cb(snapshot) } catch (err) { console.warn('[telemetry] SSE callback error:', err) }
      }

      return snapshot
    } finally {
      this.snapshotInProgress = false
    }
  }

  private async probeServer(ip: string, timestamp: number): Promise<ServerSnapshot> {
    try {
      const [machine, session, power, chassis] = await Promise.all([
        querySmc(ip, 'localmachine').catch(() => null),
        querySmc(ip, 'session').catch(() => null),
        querySmc(ip, 'chassis/power/status').catch(() => null),
        querySmc(ip, 'chassis/stats').catch(() => null),
      ])

      if (!machine || !machine.hostname) {
        return this.offlineSnapshot(ip, timestamp)
      }

      const powerFault = power?.['Main Power Fault'] || ''
      const { temperatures, voltages, fans } = parseChassisStats(chassis)
      const { status, errors } = determineStatus(true, powerFault, temperatures)

      return {
        mgmtIp: ip,
        hostname: machine.hostname,
        timestamp,
        serial: machine.serial || '',
        type: machine.type || '',
        role: session?.role || '',
        powerStatus: power?.['System Power'] || '',
        powerFault,
        chassisStats: chassis || null,
        temperatures,
        voltages,
        fans,
        status,
        errors,
      }
    } catch {
      return this.offlineSnapshot(ip, timestamp)
    }
  }

  private offlineSnapshot(ip: string, timestamp: number): ServerSnapshot {
    return {
      mgmtIp: ip,
      hostname: '',
      timestamp,
      serial: '',
      type: '',
      role: '',
      powerStatus: '',
      powerFault: '',
      chassisStats: null,
      temperatures: [],
      voltages: [],
      fans: [],
      status: 'offline',
      errors: ['Host unreachable'],
    }
  }

  // ── Query ────────────────────────────────────────────────────────────────

  getHistory(sinceMs: number): TelemetrySnapshot[] {
    const cutoff = Date.now() - sinceMs
    return this.snapshots.filter(s => s.timestamp >= cutoff)
  }

  getLatest(): TelemetrySnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null
  }

  // ── SSE ──────────────────────────────────────────────────────────────────

  registerCallback(cb: SnapshotCallback): void {
    this.sseCallbacks.add(cb)
  }

  unregisterCallback(cb: SnapshotCallback): void {
    this.sseCallbacks.delete(cb)
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private async persistToDisk(): Promise<void> {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
      const payload = JSON.stringify({
        servers: this.servers,
        pollIntervalMs: this.pollIntervalMs,
        retentionMs: this.retentionMs,
        snapshots: this.snapshots,
      })
      await fs.promises.writeFile(PERSIST_PATH, payload, 'utf-8')
      console.log(`[telemetry] Persisted ${this.snapshots.length} snapshots to disk`)
    } catch (err) {
      console.error('[telemetry] Failed to persist:', err)
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(PERSIST_PATH)) return
      const raw = fs.readFileSync(PERSIST_PATH, 'utf-8')
      const data = JSON.parse(raw) as {
        servers?: string[]
        pollIntervalMs?: number
        retentionMs?: number
        snapshots?: TelemetrySnapshot[]
      }
      if (data.servers) this.servers = data.servers.filter(
        (ip) => typeof ip === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
      )
      if (data.pollIntervalMs && data.pollIntervalMs >= 5000) this.pollIntervalMs = data.pollIntervalMs
      if (data.retentionMs && data.retentionMs >= 60000) this.retentionMs = data.retentionMs
      if (Array.isArray(data.snapshots)) {
        // Evict stale entries
        const cutoff = Date.now() - this.retentionMs
        this.snapshots = data.snapshots.filter(s => s.timestamp >= cutoff)
        console.log(`[telemetry] Loaded ${this.snapshots.length} snapshots from disk`)
      }
    } catch (err) {
      console.error('[telemetry] Failed to load from disk:', err)
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

export const telemetryService = new TelemetryService()
