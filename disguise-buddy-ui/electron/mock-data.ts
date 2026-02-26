// ─── Types (mirrored from src/lib/types.ts — no path alias in electron layer) ──

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

// ─── Shared adapter template ──────────────────────────────────────────────────

function makeAdapter(
  index: number,
  role: string,
  displayName: string,
  adapterName: string,
  ip: string,
  subnet: string,
  dhcp: boolean,
  enabled: boolean,
): AdapterConfig {
  return {
    Index: index,
    Role: role,
    DisplayName: displayName,
    AdapterName: adapterName,
    IPAddress: ip,
    SubnetMask: subnet,
    Gateway: '',
    DNS1: '',
    DNS2: '',
    DHCP: dhcp,
    VLANID: null,
    Enabled: enabled,
  }
}

// ─── Mock data stores ─────────────────────────────────────────────────────────

// In-memory stores so mutation endpoints (save, delete, configure) are reflected
// within the same server session.
let mockAdapters: AdapterConfig[] = [
  makeAdapter(0, 'd3Net', 'NIC A - d3 Network',    'NIC A', '192.168.10.11', '255.255.255.0', false, true),
  makeAdapter(1, 'sACN',  'NIC B - Lighting',       'NIC B', '',              '',              true,  true),
  makeAdapter(2, 'Media', 'NIC C - Media Network',  'NIC C', '192.168.20.11', '255.255.255.0', false, true),
  makeAdapter(3, 'NDI',   'NIC D - NDI Video',      'NIC D', '',              '',              true,  true),
  makeAdapter(4, '100G',  'NIC E - 100G',           'NIC E', '',              '',              true,  true),
  makeAdapter(5, '100G',  'NIC F - 100G',           'NIC F', '',              '',              true,  true),
]

const directorAdapters = (): AdapterConfig[] => [
  makeAdapter(0, 'd3Net', 'NIC A - d3 Network',    'NIC A', '192.168.10.11', '255.255.255.0', false, true),
  makeAdapter(1, 'sACN',  'NIC B - Lighting (sACN/Art-Net)', 'NIC B', '', '', true, true),
  makeAdapter(2, 'Media', 'NIC C - Media Network',  'NIC C', '192.168.20.11', '255.255.255.0', false, true),
  makeAdapter(3, 'NDI',   'NIC D - NDI Video',      'NIC D', '', '', true, true),
  makeAdapter(4, '100G',  'NIC E - 100G',           'NIC E', '', '', true, true),
  makeAdapter(5, '100G',  'NIC F - 100G',           'NIC F', '', '', true, true),
]

const actor01Adapters = (): AdapterConfig[] => [
  makeAdapter(0, 'd3Net', 'NIC A - d3 Network',    'NIC A', '192.168.10.21', '255.255.255.0', false, true),
  makeAdapter(1, 'sACN',  'NIC B - Lighting (sACN/Art-Net)', 'NIC B', '', '', true, true),
  makeAdapter(2, 'Media', 'NIC C - Media Network',  'NIC C', '192.168.20.21', '255.255.255.0', false, true),
  makeAdapter(3, 'NDI',   'NIC D - NDI Video',      'NIC D', '', '', true, true),
  makeAdapter(4, '100G',  'NIC E - 100G',           'NIC E', '', '', true, true),
  makeAdapter(5, '100G',  'NIC F - 100G',           'NIC F', '', '', true, true),
]

const actor02Adapters = (): AdapterConfig[] => [
  makeAdapter(0, 'd3Net', 'NIC A - d3 Network',    'NIC A', '192.168.10.22', '255.255.255.0', false, true),
  makeAdapter(1, 'sACN',  'NIC B - Lighting (sACN/Art-Net)', 'NIC B', '', '', true, true),
  makeAdapter(2, 'Media', 'NIC C - Media Network',  'NIC C', '192.168.20.22', '255.255.255.0', false, true),
  makeAdapter(3, 'NDI',   'NIC D - NDI Video',      'NIC D', '', '', true, true),
  makeAdapter(4, '100G',  'NIC E - 100G',           'NIC E', '', '', true, true),
  makeAdapter(5, '100G',  'NIC F - 100G',           'NIC F', '', '', true, true),
]

const understudy01Adapters = (): AdapterConfig[] => [
  makeAdapter(0, 'd3Net', 'NIC A - d3 Network',    'NIC A', '192.168.10.31', '255.255.255.0', false, true),
  makeAdapter(1, 'sACN',  'NIC B - Lighting (sACN/Art-Net)', 'NIC B', '', '', true, true),
  makeAdapter(2, 'Media', 'NIC C - Media Network',  'NIC C', '', '', true, false),
  makeAdapter(3, 'NDI',   'NIC D - NDI Video',      'NIC D', '', '', true, true),
  makeAdapter(4, '100G',  'NIC E - 100G',           'NIC E', '', '', true, true),
  makeAdapter(5, '100G',  'NIC F - 100G',           'NIC F', '', '', true, true),
]

const directorSMB: SMBSettings = {
  ShareD3Projects: true,
  ProjectsPath: 'D:\\d3 Projects',
  ShareName: 'd3 Projects',
  SharePermissions: 'Administrators:Full',
  AdditionalShares: [],
}

let mockProfiles: Profile[] = [
  {
    Name: 'Director',
    Description: 'Director server - sequences the show, sends start commands to Actors',
    Created: '2026-02-18T00:00:00',
    Modified: '2026-02-18T00:00:00',
    ServerName: 'DIRECTOR',
    NetworkAdapters: directorAdapters(),
    SMBSettings: directorSMB,
    CustomSettings: {},
  },
  {
    Name: 'Actor-01',
    Description: 'Actor 1 server - outputs video according to assigned Feed scenes',
    Created: '2026-02-18T00:00:00',
    Modified: '2026-02-18T00:00:00',
    ServerName: 'ACTOR-01',
    NetworkAdapters: actor01Adapters(),
    SMBSettings: { ...directorSMB },
    CustomSettings: {},
  },
  {
    Name: 'Actor-02',
    Description: 'Actor 2 server - outputs video according to assigned Feed scenes',
    Created: '2026-02-18T00:00:00',
    Modified: '2026-02-18T00:00:00',
    ServerName: 'ACTOR-02',
    NetworkAdapters: actor02Adapters(),
    SMBSettings: { ...directorSMB },
    CustomSettings: {},
  },
  {
    Name: 'Understudy-01',
    Description: 'Understudy 1 server - failover machine, can take over from any Actor',
    Created: '2026-02-18T00:00:00',
    Modified: '2026-02-18T00:00:00',
    ServerName: 'USTUDY-01',
    NetworkAdapters: understudy01Adapters(),
    SMBSettings: { ...directorSMB },
    CustomSettings: {},
  },
]

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

const mockDiscovery: DiscoveredServer[] = [
  {
    IPAddress: '192.168.10.11',
    Hostname: 'DIRECTOR',
    IsDisguise: true,
    ResponseTimeMs: 4,
    Ports: [80, 873, 9864],
    APIVersion: 'r27.4',
  },
  {
    IPAddress: '192.168.10.21',
    Hostname: 'ACTOR-01',
    IsDisguise: true,
    ResponseTimeMs: 6,
    Ports: [80, 873, 9864],
    APIVersion: 'r27.4',
  },
  {
    IPAddress: '192.168.10.22',
    Hostname: 'ACTOR-02',
    IsDisguise: true,
    ResponseTimeMs: 8,
    Ports: [80, 873, 9864],
    APIVersion: 'r27.4',
  },
]

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
    return { success: true, message: `Profile "${profile.Name}" updated` }
  }
  mockProfiles.push({ ...profile, Created: now, Modified: now })
  return { success: true, message: `Profile "${profile.Name}" created` }
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
