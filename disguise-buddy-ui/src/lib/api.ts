import type {
  Profile,
  Result,
  NetworkInterface,
  SoftwarePackage,
  ProbeResult,
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

// ─── SSE helper ───────────────────────────────────────────────────────────────

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

  // SSE — Network scan
  // Returns an EventSource. Caller is responsible for attaching handlers and closing it.
  scanNetwork(subnet: string, start: number, end: number): EventSource {
    const params = new URLSearchParams({
      subnet,
      start: String(start),
      end: String(end),
    })
    return openEventSource(`/api/scan?${params.toString()}`)
  },

  // SSE — Profile deployment
  // Returns an EventSource. Caller is responsible for attaching handlers and closing it.
  deployProfile(server: string, profileName: string, credUser?: string, credPass?: string): EventSource {
    const params = new URLSearchParams({ server, profile: profileName })
    if (credUser) params.set('credential_user', credUser)
    if (credPass) params.set('credential_pass', credPass)
    return openEventSource(`/api/deploy?${params.toString()}`)
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

  // SSE — Software installation
  // Returns an EventSource. Caller is responsible for attaching handlers and closing it.
  installSoftware(server: string, packageIds: string[]): EventSource {
    const params = new URLSearchParams({ server, packages: packageIds.join(',') })
    return openEventSource(`/api/install?${params.toString()}`)
  },

  // SSE — Terminal: execute command
  // Returns an EventSource. Caller is responsible for attaching handlers and closing it.
  executeCommand(command: string, server?: string): EventSource {
    const params = new URLSearchParams({ command })
    if (server) params.set('server', server)
    return openEventSource(`/api/terminal/execute?${params.toString()}`)
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

  // SSE — Terminal: ping host
  // Returns an EventSource. Caller is responsible for attaching handlers and closing it.
  pingHost(target: string, count?: number): EventSource {
    const params = new URLSearchParams({ target })
    if (count) params.set('count', String(count))
    return openEventSource(`/api/terminal/ping?${params.toString()}`)
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
  smcProbe(ip: string): Promise<any> {
    return get(`/api/smc/probe?ip=${encodeURIComponent(ip)}`)
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

  // Run LED FX animation across multiple servers (SSE stream)
  smcRunFx(ips: string[], fx: string, speed?: number, loops?: number, color?: { r: number; g: number; b: number }, auth?: { user: string; pass: string }): EventSource {
    const params = new URLSearchParams({ ips: ips.join(','), fx })
    if (speed) params.set('speed', String(speed))
    if (loops) params.set('loops', String(loops))
    if (color) {
      params.set('r', String(color.r))
      params.set('g', String(color.g))
      params.set('b', String(color.b))
    }
    if (auth) {
      params.set('auth_user', auth.user)
      params.set('auth_pass', auth.pass)
    }
    return openEventSource(`/api/smc/fx?${params.toString()}`)
  },
}
