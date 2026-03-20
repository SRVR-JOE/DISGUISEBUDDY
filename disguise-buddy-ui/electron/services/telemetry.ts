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
  // VFC cards
  vfcs: { slot: number; type: string; status: string }[]
  // LED strip
  ledColor: { r: number; g: number; b: number }
  ledMode: string
  // SMC info
  smcFirmware: string
  smcHardware: string
  smcPlatform: string
  // Network adapters from BMC
  networkAdapters: { name: string; mac: string; ip: string; netmask: string }[]
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
/** Convert Celsius to Fahrenheit */
function cToF(c: number): number {
  return Math.round((c * 9 / 5 + 32) * 10) / 10
}

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
        temperatures.push({ label: key, value: cToF(val) })
      } else if (keyLower.includes('fan') || keyLower.includes('speed')) {
        fans.push({ label: key, rpm: val })
      } else if (keyLower.includes('volt') || keyLower.includes('vcc') || keyLower.includes('vnn') || keyLower.includes('vcore')) {
        voltages.push({ label: key, value: val, nominal: 0 })
      }
      continue
    }

    // String value — disguise BMC returns "58 degrees C", "6100 RPM", "11.86 Volts"
    if (typeof val === 'string') {
      const numMatch = val.match(/^([\d.]+)\s*/)
      if (!numMatch) continue
      const num = parseFloat(numMatch[1])
      if (Number.isNaN(num)) continue

      const valLower = val.toLowerCase()
      if (keyLower.includes('tmp') || keyLower.includes('temp') || keyLower.includes('thermal') || valLower.includes('degrees') || valLower.includes('°c')) {
        temperatures.push({ label: key, value: cToF(num) })
      } else if (keyLower.includes('fan') || keyLower.includes('speed') || valLower.includes('rpm')) {
        fans.push({ label: key, rpm: num })
      } else if (keyLower.includes('vol') || keyLower.includes('vcc') || keyLower.includes('vnn') || keyLower.includes('vcore') || valLower.includes('volt')) {
        voltages.push({ label: key, value: num, nominal: 0 })
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
        temperatures.push({ label: key, value: cToF(readingNum) })
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

const MAX_SNAPSHOTS = 7200 // 2 h at 1 s intervals (or 10 h at 5 s)
const DEFAULT_POLL_MS = 5_000
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000
const PERSIST_INTERVAL_MS = 5 * 60 * 1000
const DISCOVERY_INTERVAL_MS = 5 * 60 * 1000 // re-discover every 5 min
const DEFAULT_DISCOVERY_SUBNET = '192.168.100'
const DEFAULT_DISCOVERY_START = 200
const DEFAULT_DISCOVERY_END = 254
const DISCOVERY_TIMEOUT_MS = 2000

export class TelemetryService {
  servers: string[]
  snapshots: TelemetrySnapshot[] = []
  pollIntervalMs: number = DEFAULT_POLL_MS
  retentionMs: number = DEFAULT_RETENTION_MS

  // Discovery config
  discoverySubnet: string = DEFAULT_DISCOVERY_SUBNET
  discoveryStart: number = DEFAULT_DISCOVERY_START
  discoveryEnd: number = DEFAULT_DISCOVERY_END
  private discoveryInProgress = false
  private discoveryTimer: ReturnType<typeof setInterval> | null = null

  private pollTimer: ReturnType<typeof setInterval> | null = null
  private persistTimer: ReturnType<typeof setInterval> | null = null
  private sseCallbacks: Set<SnapshotCallback> = new Set()
  private snapshotInProgress = false

  constructor(servers?: string[]) {
    this.servers = servers ?? []
    this.loadFromDisk()
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.pollTimer) return // already running

    // Auto-discover servers on the MGMT network before first poll
    if (this.servers.length === 0) {
      console.log('[telemetry] No servers configured — running auto-discovery...')
      await this.autoDiscover()
    }

    console.log(`[telemetry] Starting — polling ${this.servers.length} servers every ${this.pollIntervalMs}ms`)

    // Take an initial snapshot immediately
    this.takeSnapshot().catch(err => console.error('[telemetry] Initial snapshot failed:', err))

    this.pollTimer = setInterval(() => {
      this.takeSnapshot().catch(err => console.error('[telemetry] Snapshot failed:', err))
    }, this.pollIntervalMs)

    this.persistTimer = setInterval(() => {
      this.persistToDisk()
    }, PERSIST_INTERVAL_MS)

    // Periodically re-discover to pick up new servers or drop dead ones
    this.discoveryTimer = setInterval(() => {
      this.autoDiscover().catch(err => console.error('[telemetry] Discovery failed:', err))
    }, DISCOVERY_INTERVAL_MS)
  }

  stop(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.persistTimer) { clearInterval(this.persistTimer); this.persistTimer = null }
    if (this.discoveryTimer) { clearInterval(this.discoveryTimer); this.discoveryTimer = null }
    this.persistToDisk()
    console.log('[telemetry] Stopped')
  }

  // ── Auto-Discovery ─────────────────────────────────────────────────────

  async autoDiscover(): Promise<string[]> {
    if (this.discoveryInProgress) return this.servers
    this.discoveryInProgress = true

    try {
      const subnet = this.discoverySubnet
      const start = this.discoveryStart
      const end = this.discoveryEnd
      const total = end - start + 1

      console.log(`[telemetry] Scanning ${subnet}.${start}-${end} for disguise servers...`)

      // Probe all IPs in parallel batches of 10 for speed
      const BATCH_SIZE = 10
      const found: string[] = []

      for (let i = start; i <= end; i += BATCH_SIZE) {
        const batch = Array.from(
          { length: Math.min(BATCH_SIZE, end - i + 1) },
          (_, j) => `${subnet}.${i + j}`,
        )

        const results = await Promise.all(
          batch.map(async (ip) => {
            try {
              const machine = await querySmc(ip, 'localmachine', DISCOVERY_TIMEOUT_MS)
              if (machine && machine.hostname) {
                return { ip, hostname: machine.hostname, type: machine.type || '' }
              }
            } catch {
              // Not a disguise server or unreachable
            }
            return null
          }),
        )

        for (const r of results) {
          if (r) {
            found.push(r.ip)
            console.log(`[telemetry]   Found: ${r.ip} → ${r.hostname} (${r.type})`)
          }
        }
      }

      if (found.length > 0) {
        // Merge: keep any existing servers that are still alive, add new ones
        const newSet = new Set(found)
        const prev = this.servers.length
        this.servers = found
        console.log(`[telemetry] Discovery complete: ${found.length} servers (was ${prev})`)
      } else if (this.servers.length === 0) {
        console.log('[telemetry] Discovery found no servers — will retry next cycle')
      }

      return this.servers
    } finally {
      this.discoveryInProgress = false
    }
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
      const [machine, session, power, chassis, vfcs, ledstrip, smc, adapters] = await Promise.all([
        querySmc(ip, 'localmachine').catch(() => null),
        querySmc(ip, 'session').catch(() => null),
        querySmc(ip, 'chassis/power/status').catch(() => null),
        querySmc(ip, 'chassis/stats').catch(() => null),
        querySmc(ip, 'vfcs').catch(() => null),
        querySmc(ip, 'ledstrip').catch(() => null),
        querySmc(ip, 'smc').catch(() => null),
        querySmc(ip, 'networkadapters').catch(() => null),
      ])

      if (!machine || !machine.hostname) {
        return this.offlineSnapshot(ip, timestamp)
      }

      const powerFault = power?.['Main Power Fault'] || ''
      const { temperatures, voltages, fans } = parseChassisStats(chassis)
      const { status, errors } = determineStatus(true, powerFault, temperatures)

      const parsedVfcs = Array.isArray(vfcs) ? vfcs.map((v: any) => ({
        slot: typeof v.slot === 'number' ? v.slot : 0,
        type: typeof v.type === 'string' ? v.type : 'Unknown',
        status: typeof v.status === 'string' ? v.status : 'Unknown',
      })) : []

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
        vfcs: parsedVfcs,
        ledColor: ledstrip ? { r: ledstrip.ledR ?? 0, g: ledstrip.ledG ?? 0, b: ledstrip.ledB ?? 0 } : { r: 0, g: 0, b: 0 },
        ledMode: ledstrip?.ledMode ?? '',
        smcFirmware: smc?.firmwareversion ?? '',
        smcHardware: smc?.hardwareversion ?? '',
        smcPlatform: smc?.hardwareplatform ?? '',
        networkAdapters: Array.isArray(adapters) ? adapters.map((a: any) => ({
          name: typeof a.name === 'string' ? a.name : '',
          mac: typeof a.mac === 'string' ? a.mac : '',
          ip: typeof a.ip === 'string' ? a.ip : '',
          netmask: typeof a.netmask === 'string' ? a.netmask : '',
        })).filter((a: any) => a.name && !a.name.includes('Loopback')) : [],
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
      vfcs: [],
      ledColor: { r: 0, g: 0, b: 0 },
      ledMode: '',
      smcFirmware: '',
      smcHardware: '',
      smcPlatform: '',
      networkAdapters: [],
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
