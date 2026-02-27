import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ─── Types (mirrored from src/lib/types.ts -- no path alias in electron layer) ──

interface AdapterConfig {
  Index: number
  Role: string
  DisplayName: string
  AdapterName: string
  IPAddress: string
  SubnetMask: string
  Gateway: string
  DNS1: string
  DNS2: string
  DHCP: boolean
  VLANID: number | null
  Enabled: boolean
}

interface SMBSettings {
  ShareD3Projects: boolean
  ProjectsPath: string
  ShareName: string
  SharePermissions: string
  AdditionalShares: SmbShare[]
}

interface Profile {
  Name: string
  Description: string
  Created: string
  Modified: string
  ServerName: string
  NetworkAdapters: AdapterConfig[]
  SMBSettings: SMBSettings
  CustomSettings: Record<string, unknown>
}

interface SmbShare {
  Name: string
  Path: string
  Description: string
  ShareState: string
  IsD3Share: boolean
}

interface IdentityInfo {
  Hostname: string
  Domain: string
  DomainType: string
  OSVersion: string
  Uptime: string
  SerialNumber: string
  Model: string
}

interface AdapterSummaryRow {
  role: string
  displayName: string
  ip: string
  status: string
  color: string
}

interface DashboardData {
  activeProfile: string
  adapterCount: string
  shareCount: string
  hostname: string
  adapterSummary: AdapterSummaryRow[]
}

interface DiscoveredServer {
  IPAddress: string
  Hostname: string
  IsDisguise: boolean
  ResponseTimeMs: number
  Ports: number[]
  APIVersion: string
}

interface Result {
  success: boolean
  message: string
}

// ─── Load profiles from disk ────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROFILES_DIR = path.resolve(__dirname, '..', '..', 'profiles')

// ─── Load profiles from disk ────────────────────────────────────────────────

function loadProfilesFromDisk(): Profile[] {
  try {
    if (!fs.existsSync(PROFILES_DIR)) {
      console.warn(`[mock-data] Profiles directory not found: ${PROFILES_DIR}`)
      return []
    }
    const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json')).sort()
    const profiles: Profile[] = []
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(PROFILES_DIR, file), 'utf-8')
        const data = JSON.parse(raw)
        // Ensure required fields exist with defaults
        profiles.push({
          Name: data.Name ?? path.basename(file, '.json'),
          Description: data.Description ?? '',
          Created: data.Created ?? new Date().toISOString(),
          Modified: data.Modified ?? new Date().toISOString(),
          ServerName: data.ServerName ?? '',
          NetworkAdapters: data.NetworkAdapters ?? [],
          SMBSettings: data.SMBSettings ?? {
            ShareD3Projects: true,
            ProjectsPath: 'D:\\d3 Projects',
            ShareName: 'd3 Projects',
            SharePermissions: 'Administrators:Full',
            AdditionalShares: [],
          },
          CustomSettings: data.CustomSettings ?? {},
        })
      } catch (err) {
        console.warn(`[mock-data] Failed to parse ${file}: ${err}`)
      }
    }
    console.log(`[mock-data] Loaded ${profiles.length} profiles from ${PROFILES_DIR}`)
    return profiles
  } catch (err) {
    console.error(`[mock-data] Error reading profiles directory: ${err}`)
    return []
  }
}

// ─── Mock data stores ─────────────────────────────────────────────────────────
// In-memory stores so mutation endpoints (save, delete, configure) are reflected
// within the same server session. Profiles are seeded from the real JSON files.

// Sort: Director first, then Actors numerically, then Understudies numerically
let mockProfiles: Profile[] = loadProfilesFromDisk().sort((a, b) => {
  const order = (name: string) => {
    if (name.startsWith('Director')) return 0
    if (name.startsWith('Actor')) return 1
    if (name.startsWith('Understudy')) return 2
    return 3
  }
  const oa = order(a.Name), ob = order(b.Name)
  if (oa !== ob) return oa - ob
  return a.Name.localeCompare(b.Name, undefined, { numeric: true })
})

// Default adapters come from Director profile (or a sensible fallback)
const directorProfile = mockProfiles.find(p => p.Name === 'Director')
let mockAdapters: AdapterConfig[] = directorProfile
  ? directorProfile.NetworkAdapters.map(a => ({ ...a }))
  : []

let mockSmb: SmbShare[] = [
  {
    Name: 'd3 Projects',
    Path: 'D:\\d3 Projects',
    Description: 'Main d3 projects share',
    ShareState: 'Online',
    IsD3Share: true,
  },
  {
    Name: 'Media',
    Path: 'E:\\Media',
    Description: 'Media asset storage',
    ShareState: 'Online',
    IsD3Share: false,
  },
]

const mockIdentity: IdentityInfo = {
  Hostname: 'DIRECTOR',
  Domain: 'WORKGROUP',
  DomainType: 'Workgroup',
  OSVersion: 'Windows 11 Pro (10.0.26100)',
  Uptime: '2d 14h 32m',
  SerialNumber: 'DGS-2024-00142',
  Model: 'disguise gx 3',
}

let activeProfileName = 'Director'

function buildDashboard(): DashboardData {
  const activeAdapters = mockAdapters.filter((a) => a.Enabled)
  const staticAdapters = activeAdapters.filter((a) => !a.DHCP && a.IPAddress !== '')

  const roleColors: Record<string, string> = {
    d3Net: 'blue',
    Media: 'purple',
    sACN: 'green',
    NDI: 'orange',
    '100G': 'gray',
  }

  const adapterSummary: AdapterSummaryRow[] = mockAdapters.map((a) => ({
    role: a.Role,
    displayName: a.DisplayName,
    ip: a.DHCP ? 'DHCP' : a.IPAddress || 'Unconfigured',
    status: a.Enabled ? (a.DHCP ? 'DHCP' : a.IPAddress ? 'Static' : 'No IP') : 'Disabled',
    color: roleColors[a.Role] ?? 'gray',
  }))

  return {
    activeProfile: activeProfileName,
    adapterCount: `${activeAdapters.length} / ${mockAdapters.length} Active`,
    shareCount: `${mockSmb.length} Share${mockSmb.length !== 1 ? 's' : ''}`,
    hostname: mockIdentity.Hostname,
    adapterSummary,
  }
}

// Build discovery list from loaded profiles (every profile with a d3Net IP becomes a "discovered" server)
const mockDiscovery: DiscoveredServer[] = mockProfiles
  .map((p, i) => {
    const d3Adapter = p.NetworkAdapters.find(a => a.Role === 'd3Net')
    const ip = d3Adapter?.IPAddress || ''
    if (!ip) return null
    return {
      IPAddress: ip,
      Hostname: p.ServerName,
      IsDisguise: true,
      ResponseTimeMs: 2 + i * 2,
      Ports: [80, 873, 9864],
      APIVersion: 'r27.4',
    }
  })
  .filter((s): s is DiscoveredServer => s !== null)

// ─── Public interface ─────────────────────────────────────────────────────────

export function getAdapters(): AdapterConfig[] {
  return mockAdapters
}

export function configureAdapter(index: number, config: Partial<AdapterConfig>): Result {
  const adapter = mockAdapters.find((a) => a.Index === index)
  if (!adapter) {
    return { success: false, message: `No adapter at index ${index}` }
  }
  Object.assign(adapter, config)
  return { success: true, message: `Adapter ${index} updated` }
}

export function getProfiles(): Profile[] {
  return mockProfiles
}

export function saveProfile(profile: Profile): Result {
  const now = new Date().toISOString()
  const existing = mockProfiles.findIndex((p) => p.Name === profile.Name)
  if (existing >= 0) {
    mockProfiles[existing] = { ...profile, Modified: now }
  } else {
    mockProfiles.push({ ...profile, Created: now, Modified: now })
  }
  // Persist to disk
  try {
    const safeName = profile.Name.replace(/[\\/:*?"<>|]/g, '_')
    const filePath = path.join(PROFILES_DIR, `${safeName}.json`)
    fs.writeFileSync(filePath, JSON.stringify(mockProfiles.find(p => p.Name === profile.Name), null, 4), 'utf-8')
  } catch (err) {
    console.warn(`[mock-data] Failed to write profile to disk: ${err}`)
  }
  return { success: true, message: `Profile "${profile.Name}" ${existing >= 0 ? 'updated' : 'created'}` }
}

export function applyProfile(name: string): Result {
  const profile = mockProfiles.find((p) => p.Name === name)
  if (!profile) {
    return { success: false, message: `Profile "${name}" not found` }
  }
  activeProfileName = name
  mockAdapters = profile.NetworkAdapters.map((a) => ({ ...a }))
  return { success: true, message: `Profile "${name}" applied` }
}

export function deleteProfile(name: string): Result {
  const before = mockProfiles.length
  mockProfiles = mockProfiles.filter((p) => p.Name !== name)
  if (mockProfiles.length === before) {
    return { success: false, message: `Profile "${name}" not found` }
  }
  if (activeProfileName === name) activeProfileName = ''
  return { success: true, message: `Profile "${name}" deleted` }
}

export function getSmb(): SmbShare[] {
  return mockSmb
}

export function createShare(share: Omit<SmbShare, 'ShareState'>): Result {
  const exists = mockSmb.some((s) => s.Name === share.Name)
  if (exists) {
    return { success: false, message: `Share "${share.Name}" already exists` }
  }
  mockSmb.push({ ...share, ShareState: 'Online' })
  return { success: true, message: `Share "${share.Name}" created` }
}

export function deleteShare(name: string): Result {
  const before = mockSmb.length
  mockSmb = mockSmb.filter((s) => s.Name !== name)
  if (mockSmb.length === before) {
    return { success: false, message: `Share "${name}" not found` }
  }
  return { success: true, message: `Share "${name}" deleted` }
}

export function getIdentity(): IdentityInfo {
  return mockIdentity
}

export function setHostname(name: string): Result {
  if (!name || name.length > 15) {
    return { success: false, message: 'Hostname must be 1–15 characters' }
  }
  mockIdentity.Hostname = name.toUpperCase()
  return { success: true, message: `Hostname set to "${mockIdentity.Hostname}"` }
}

export function getDashboard(): DashboardData {
  return buildDashboard()
}

export function getDiscovery(): DiscoveredServer[] {
  return mockDiscovery
}

// ─── Generic dispatcher (used by api-server for routing convenience) ──────────

export function getMockData(endpoint: string): unknown {
  if (endpoint === '/api/adapters')   return getAdapters()
  if (endpoint === '/api/profiles')   return getProfiles()
  if (endpoint === '/api/smb')        return getSmb()
  if (endpoint === '/api/identity')   return getIdentity()
  if (endpoint === '/api/dashboard')  return getDashboard()
  if (endpoint === '/api/discovery')  return getDiscovery()
  return null
}
