import type {
  Profile,
  Result,
  NetworkInterface,
  SoftwarePackage,
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

  // SSE — Terminal: ping host
  // Returns an EventSource. Caller is responsible for attaching handlers and closing it.
  pingHost(target: string, count?: number): EventSource {
    const params = new URLSearchParams({ target })
    if (count) params.set('count', String(count))
    return openEventSource(`/api/terminal/ping?${params.toString()}`)
  },
}
