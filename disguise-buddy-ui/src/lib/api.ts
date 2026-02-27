import type {
  AdapterConfig,
  Profile,
  Result,
  SmbShare,
  IdentityInfo,
  DashboardData,
  DiscoveredServer,
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
  // Adapters
  getAdapters(): Promise<AdapterConfig[]> {
    return get<AdapterConfig[]>('/api/adapters')
  },

  configureAdapter(index: number, config: Partial<AdapterConfig>): Promise<Result> {
    return post<Result>(`/api/adapters/${index}/configure`, config)
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

  // SMB
  getSmb(): Promise<SmbShare[]> {
    return get<SmbShare[]>('/api/smb')
  },

  createShare(share: Omit<SmbShare, 'ShareState'>): Promise<Result> {
    return post<Result>('/api/smb/shares', share)
  },

  deleteShare(name: string): Promise<Result> {
    return del<Result>(`/api/smb/shares/${encodeURIComponent(name)}`)
  },

  // Identity
  getIdentity(): Promise<IdentityInfo> {
    return get<IdentityInfo>('/api/identity')
  },

  setHostname(name: string): Promise<Result> {
    return post<Result>('/api/identity', { hostname: name })
  },

  // Dashboard
  getDashboard(): Promise<DashboardData> {
    return get<DashboardData>('/api/dashboard')
  },

  // Discovery (fleet list)
  getDiscovery(): Promise<DiscoveredServer[]> {
    return get<DiscoveredServer[]>('/api/discovery')
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
  deployProfile(server: string, profileName: string): EventSource {
    const params = new URLSearchParams({ server, profile: profileName })
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
}
