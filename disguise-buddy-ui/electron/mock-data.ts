import fs from 'fs'
import os from 'os'
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

interface Result {
  success: boolean
  message: string
}

export interface NetworkInterface {
  name: string
  address: string
  netmask: string
  mac: string
  cidr: string
}

// ─── Profiles directory ────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROFILES_DIR = path.resolve(__dirname, '..', '..', 'profiles')

// ─── Load profiles from disk ──────────────────────────────────────────────────

function loadProfilesFromDisk(): Profile[] {
  try {
    if (!fs.existsSync(PROFILES_DIR)) {
      console.warn(`[profile-store] Profiles directory not found: ${PROFILES_DIR}`)
      return []
    }
    const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json')).sort()
    const profiles: Profile[] = []
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(PROFILES_DIR, file), 'utf-8')
        const data = JSON.parse(raw)
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
        console.warn(`[profile-store] Failed to parse ${file}: ${err}`)
      }
    }
    console.log(`[profile-store] Loaded ${profiles.length} profiles from ${PROFILES_DIR}`)
    return profiles
  } catch (err) {
    console.error(`[profile-store] Error reading profiles directory: ${err}`)
    return []
  }
}

// ─── In-memory profile store (seeded from disk) ───────────────────────────────

// Sort: Director first, then Actors numerically, then Understudies numerically
let profiles: Profile[] = loadProfilesFromDisk().sort((a, b) => {
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

// ─── Profile API ──────────────────────────────────────────────────────────────

export function getProfiles(): Profile[] {
  return profiles
}

export function saveProfile(profile: Profile): Result {
  const now = new Date().toISOString()
  const existing = profiles.findIndex((p) => p.Name === profile.Name)
  if (existing >= 0) {
    profiles[existing] = { ...profile, Modified: now }
  } else {
    profiles.push({ ...profile, Created: now, Modified: now })
  }
  try {
    const safeName = profile.Name.replace(/[\\/:*?"<>|]/g, '_')
    const filePath = path.join(PROFILES_DIR, `${safeName}.json`)
    fs.writeFileSync(
      filePath,
      JSON.stringify(profiles.find(p => p.Name === profile.Name), null, 4),
      'utf-8',
    )
  } catch (err) {
    console.warn(`[profile-store] Failed to write profile to disk: ${err}`)
  }
  return { success: true, message: `Profile "${profile.Name}" ${existing >= 0 ? 'updated' : 'created'}` }
}

export function deleteProfile(name: string): Result {
  const before = profiles.length
  profiles = profiles.filter((p) => p.Name !== name)
  if (profiles.length === before) {
    return { success: false, message: `Profile "${name}" not found` }
  }
  return { success: true, message: `Profile "${name}" deleted` }
}

// ─── Network interface listing ────────────────────────────────────────────────

export function getNetworkInterfaces(): NetworkInterface[] {
  const result: NetworkInterface[] = []
  const ifaces = os.networkInterfaces()

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue
    for (const addr of addrs) {
      // Only include non-internal IPv4 interfaces
      if (addr.family !== 'IPv4' || addr.internal) continue
      result.push({
        name,
        address: addr.address,
        netmask: addr.netmask,
        mac: addr.mac,
        cidr: addr.cidr ?? '',
      })
    }
  }

  return result
}
