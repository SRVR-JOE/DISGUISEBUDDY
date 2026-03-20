import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

// ESM-compatible require — used to conditionally load 'electron' without a
// static top-level import so that this module also works in the dev-server
// context (plain Node.js, no Electron runtime present).
const _require = createRequire(import.meta.url)

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

/**
 * Resolve a resource path that works in both dev and packaged Electron builds.
 *
 * - In a packaged app: extraResources are unpacked to process.resourcesPath,
 *   so we look there instead of relative to __dirname (which is inside the
 *   asar archive and cannot reach sibling directories on disk).
 * - In dev / dev-server (plain Node.js): falls back to __dirname-relative path
 *   two levels up — i.e. the repo root.
 * - If 'electron' is not available at all (e.g. dev-server.ts), the try/catch
 *   silently falls through to the fallback.
 */
function getResourcePath(relativePath: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { app } = _require('electron') as { app: any }
    if (app?.isPackaged) {
      return path.join(process.resourcesPath, relativePath)
    }
  } catch {
    // Not running inside Electron (e.g. tsx electron/dev-server.ts)
  }
  return path.resolve(__dirname, '..', '..', relativePath)
}

const PROFILES_DIR = getResourcePath('profiles')

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

// Use globalThis to ensure a single profile store even if the module is loaded
// twice (tsx can resolve .js and .ts as separate module instances on Windows).
const STORE_KEY = '__disguiseBuddyProfileStore__'

function getOrInitProfiles(): Profile[] {
  if (!(globalThis as any)[STORE_KEY]) {
    const loaded = loadProfilesFromDisk().sort((a, b) => {
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
    ;(globalThis as any)[STORE_KEY] = loaded
  }
  return (globalThis as any)[STORE_KEY]
}

// Initialize eagerly so the log fires at startup
getOrInitProfiles()

// ─── Profile API ──────────────────────────────────────────────────────────────

export function getProfiles(): Profile[] {
  return getOrInitProfiles()
}

export function saveProfile(profile: Profile): Result {
  const profiles = getOrInitProfiles()
  const now = new Date().toISOString()
  const existing = profiles.findIndex((p) => p.Name === profile.Name)
  const updatedProfile = existing >= 0
    ? { ...profile, Modified: now }
    : { ...profile, Created: now, Modified: now }

  // Write to disk BEFORE mutating in-memory array so a failed write
  // does not leave the store in a diverged state.
  try {
    const safeName = profile.Name.replace(/[\\/:*?"<>|]/g, '_')
    const filePath = path.join(PROFILES_DIR, `${safeName}.json`)
    fs.writeFileSync(filePath, JSON.stringify(updatedProfile, null, 4), 'utf-8')
  } catch (err) {
    console.error(`[profile-store] Failed to write profile to disk: ${err}`)
    return { success: false, message: `Failed to save profile to disk: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Disk write succeeded — now update in-memory state
  if (existing >= 0) {
    profiles[existing] = updatedProfile
  } else {
    profiles.push(updatedProfile)
  }
  return { success: true, message: `Profile "${profile.Name}" ${existing >= 0 ? 'updated' : 'created'}` }
}

export function deleteProfile(name: string): Result {
  const profiles = getOrInitProfiles()
  const idx = profiles.findIndex((p) => p.Name === name)
  if (idx === -1) {
    return { success: false, message: `Profile "${name}" not found` }
  }

  // Delete from disk BEFORE mutating in-memory array so a failed delete
  // does not leave the store in a diverged state.
  try {
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_')
    const filePath = path.join(PROFILES_DIR, `${safeName}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (err) {
    console.error(`[profile-store] Failed to delete profile file from disk: ${err}`)
    return { success: false, message: `Failed to delete profile file: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Disk succeeded — now remove from memory
  const updatedProfiles = profiles.filter((p) => p.Name !== name)
  ;(globalThis as any)[STORE_KEY] = updatedProfiles
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
