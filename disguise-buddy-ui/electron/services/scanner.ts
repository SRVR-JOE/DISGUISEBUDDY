/**
 * electron/services/scanner.ts
 *
 * Real network scanner that discovers factory-reset disguise (d3) servers.
 *
 * - Probes TCP ports concurrently in batches of ~20 hosts
 * - For hosts with port 80 open, fetches /api/service/system to confirm
 *   the server is a disguise machine and retrieve its API version
 * - Falls back to reverse DNS for the hostname when the API call fails
 */

import net from 'net'
import http from 'http'
import dns from 'dns'

// -- Public types -------------------------------------------------------------

export interface DiscoveredServer {
  IPAddress: string
  Hostname: string
  IsDisguise: boolean
  ResponseTimeMs: number
  Ports: number[]
  APIVersion: string
}

export interface ScanOptions {
  subnet: string
  startIP: number
  endIP: number
  timeoutMs: number
  ports: number[]
}

export interface ScanProgress {
  current: number
  total: number
  percent: number
  ip?: string
}

export interface ScanCallbacks {
  onProgress: (progress: ScanProgress) => void
  onDiscovered: (server: DiscoveredServer) => void
  onComplete: (servers: DiscoveredServer[]) => void
  onError: (error: Error) => void
}

// -- Constants ----------------------------------------------------------------

const DEFAULT_PORTS = [80, 445, 873, 9864]
const CONCURRENT_BATCH_SIZE = 20
const D3_SYSTEM_API_PATH = '/api/service/system'

// -- Public API ---------------------------------------------------------------

export function scanNetwork(
  options: ScanOptions,
  callbacks: ScanCallbacks,
): { cancel: () => void } {
  let cancelled = false
  const cancel = () => { cancelled = true }

  const run = async () => {
    try {
      await runLiveScan(options, callbacks, () => cancelled)
    } catch (err) {
      if (!cancelled) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  run().catch((err) => {
    if (!cancelled) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    }
  })

  return { cancel }
}

// -- Live scan ----------------------------------------------------------------

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

  const ips: string[] = []
  for (let i = startIP; i <= endIP; i++) {
    ips.push(`${subnet}.${i}`)
  }

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

// -- TCP port probing ---------------------------------------------------------

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

// -- Disguise API identification ----------------------------------------------

interface DisguiseApiInfo {
  hostname: string
  version: string
}

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

// -- Reverse DNS lookup -------------------------------------------------------

function reverseResolve(ip: string): Promise<string | null> {
  return new Promise((resolve) => {
    dns.reverse(ip, (err, hostnames) => {
      if (err || !hostnames || hostnames.length === 0) {
        resolve(null)
      } else {
        resolve(hostnames[0].replace(/\.$/, ''))
      }
    })
  })
}
