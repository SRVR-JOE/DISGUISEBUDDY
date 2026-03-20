import type {
  Profile,
  Result,
  NetworkInterface,
  SoftwarePackage,
  ProbeResult,
  IdentityInfo,
  SmbShare,
} from '@/lib/types'
import type { TelemetrySnapshot } from '@/lib/telemetry-types'

// ─── Configuration ────────────────────────────────────────────────────────────

export const BASE_URL = 'http://localhost:47100'

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  const res = await fetch(`${BASE_URL}${path}`, init)

  if (!res.ok) {
    let message = `HTTP ${res.status} ${res.statusText}`
    try {
      const err = (await res.json()) as { message?: string }
      if (err.message) message = err.message
    } catch {
      // use default message
    }
    throw new Error(message)
  }

  return res.json() as Promise<T>
}

function get<T>(path: string): Promise<T> {
  return request<T>('GET', path)
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body)
}

function del<T>(path: string): Promise<T> {
  return request<T>('DELETE', path)
}

// ─── SSE helpers ──────────────────────────────────────────────────────────────

/** Network adapter info returned by /api/network/adapters */
export interface NetworkAdapterInfo {
  Name: string
  Description: string
  Status: string
  MacAddress: string
  IPAddress: string
  SubnetMask: string
  Gateway: string
  DNS: string[]
  DHCP: boolean
  LinkSpeed: string
}

/** SMC probe result from /api/smc/probe */
export interface SmcProbeResult {
  ip: string
  hostname: string
  role: string
  adapters: { name: string; ipAddress: string; macAddress: string; netmask: string }[]
  power: Record<string, string>
  chassis: Record<string, string>
}

/** SSE event data — loosely structured JSON from the server. */
export interface SseEventData {
  type?: string
  message?: string
  line?: string
  percent?: number
  [key: string]: unknown
}

/** Read an SSE stream from a fetch Response and dispatch parsed events. */
function readSseStream(
  resPromise: Promise<Response>,
  callbacks: {
    onProgress?: (data: SseEventData) => void
    onError?: (data: SseEventData) => void
    onDone?: (data: SseEventData) => void
    onOutput?: (data: SseEventData) => void
  },
) {
  resPromise
    .then(async (res) => {
      if (!res.body) { callbacks.onError?.({ message: 'No response body' }); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()!
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as SseEventData
              if (data.type === 'error' || line.includes('"error"')) callbacks.onError?.(data)
              else if (data.type === 'done' || data.type === 'complete') callbacks.onDone?.(data)
              else if (data.line !== undefined) callbacks.onOutput?.(data)
              else callbacks.onProgress?.(data)
            } catch {
              // ignore malformed SSE data
            }
          } else if (line.startsWith('event: ')) {
            // event name line — handled via data line that follows
          }
        }
      }
    })
    .catch((e) => {
      if (e.name !== 'AbortError') callbacks.onError?.({ message: e.message })
    })
}

/** Open an EventSource to a given API path. */
function openEventSource(path: string): EventSource {
  return new EventSource(`${BASE_URL}${path}`)
}

// ─── API client ───────────────────────────────────────────────────────────────

export const api = {
  // Network interfaces (for NIC selection)
  getNics(): Promise<NetworkInterface[]> {
    return get<NetworkInterface[]>('/api/nics')
  },

  // Profiles
  getProfiles(): Promise<Profile[]> {
    return get<Profile[]>('/api/profiles')
  },

  saveProfile(profile: Profile): Promise<Result> {
    return post<Result>('/api/profiles', profile)
  },

  applyProfile(name: string): Promise<Result> {
    return post<Result>(`/api/profiles/${encodeURIComponent(name)}/apply`)
  },

  deleteProfile(name: string): Promise<Result> {
    return del<Result>(`/api/profiles/${encodeURIComponent(name)}`)
  },

  // SSE — Network scan (GET with ReadableStream)
  scanNetwork(
    subnet: string, start: number, end: number, timeout?: number,
    onProgress?: (d: any) => void, onError?: (d: any) => void, onDone?: (d: any) => void,
  ) {
    const params = new URLSearchParams({
      subnet, start: String(start), end: String(end),
      ...(timeout ? { timeout: String(timeout) } : {}),
    })
    const ctrl = new AbortController()
    readSseStream(
      fetch(`${BASE_URL}/api/scan?${params.toString()}`, { signal: ctrl.signal }),
      { onProgress, onError, onDone },
    )
    return { cancel: () => ctrl.abort() }
  },

  // SSE — Profile deployment (POST with ReadableStream)
  deployProfile(
    server: string,
    profileName: string,
    credUser?: string,
    credPass?: string,
    onProgress?: (d: any) => void,
    onError?: (e: any) => void,
    onDone?: (d: any) => void,
  ) {
    const ctrl = new AbortController()
    const body: Record<string, string> = { server, profile: profileName }
    if (credUser) body.credential_user = credUser
    if (credPass) body.credential_pass = credPass

    readSseStream(
      fetch(`${BASE_URL}/api/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }),
      { onProgress, onError, onDone },
    )
    return { cancel: () => ctrl.abort() }
  },

  // Software packages
  getSoftware(): Promise<SoftwarePackage[]> {
    return get<SoftwarePackage[]>('/api/software')
  },

  addSoftware(pkg: Omit<SoftwarePackage, 'id' | 'size'>): Promise<{ success: boolean; package: SoftwarePackage }> {
    return post('/api/software', pkg)
  },

  deleteSoftware(id: string): Promise<Result> {
    return del<Result>(`/api/software/${id}`)
  },

  // SSE — Software installation (POST with ReadableStream)
  installSoftware(
    server: string,
    packageIds: string[],
    credUser?: string,
    credPass?: string,
    onProgress?: (d: any) => void,
    onError?: (e: any) => void,
    onDone?: (d: any) => void,
  ) {
    const ctrl = new AbortController()
    const body: Record<string, unknown> = { server, packages: packageIds }
    if (credUser) body.credential_user = credUser
    if (credPass) body.credential_pass = credPass

    readSseStream(
      fetch(`${BASE_URL}/api/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }),
      { onProgress, onError, onDone },
    )
    return { cancel: () => ctrl.abort() }
  },

  // SSE — Terminal: execute command (POST with ReadableStream)
  executeCommand(
    command: string,
    target?: string,
    credUser?: string,
    credPass?: string,
    onOutput?: (d: any) => void,
    onError?: (e: any) => void,
    onDone?: (d: any) => void,
  ) {
    const ctrl = new AbortController()
    const body: Record<string, string> = { command }
    if (target) body.target = target
    if (credUser) body.credential_user = credUser
    if (credPass) body.credential_pass = credPass

    readSseStream(
      fetch(`${BASE_URL}/api/terminal/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }),
      { onOutput, onError, onDone },
    )
    return { cancel: () => ctrl.abort() }
  },

  // SSE — Terminal: ping host (GET, uses EventSource)
  pingHost(
    target: string,
    count?: number,
    onOutput?: (d: any) => void,
    onError?: (e: any) => void,
    onDone?: (d: any) => void,
  ) {
    const ctrl = new AbortController()
    const params = new URLSearchParams({ target })
    if (count) params.set('count', String(count))

    readSseStream(
      fetch(`${BASE_URL}/api/terminal/ping?${params.toString()}`, {
        signal: ctrl.signal,
      }),
      { onOutput, onError, onDone },
    )
    return { cancel: () => ctrl.abort() }
  },

  // Setup script — PowerShell one-liner to enable WinRM on a target server
  getSetupScript(): Promise<{ oneLiner: string; scriptContent: string; instructions: string }> {
    return get('/api/setup-script')
  },

  // Diagnostic probe — tests all connectivity methods against a target IP
  probeServer(server: string, credUser?: string, credPass?: string): Promise<ProbeResult> {
    const body: Record<string, string> = { server }
    if (credUser) body.credential_user = credUser
    if (credPass) body.credential_pass = credPass
    return post<ProbeResult>('/api/probe', body)
  },

  // Identity — current machine info
  getIdentity(): Promise<IdentityInfo> {
    return get<IdentityInfo>('/api/identity')
  },

  // SMB shares — current shares on this machine
  getSmbShares(): Promise<SmbShare[]> {
    return get<SmbShare[]>('/api/smb')
  },

  // Network adapters — detailed adapter info
  getNetworkAdapters(): Promise<NetworkAdapterInfo[]> {
    return get<NetworkAdapterInfo[]>('/api/network/adapters')
  },

  // Apply profile locally
  applyProfileLocally(profileName: string): Promise<Result> {
    return post<Result>(`/api/profiles/${encodeURIComponent(profileName)}/apply`)
  },

  // ─── Telemetry ──────────────────────────────────────────────────────────────

  async getTelemetryHistory(range: string): Promise<TelemetrySnapshot[]> {
    return get<TelemetrySnapshot[]>(`/api/telemetry/history?range=${range}`)
  },

  async getTelemetryLatest(): Promise<TelemetrySnapshot> {
    return get<TelemetrySnapshot>('/api/telemetry/latest')
  },

  async triggerSnapshot(): Promise<TelemetrySnapshot> {
    return post<TelemetrySnapshot>('/api/telemetry/latest')
  },

  setTelemetryServers(ips: string[]): Promise<{ success: boolean }> {
    return post('/api/telemetry/servers', { ips })
  },

  getTelemetryServers(): Promise<{ servers: string[] }> {
    return get<{ servers: string[] }>('/api/telemetry/servers')
  },

  triggerDiscovery(opts?: { subnet?: string; start?: number; end?: number }): Promise<{ success: boolean; servers: string[] }> {
    return post('/api/telemetry/discover', opts ?? {})
  },

  updateTelemetryConfig(config: { pollIntervalMs?: number; retentionMs?: number }): Promise<{ success: boolean }> {
    return post('/api/telemetry/config', config)
  },

  // VFC status across fleet
  getVfcStatus(): Promise<{ servers: { mgmtIp: string; hostname: string; vfcs: { slot: number; type: string; status: string }[] }[] }> {
    return get('/api/vfc/status')
  },

  // Power control
  powerAction(ip: string, action: 'on' | 'off' | 'cycle'): Promise<{ success: boolean }> {
    return post(`/api/power/${action}`, { ip })
  },

  // Identify server (blink OLED/LED)
  identifyServer(ip: string): Promise<{ success: boolean }> {
    return post('/api/identify', { ip })
  },

  // LED strip control
  setLed(ip: string, r: number, g: number, b: number, mode?: string): Promise<{ success: boolean }> {
    return post('/api/led', { ip, r, g, b, mode: mode ?? 'static' })
  },

  // SSE — Telemetry stream (real-time push)
  telemetryStream(
    onSnapshot?: (d: TelemetrySnapshot) => void,
    onError?: (e: any) => void,
  ) {
    const es = new EventSource(`${BASE_URL}/api/telemetry/stream`)
    es.onmessage = (e) => {
      try {
        onSnapshot?.(JSON.parse(e.data))
      } catch {
        // ignore parse errors
      }
    }
    es.onerror = () => {
      onError?.({ message: 'SSE connection error' })
    }
    return { cancel: () => es.close() }
  },

  // ── SMC Discovery ──────────────────────────────────────────────────────────

  // SSE — SMC subnet scan. Returns EventSource.
  smcDiscover(subnet: string, start: number, end: number): EventSource {
    const params = new URLSearchParams({
      subnet,
      start: String(start),
      end: String(end),
    })
    return openEventSource(`/api/smc/discover?${params.toString()}`)
  },

  // Single SMC server probe
  smcProbe(ip: string): Promise<SmcProbeResult> {
    return get<SmcProbeResult>(`/api/smc/probe?ip=${encodeURIComponent(ip)}`)
  },

  // Set LED strip color
  smcSetLed(ip: string, ledMode: string, r: number, g: number, b: number, auth?: { user: string; pass: string }): Promise<Result> {
    return post<Result>('/api/smc/led', { ip, ledMode, ledR: r, ledG: g, ledB: b, auth })
  },

  // Flash identify (whoami)
  smcIdentify(ip: string): Promise<Result> {
    return post<Result>('/api/smc/identify', { ip })
  },

  // Change hostname via SMC
  smcSetHostname(ip: string, hostname: string, auth: { user: string; pass: string }): Promise<Result> {
    return post<Result>('/api/smc/hostname', { ip, hostname, auth })
  },

  // Push adapter IPs via SMC
  smcSetAdapters(ip: string, adapters: { mac: string; ipAddress: string; netmask: string }[], auth: { user: string; pass: string }): Promise<Result> {
    return post<Result>('/api/smc/adapters', { ip, adapters, auth })
  },

  // Power on/off/cycle
  smcPower(ip: string, action: 'on' | 'off' | 'cycle', auth: { user: string; pass: string }): Promise<Result> {
    return post<Result>('/api/smc/power', { ip, action, auth })
  },

  // Send OLED notification
  smcOled(ip: string, title: string, message: string, auth: { user: string; pass: string }): Promise<Result> {
    return post<Result>('/api/smc/oled', { ip, title, message, auth })
  },

  // Run LED FX animation across multiple servers (SSE stream via POST)
  smcRunFx(
    ips: string[], fx: string, speed?: number, loops?: number,
    color?: { r: number; g: number; b: number }, auth?: { user: string; pass: string },
    onProgress?: (d: any) => void, onError?: (e: any) => void, onDone?: (d: any) => void,
  ) {
    const ctrl = new AbortController()
    const body: Record<string, unknown> = { ips: ips.join(','), fx }
    if (speed) body.speed = speed
    if (loops) body.loops = loops
    if (color) { body.r = color.r; body.g = color.g; body.b = color.b }
    if (auth) body.auth = auth

    readSseStream(
      fetch(`${BASE_URL}/api/smc/fx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }),
      { onProgress, onError, onDone },
    )
    return { cancel: () => ctrl.abort() }
  },
}
