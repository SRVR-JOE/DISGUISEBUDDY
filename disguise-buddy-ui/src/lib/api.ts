import type {
  Profile,
  Result,
  NetworkInterface,
  SoftwarePackage,
  ProbeResult,
  IdentityInfo,
  SmbShare,
} from '@/lib/types'

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:47100'

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

// TODO: Replace any callback types with proper interfaces from telemetry-types.ts
/** Read an SSE stream from a fetch Response and dispatch parsed events. */
function readSseStream(
  resPromise: Promise<Response>,
  callbacks: {
    onProgress?: (data: any) => void
    onError?: (data: any) => void
    onDone?: (data: any) => void
    onOutput?: (data: any) => void
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
              const data = JSON.parse(line.slice(6))
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
    const body: Record<string, any> = { server, packages: packageIds }
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
    const params = new URLSearchParams({ server })
    if (credUser) params.set('credential_user', credUser)
    if (credPass) params.set('credential_pass', credPass)
    return get<ProbeResult>(`/api/probe?${params.toString()}`)
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
  getNetworkAdapters(): Promise<any[]> {
    return get<any[]>('/api/network/adapters')
  },

  // Apply profile locally
  applyProfileLocally(profileName: string): Promise<Result> {
    return post<Result>(`/api/profiles/${encodeURIComponent(profileName)}/apply`)
  },

  // SMC Discovery — scan disguise MGMT ports for servers
  smcDiscover(
    subnet: string, start: number, end: number, timeout?: number,
    onProgress?: (d: any) => void, onError?: (d: any) => void, onDone?: (d: any) => void,
  ) {
    const params = new URLSearchParams({
      subnet, start: String(start), end: String(end),
      ...(timeout ? { timeout: String(timeout) } : {}),
    })
    const ctrl = new AbortController()
    readSseStream(
      fetch(`${BASE_URL}/api/smc/discover?${params.toString()}`, { signal: ctrl.signal }),
      { onProgress, onError, onDone },
    )
    return { cancel: () => ctrl.abort() }
  },

  // SMC Probe — get full details of a single server by MGMT IP
  smcProbe(ip: string): Promise<any> {
    return get<any>(`/api/smc/probe?ip=${encodeURIComponent(ip)}`)
  },

  // ─── Telemetry ──────────────────────────────────────────────────────────────

  async getTelemetryHistory(range: string): Promise<any[]> {
    return get<any[]>(`/api/telemetry/history?range=${range}`)
  },

  async getTelemetryLatest(): Promise<any> {
    return get<any>('/api/telemetry/latest')
  },

  async triggerSnapshot(): Promise<any> {
    return post<any>('/api/telemetry/latest')
  },

  setTelemetryServers(ips: string[]): Promise<any> {
    return post('/api/telemetry/servers', { ips })
  },

  getTelemetryServers(): Promise<{ servers: string[] }> {
    return get<{ servers: string[] }>('/api/telemetry/servers')
  },

  triggerDiscovery(opts?: { subnet?: string; start?: number; end?: number }): Promise<{ success: boolean; servers: string[] }> {
    return post('/api/telemetry/discover', opts ?? {})
  },

  updateTelemetryConfig(config: { pollIntervalMs?: number; retentionMs?: number }): Promise<any> {
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
    onSnapshot?: (d: any) => void,
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
}
