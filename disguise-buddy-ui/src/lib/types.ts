// ─── Profile & Adapter types ─────────────────────────────────────────────────

export interface Profile {
  Name: string
  Description: string
  Created: string
  Modified: string
  ServerName: string
  NetworkAdapters: AdapterConfig[]
  SMBSettings: SMBSettings
  CustomSettings: Record<string, unknown>
}

export interface AdapterConfig {
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

export interface SMBSettings {
  ShareD3Projects: boolean
  ProjectsPath: string
  ShareName: string
  SharePermissions: string
  AdditionalShares: SmbShare[]
}

// ─── SMB & Identity ──────────────────────────────────────────────────────────

export interface SmbShare {
  Name: string
  Path: string
  Description: string
  ShareState: string
  IsD3Share: boolean
}

export interface IdentityInfo {
  Hostname: string
  Domain: string
  DomainType: string
  OSVersion: string
  Uptime: string
  SerialNumber: string
  Model: string
}

// ─── Generic result ──────────────────────────────────────────────────────────

export interface Result {
  success: boolean
  message: string
}

// ─── Network discovery ───────────────────────────────────────────────────────

export interface DiscoveredServer {
  IPAddress: string
  Hostname: string
  IsDisguise: boolean
  ResponseTimeMs: number
  Ports: number[]
  APIVersion: string
}

// ─── Network interface for NIC selection ─────────────────────────────────────

export interface NetworkInterface {
  name: string       // e.g., "Ethernet 2", "Wi-Fi"
  address: string    // e.g., "192.168.10.100"
  netmask: string    // e.g., "255.255.255.0"
  mac: string        // MAC address
  cidr: string       // e.g., "192.168.10.100/24"
}

// ─── Software installation ────────────────────────────────────────────────────

export interface SoftwarePackage {
  id: string
  name: string
  version: string
  filename: string
  path: string
  silentArgs: string
  size: number
  description: string
}

export interface InstallProgress {
  packageId: string
  packageName: string
  step: 'copying' | 'installing' | 'verifying' | 'done' | 'error'
  percent: number
  message: string
}

export interface InstallResult {
  success: boolean
  installed: string[]
  failed: string[]
}

// ─── Terminal types ────────────────────────────────────────────────────────────

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}
