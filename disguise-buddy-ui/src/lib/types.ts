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

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardData {
  activeProfile: string
  adapterCount: string
  shareCount: string
  hostname: string
  adapterSummary: AdapterSummaryRow[]
}

export interface AdapterSummaryRow {
  role: string
  displayName: string
  ip: string
  status: string
  color: string
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
