/**
 * electron/services/scanner.ts
 *
 * Real network scanner that discovers factory-reset disguise (d3) servers.
 *
 * Live mode (Windows only):
 *   - Probes TCP ports concurrently in batches of ~20 hosts
 *   - For hosts with port 80 open, fetches /api/service/system to confirm
 *     the server is a disguise machine and retrieve its API version
 *   - Falls back to reverse DNS for the hostname when the API call fails
 *
 * Dev / mock mode (non-Windows or MOCK_BACKEND=true):
 *   - Reads profiles from ../../profiles/ and builds a DiscoveredServer entry
 *     for each profile that has a d3Net IP address, matching the same logic
 *     used in mock-data.ts mockDiscovery
 *   - Emits discovered events progressively with realistic timing so the UI
 *     progress bar behaves exactly as it will in production
 */

import net from 'net'
import http from 'http'
import dns from 'dns'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { isDevMode, delay, randomInt } from './utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DiscoveredServer {
  IPAddress: string
  Hostname: string
  IsDisguise: boolean
  ResponseTimeMs: number
  Ports: number[]
  APIVersion: string
}

export interface ScanOptions {
  /** Network prefix, e.g. "192.168.10" */
  subnet: string
  /** First host octet to probe, e.g. 1 */
  startIP: number
  /** Last host octet to probe (inclusive), e.g. 254 */
  endIP: number
  /** Per-host TCP connection timeout in milliseconds */
  timeoutMs: number
  /** TCP ports to probe on each host. Default [80, 873, 9864] */
  ports: number[]
}

export interface ScanProgress {
  current: number
  total: number
  percent: number
  /** Current IP being probed (omitted for batch-level progress events) */
  ip?: string
}

export interface ScanCallbacks {
  onProgress: (progress: ScanProgress) => void
  onDiscovered: (server: DiscoveredServer) => void
  onComplete: (servers: DiscoveredServer[]) => void
  onError: (error: Error) => void
}

// ─── Internal profile shape (subset used for mock discovery) ─────────────────

interface AdapterConfig {
  Role: string
  IPAddress: string
}

interface ProfileFile {
  Name?: string
  ServerName?: string
  NetworkAdapters?: AdapterConfig[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PORTS = [80, 873, 9864]
const CONCURRENT_BATCH_SIZE = 20
// Disguise REST endpoint that confirms the server identity
const D3_SYSTEM_API_PATH = '/api/service/system'

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Begins a subnet scan and reports progress/results via callbacks.
 *
 * Returns a `{ cancel }` handle so the caller can abort mid-scan
 * (e.g. when the SSE client disconnects).
 */
export function scanNetwork(
  options: ScanOptions,
  callbacks: ScanCallbacks,
): { cancel: () => void } {
  let cancelled = false
  const cancel = () => { cancelled = true }

  const run = async () => {
    try {
      if (isDevMode()) {
        await runMockScan(options, callbacks, () => cancelled)
      } else {
        await runLiveScan(options, callbacks, () => cancelled)
      }
    } catch (err) {
      if (!cancelled) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  // Fire and forget — the promise chain drives itself via callbacks
  run().catch((err) => {
    if (!cancelled) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    }
  })

  return { cancel }
}

// ─── Live implementation ──────────────────────────────────────────────────────

async function runLiveScan(
  options: ScanOptions,
  callbacks: ScanCallbacks,
  isCancelled: () => boolean,
): Promise<void> {
  const { subnet, startIP, endIP, timeoutMs } = options
  const ports = options.ports.length > 0 ? options.ports : DEFAULT_PORTS

  const total = endIP - startIP + 1
  let current = 0
  const discovered: DiscoveredServer[] = []

  // Build the full list of IPs to probe
  const ips: string[] = []
  for (let i = startIP; i <= endIP; i++) {
    ips.push(`${subnet}.${i}`)
  }

  // Process in batches so we stay within ~20 concurrent sockets
  for (let batchStart = 0; batchStart < ips.length; batchStart += CONCURRENT_BATCH_SIZE) {
    if (isCancelled()) break

    const batch = ips.slice(batchStart, batchStart + CONCURRENT_BATCH_SIZE)

    await Promise.all(batch.map(async (ip) => {
      if (isCancelled()) return

      const startTime = Date.now()
      const openPorts = await probePortsConcurrently(ip, ports, timeoutMs)

      if (isCancelled()) return

      current++
      callbacks.onProgress({
        current,
        total,
        percent: Math.round((current / total) * 100),
        ip,
      })

      if (openPorts.length === 0) return

      const responseTimeMs = Date.now() - startTime

      // If port 80 is open, attempt to identify as a disguise server
      if (openPorts.includes(80)) {
        const apiResult = await queryDisguiseApi(ip, timeoutMs)

        if (apiResult !== null) {
          const server: DiscoveredServer = {
            IPAddress: ip,
            Hostname: apiResult.hostname || (await reverseResolve(ip)) || ip,
            IsDisguise: true,
            ResponseTimeMs: responseTimeMs,
            Ports: openPorts,
            APIVersion: apiResult.version,
          }
          discovered.push(server)
          if (!isCancelled()) callbacks.onDiscovered(server)
          return
        }
      }

      // Port(s) open but not a disguise API — report as generic host
      const hostname = await reverseResolve(ip)
      const server: DiscoveredServer = {
        IPAddress: ip,
        Hostname: hostname || ip,
        IsDisguise: false,
        ResponseTimeMs: responseTimeMs,
        Ports: openPorts,
        APIVersion: '',
      }
      discovered.push(server)
      if (!isCancelled()) callbacks.onDiscovered(server)
    }))
  }

  if (!isCancelled()) {
    callbacks.onComplete(discovered)
  }
}

// ─── TCP port probing ────────────────────────────────────────────────────────

/**
 * Tries all `ports` on `ip` concurrently. Returns the list of ports that
 * accepted a connection within `timeoutMs`.
 */
async function probePortsConcurrently(
  ip: string,
  ports: number[],
  timeoutMs: number,
): Promise<number[]> {
  const results = await Promise.all(
    ports.map((port) => probePort(ip, port, timeoutMs))
  )
  return ports.filter((_port, idx) => results[idx])
}

/**
 * Opens a TCP connection to `ip:port`. Resolves `true` if the connection
 * succeeds (server accepted), `false` on timeout or refusal.
 */
function probePort(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const finish = (open: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }

    socket.setTimeout(timeoutMs)
    socket.on('connect', () => finish(true))
    socket.on('timeout', () => finish(false))
    socket.on('error', () => finish(false))

    socket.connect(port, ip)
  })
}

// ─── Disguise API identification ─────────────────────────────────────────────

interface DisguiseApiInfo {
  hostname: string
  version: string
}

/**
 * GETs /api/service/system on the target host and extracts hostname and
 * API version from the JSON response. Returns null if the endpoint is
 * unreachable, times out, or does not look like a disguise response.
 *
 * The disguise REST API returns (among other fields):
 *   { "machine": { "hostname": "ACTOR-01" }, "version": { "fullVersionString": "r27.4" } }
 */
function queryDisguiseApi(ip: string, timeoutMs: number): Promise<DisguiseApiInfo | null> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: ip,
        port: 80,
        path: D3_SYSTEM_API_PATH,
        timeout: timeoutMs,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { body += chunk })
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              resolve(null)
              return
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const json = JSON.parse(body) as any

            // Validate that the response looks like a disguise system endpoint
            const hostname: string =
              json?.machine?.hostname ||
              json?.hostname ||
              ''

            const version: string =
              json?.version?.fullVersionString ||
              json?.version?.displayString ||
              json?.apiVersion ||
              ''

            if (!hostname && !version) {
              // Not a disguise server
              resolve(null)
              return
            }

            resolve({ hostname, version })
          } catch {
            resolve(null)
          }
        })
      }
    )

    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })

    req.on('error', () => {
      resolve(null)
    })
  })
}

// ─── Reverse DNS lookup ───────────────────────────────────────────────────────

function reverseResolve(ip: string): Promise<string | null> {
  return new Promise((resolve) => {
    dns.reverse(ip, (err, hostnames) => {
      if (err || !hostnames || hostnames.length === 0) {
        resolve(null)
      } else {
        // Strip trailing dot and take first result
        resolve(hostnames[0].replace(/\.$/, ''))
      }
    })
  })
}

// ─── Mock / dev implementation ────────────────────────────────────────────────

/**
 * Reads all JSON files from the profiles directory and builds a DiscoveredServer
 * list — the same logic as mock-data.ts's mockDiscovery array.
 *
 * Each discovered server is emitted one-by-one with a small delay to simulate
 * real scan timing. Hosts "between" discovered servers emit empty progress
 * events so the progress bar advances smoothly.
 */
async function runMockScan(
  options: ScanOptions,
  callbacks: ScanCallbacks,
  isCancelled: () => boolean,
): Promise<void> {
  const { subnet, startIP, endIP } = options

  const total = endIP - startIP + 1
  const profilesDir = path.resolve(__dirname, '..', '..', '..', 'profiles')
  const mockServers = buildMockServersFromProfiles(profilesDir, subnet)

  // Build a sparse map of octet → server so we can emit discoveries at the
  // "right" point during the scan sweep
  const serverByOctet = new Map<number, DiscoveredServer>()
  for (const server of mockServers) {
    const octet = parseInt(server.IPAddress.split('.').pop() ?? '0', 10)
    if (octet >= startIP && octet <= endIP) {
      serverByOctet.set(octet, server)
    }
  }

  const discovered: DiscoveredServer[] = []

  // Simulate scanning with a delay proportional to CONCURRENT_BATCH_SIZE
  // so ~254 hosts takes about the same wall-clock time as a real scan
  const msPerHost = Math.max(8, Math.floor(4000 / total))

  for (let i = startIP; i <= endIP; i++) {
    if (isCancelled()) break

    const current = i - startIP + 1
    const ip = `${subnet}.${i}`

    callbacks.onProgress({
      current,
      total,
      percent: Math.round((current / total) * 100),
      ip,
    })

    const server = serverByOctet.get(i)
    if (server) {
      // Simulate variable response time
      await delay(randomInt(30, 120))
      if (isCancelled()) break
      discovered.push(server)
      callbacks.onDiscovered(server)
    } else {
      await delay(msPerHost)
    }
  }

  if (!isCancelled()) {
    callbacks.onComplete(discovered)
  }
}

/**
 * Reads profile JSON files from `profilesDir` and converts each one that has
 * a d3Net adapter with a static IP into a DiscoveredServer.
 *
 * Only profiles whose d3Net IP starts with `subnet` are included, so the
 * mock scan respects the subnet the user typed in the UI.
 */
function buildMockServersFromProfiles(
  profilesDir: string,
  subnet: string,
): DiscoveredServer[] {
  if (!fs.existsSync(profilesDir)) {
    console.warn(`[scanner] Profiles directory not found: ${profilesDir}`)
    return []
  }

  const files = fs.readdirSync(profilesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()

  const servers: DiscoveredServer[] = []

  for (const [idx, file] of files.entries()) {
    try {
      const raw = fs.readFileSync(path.join(profilesDir, file), 'utf-8')
      const data = JSON.parse(raw) as ProfileFile

      const adapters: AdapterConfig[] = data.NetworkAdapters ?? []
      const d3Adapter = adapters.find((a) => a.Role === 'd3Net')
      const ip = d3Adapter?.IPAddress ?? ''

      // Skip profiles with no d3Net IP or IPs outside the target subnet
      if (!ip || !ip.startsWith(`${subnet}.`)) continue

      servers.push({
        IPAddress: ip,
        Hostname: data.ServerName ?? data.Name ?? path.basename(file, '.json'),
        IsDisguise: true,
        ResponseTimeMs: randomInt(2, 12) + idx * 2,
        Ports: [80, 873, 9864],
        APIVersion: 'r27.4',
      })
    } catch (err) {
      console.warn(`[scanner] Failed to parse profile ${file}: ${err}`)
    }
  }

  return servers
}
