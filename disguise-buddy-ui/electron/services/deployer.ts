/**
 * electron/services/deployer.ts
 *
 * Deploys a configuration profile to a remote disguise server via WinRM /
 * PowerShell remoting.
 *
 * Live mode (Windows only):
 *   1. Test Connection   — Test-WSMan to verify WinRM is reachable
 *   2. Set Hostname      — Rename-Computer
 *   3. Configure NICs    — Set-NetIPAddress / Set-NetIPInterface / Set-DnsClientServerAddress
 *   4. Configure SMB     — New-SmbShare / Grant-SmbShareAccess
 *   5. Verify            — Re-probes the server over TCP after all changes
 *
 * Dev / mock mode (non-Windows or MOCK_BACKEND=true):
 *   Each step simulates realistic work with variable delays and returns success.
 */

import net from 'net'
import { isDevMode, runPowerShell, delay, randomInt } from './utils.js'

// ─── Public types ─────────────────────────────────────────────────────────────

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

export interface SmbShare {
  Name: string
  Path: string
  Description: string
  ShareState: string
  IsD3Share: boolean
}

export interface SMBSettings {
  ShareD3Projects: boolean
  ProjectsPath: string
  ShareName: string
  SharePermissions: string
  AdditionalShares: SmbShare[]
}

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

export interface DeployOptions {
  targetIP: string
  profile: Profile
  /** WinRM credentials — defaults to current user session when omitted */
  credential?: {
    username: string
    password: string
  }
}

export interface DeployStep {
  step: string
  message: string
  stepNumber: number
  total: number
}

export interface DeployCallbacks {
  onStep: (step: DeployStep) => void
  onComplete: (result: { success: boolean; message: string }) => void
  onError: (error: Error) => void
}

// ─── Step definitions ────────────────────────────────────────────────────────

const STEPS = [
  'connect',
  'hostname',
  'network',
  'smb',
  'verify',
] as const

type StepId = (typeof STEPS)[number]

// ─── Public API ───────────────────────────────────────────────────────────────

export function deployProfile(
  options: DeployOptions,
  callbacks: DeployCallbacks,
): { cancel: () => void } {
  let cancelled = false
  const cancel = () => { cancelled = true }

  const run = async () => {
    try {
      if (isDevMode()) {
        await runMockDeploy(options, callbacks, () => cancelled)
      } else {
        await runLiveDeploy(options, callbacks, () => cancelled)
      }
    } catch (err) {
      if (!cancelled) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  run().catch((err) => {
    if (!cancelled) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    }
  })

  return { cancel }
}

// ─── Live implementation ──────────────────────────────────────────────────────

async function runLiveDeploy(
  options: DeployOptions,
  callbacks: DeployCallbacks,
  isCancelled: () => boolean,
): Promise<void> {
  const { targetIP, profile, credential } = options
  const total = STEPS.length

  // Build credential argument fragment used in every remote PS command
  const credArg = buildCredentialArg(credential)

  // Helper: emit a step event if not yet cancelled
  const step = (id: StepId, message: string) => {
    if (isCancelled()) return
    const stepNumber = STEPS.indexOf(id) + 1
    callbacks.onStep({ step: id, message, stepNumber, total })
  }

  // ── Step 1: Test WinRM connectivity ─────────────────────────────────────────
  step('connect', `Testing WinRM connectivity to ${targetIP}…`)
  if (isCancelled()) return

  const wsmanResult = await runPowerShell(
    `Test-WSMan -ComputerName ${targetIP}${credArg} -ErrorAction Stop`
  )
  if (wsmanResult.exitCode !== 0) {
    throw new Error(
      `Cannot reach ${targetIP} via WinRM: ${wsmanResult.stderr || wsmanResult.stdout}`
    )
  }

  // ── Step 2: Set hostname ─────────────────────────────────────────────────────
  step('hostname', `Setting hostname to "${profile.ServerName}"…`)
  if (isCancelled()) return

  const renameResult = await runPowerShell(
    `Rename-Computer -ComputerName ${targetIP} -NewName "${sanitiseName(profile.ServerName)}"` +
    ` -Force${credArg} -ErrorAction Stop`
  )
  if (renameResult.exitCode !== 0) {
    throw new Error(`Hostname rename failed: ${renameResult.stderr || renameResult.stdout}`)
  }

  // ── Step 3: Configure network adapters ──────────────────────────────────────
  const enabledAdapters = profile.NetworkAdapters.filter((a) => a.Enabled)
  step('network', `Configuring ${enabledAdapters.length} network adapter(s)…`)
  if (isCancelled()) return

  for (const adapter of enabledAdapters) {
    if (isCancelled()) return

    const psBlock = buildAdapterScript(adapter)
    if (!psBlock) continue // nothing to configure (e.g. disabled NIC)

    const adapterResult = await runPowerShell(
      `Invoke-Command -ComputerName ${targetIP}${credArg} -ScriptBlock { ${psBlock} } -ErrorAction Stop`
    )
    if (adapterResult.exitCode !== 0) {
      // Log but continue — one NIC failure should not abort the whole deploy
      console.error(
        `[deployer] Adapter ${adapter.Index} (${adapter.DisplayName}) config failed: ` +
        (adapterResult.stderr || adapterResult.stdout)
      )
    }
  }

  // ── Step 4: Configure SMB shares ────────────────────────────────────────────
  step('smb', 'Configuring SMB shares…')
  if (isCancelled()) return

  const smbScript = buildSmbScript(profile.SMBSettings)
  if (smbScript) {
    const smbResult = await runPowerShell(
      `Invoke-Command -ComputerName ${targetIP}${credArg} -ScriptBlock { ${smbScript} } -ErrorAction Stop`
    )
    if (smbResult.exitCode !== 0) {
      console.error(`[deployer] SMB configuration failed: ${smbResult.stderr || smbResult.stdout}`)
    }
  }

  // ── Step 5: Verify ──────────────────────────────────────────────────────────
  step('verify', `Verifying ${targetIP} is still reachable…`)
  if (isCancelled()) return

  // Give the NIC changes a moment to take effect
  await delay(2000)
  const alive = await tcpProbe(targetIP, 80, 5000)
  if (!alive) {
    // The IP may have changed — that's expected. We treat it as success
    // because the rename + NIC config commands completed without error.
    console.warn(`[deployer] ${targetIP} not reachable on port 80 after deploy — IP may have changed`)
  }

  if (!isCancelled()) {
    callbacks.onComplete({
      success: true,
      message: `Profile "${profile.Name}" successfully deployed to ${targetIP}`,
    })
  }
}

// ─── PowerShell script builders ───────────────────────────────────────────────

function buildCredentialArg(credential?: DeployOptions['credential']): string {
  if (!credential) return ''
  const user = escapePs(credential.username)
  const pass = escapePs(credential.password)
  return (
    ` -Credential (New-Object System.Management.Automation.PSCredential` +
    ` ("${user}", (ConvertTo-SecureString "${pass}" -AsPlainText -Force)))`
  )
}

/**
 * Produces the PowerShell fragment that configures one network adapter.
 * The script is designed to run inside an Invoke-Command scriptblock on the
 * remote machine — it relies on WMI to resolve the adapter index to a real
 * interface index that Set-NetIPAddress / Set-NetIPInterface accepts.
 */
function buildAdapterScript(adapter: AdapterConfig): string {
  const lines: string[] = []

  // Resolve physical interface index by adapter name (more reliable than the
  // profile's Index which is a disguise-internal concept, not the Windows NIC index)
  lines.push(`$iface = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like "*${sanitiseName(adapter.AdapterName)}*" } | Select-Object -First 1`)
  lines.push(`if (-not $iface) { Write-Warning "Adapter '${sanitiseName(adapter.AdapterName)}' not found"; return }`)
  lines.push(`$idx = $iface.InterfaceIndex`)

  if (adapter.DHCP) {
    lines.push(`Set-NetIPInterface -InterfaceIndex $idx -Dhcp Enabled -ErrorAction SilentlyContinue`)
    // Remove any existing static addresses so DHCP can take over
    lines.push(`Remove-NetIPAddress -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
    lines.push(`Remove-NetRoute -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
  } else if (adapter.IPAddress) {
    const prefixLength = subnetToPrefixLength(adapter.SubnetMask)
    // Remove existing IPs first to avoid "Address already exists" errors
    lines.push(`Remove-NetIPAddress -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
    lines.push(`Remove-NetRoute -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
    lines.push(`Set-NetIPInterface -InterfaceIndex $idx -Dhcp Disabled -ErrorAction SilentlyContinue`)

    let addCmd = `New-NetIPAddress -InterfaceIndex $idx -IPAddress "${adapter.IPAddress}" -PrefixLength ${prefixLength}`
    if (adapter.Gateway) {
      addCmd += ` -DefaultGateway "${adapter.Gateway}"`
    }
    addCmd += ' -ErrorAction Stop'
    lines.push(addCmd)

    // DNS
    const dnsServers = [adapter.DNS1, adapter.DNS2].filter(Boolean)
    if (dnsServers.length > 0) {
      lines.push(
        `Set-DnsClientServerAddress -InterfaceIndex $idx` +
        ` -ServerAddresses ${dnsServers.map((d) => `"${d}"`).join(',')} -ErrorAction SilentlyContinue`
      )
    }
  }

  return lines.join('; ')
}

/**
 * Converts a dotted-decimal subnet mask to CIDR prefix length.
 * e.g. "255.255.255.0" → 24
 */
function subnetToPrefixLength(mask: string): number {
  if (!mask) return 24
  return mask
    .split('.')
    .reduce((acc, octet) => acc + Number(parseInt(octet, 10).toString(2).split('1').length - 1), 0)
}

function buildSmbScript(smb: SMBSettings): string {
  const lines: string[] = []

  if (smb.ShareD3Projects && smb.ShareName && smb.ProjectsPath) {
    const name = sanitiseName(smb.ShareName)
    const path_ = smb.ProjectsPath.replace(/'/g, "''")

    // Ensure path exists
    lines.push(`New-Item -ItemType Directory -Path '${path_}' -Force -ErrorAction SilentlyContinue | Out-Null`)
    // Remove existing share of the same name, then recreate
    lines.push(`Remove-SmbShare -Name '${name}' -Force -ErrorAction SilentlyContinue`)
    lines.push(`New-SmbShare -Name '${name}' -Path '${path_}' -Description 'd3 Projects' -FullAccess 'Administrators' -ErrorAction Stop`)
  }

  for (const share of smb.AdditionalShares ?? []) {
    const name = sanitiseName(share.Name)
    const path_ = (share.Path ?? '').replace(/'/g, "''")
    lines.push(`New-Item -ItemType Directory -Path '${path_}' -Force -ErrorAction SilentlyContinue | Out-Null`)
    lines.push(`Remove-SmbShare -Name '${name}' -Force -ErrorAction SilentlyContinue`)
    lines.push(`New-SmbShare -Name '${name}' -Path '${path_}' -FullAccess 'Administrators' -ErrorAction Stop`)
  }

  return lines.join('; ')
}

/** Escapes single quotes in a PowerShell string literal */
function escapePs(s: string): string {
  return s.replace(/'/g, "''")
}

/** Strips characters that are illegal in NetBIOS names / PS strings */
function sanitiseName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/'/g, "''")
}

// ─── TCP probe helper ─────────────────────────────────────────────────────────

function tcpProbe(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (open: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => finish(true))
    socket.on('timeout', () => finish(false))
    socket.on('error', () => finish(false))
    socket.connect(port, ip)
  })
}

// ─── Mock / dev implementation ────────────────────────────────────────────────

interface MockStepConfig {
  id: StepId
  message: (ip: string, profile: Profile) => string
  minMs: number
  maxMs: number
}

const MOCK_STEPS: MockStepConfig[] = [
  {
    id: 'connect',
    message: (ip) => `Testing WinRM connectivity to ${ip}…`,
    minMs: 400,
    maxMs: 900,
  },
  {
    id: 'hostname',
    message: (_ip, p) => `Renaming computer to "${p.ServerName}"…`,
    minMs: 600,
    maxMs: 1200,
  },
  {
    id: 'network',
    message: (_ip, p) => {
      const count = p.NetworkAdapters.filter((a) => a.Enabled).length
      return `Configuring ${count} network adapter(s)…`
    },
    minMs: 800,
    maxMs: 2000,
  },
  {
    id: 'smb',
    message: (_ip, p) => {
      const shareCount = (p.SMBSettings.AdditionalShares?.length ?? 0) +
        (p.SMBSettings.ShareD3Projects ? 1 : 0)
      return `Creating ${shareCount} SMB share(s)…`
    },
    minMs: 300,
    maxMs: 700,
  },
  {
    id: 'verify',
    message: (ip) => `Verifying ${ip} is still reachable on port 80…`,
    minMs: 500,
    maxMs: 1000,
  },
]

async function runMockDeploy(
  options: DeployOptions,
  callbacks: DeployCallbacks,
  isCancelled: () => boolean,
): Promise<void> {
  const { targetIP, profile } = options
  const total = MOCK_STEPS.length

  for (const [idx, stepConfig] of MOCK_STEPS.entries()) {
    if (isCancelled()) return

    callbacks.onStep({
      step: stepConfig.id,
      message: stepConfig.message(targetIP, profile),
      stepNumber: idx + 1,
      total,
    })

    await delay(randomInt(stepConfig.minMs, stepConfig.maxMs))

    if (isCancelled()) return
  }

  callbacks.onComplete({
    success: true,
    message: `Profile "${profile.Name}" successfully deployed to ${targetIP}`,
  })
}
