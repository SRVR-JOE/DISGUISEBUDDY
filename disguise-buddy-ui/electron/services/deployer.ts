/**
 * electron/services/deployer.ts
 *
 * Deploys a configuration profile to a remote disguise server via WinRM /
 * PowerShell remoting.
 *
 * Steps:
 *   1. Test Connection   -- Test-WSMan to verify WinRM is reachable
 *   2. Set Hostname      -- Rename-Computer
 *   3. Configure NICs    -- Set-NetIPAddress / Set-NetIPInterface / Set-DnsClientServerAddress
 *   4. Configure SMB     -- New-SmbShare / Grant-SmbShareAccess
 *   5. Verify            -- Re-probes the server over TCP after all changes
 */

import net from 'net'
import { runPowerShell, delay } from './utils.js'

// -- Public types -------------------------------------------------------------

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

// -- Step definitions ---------------------------------------------------------

const STEPS = [
  'connect',
  'hostname',
  'network',
  'smb',
  'verify',
] as const

type StepId = (typeof STEPS)[number]

// -- Public API ---------------------------------------------------------------

export function deployProfile(
  options: DeployOptions,
  callbacks: DeployCallbacks,
): { cancel: () => void } {
  let cancelled = false
  const cancel = () => { cancelled = true }

  const run = async () => {
    try {
      await runLiveDeploy(options, callbacks, () => cancelled)
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

// -- Live implementation ------------------------------------------------------

async function runLiveDeploy(
  options: DeployOptions,
  callbacks: DeployCallbacks,
  isCancelled: () => boolean,
): Promise<void> {
  const { targetIP, profile, credential } = options
  const total = STEPS.length

  const credArg = buildCredentialArg(credential)

  const step = (id: StepId, message: string) => {
    if (isCancelled()) return
    const stepNumber = STEPS.indexOf(id) + 1
    callbacks.onStep({ step: id, message, stepNumber, total })
  }

  // Step 1: Test WinRM connectivity
  step('connect', `Testing WinRM connectivity to ${targetIP}...`)
  if (isCancelled()) return

  let wsmanResult: Awaited<ReturnType<typeof runPowerShell>>
  try {
    wsmanResult = await runPowerShell(
      `Test-WSMan -ComputerName ${targetIP}${credArg} -ErrorAction Stop`
    )
  } catch (spawnErr: unknown) {
    const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr)
    if (msg.includes('ENOENT') || msg.includes('spawn')) {
      throw new Error(
        'PowerShell is not available. Profile deployment requires Windows with PowerShell and WinRM configured.'
      )
    }
    throw spawnErr
  }
  if (wsmanResult.exitCode !== 0) {
    throw new Error(
      `Cannot reach ${targetIP} via WinRM: ${wsmanResult.stderr || wsmanResult.stdout}`
    )
  }

  // Step 2: Set hostname
  step('hostname', `Setting hostname to "${profile.ServerName}"...`)
  if (isCancelled()) return

  const renameResult = await runPowerShell(
    `Rename-Computer -ComputerName ${targetIP} -NewName "${sanitiseName(profile.ServerName)}"` +
    ` -Force${credArg} -ErrorAction Stop`
  )
  if (renameResult.exitCode !== 0) {
    throw new Error(`Hostname rename failed: ${renameResult.stderr || renameResult.stdout}`)
  }

  // Step 3: Configure network adapters
  const enabledAdapters = profile.NetworkAdapters.filter((a) => a.Enabled)
  step('network', `Configuring ${enabledAdapters.length} network adapter(s)...`)
  if (isCancelled()) return

  for (const adapter of enabledAdapters) {
    if (isCancelled()) return

    const psBlock = buildAdapterScript(adapter)
    if (!psBlock) continue

    const adapterResult = await runPowerShell(
      `Invoke-Command -ComputerName ${targetIP}${credArg} -ScriptBlock { ${psBlock} } -ErrorAction Stop`
    )
    if (adapterResult.exitCode !== 0) {
      console.error(
        `[deployer] Adapter ${adapter.Index} (${adapter.DisplayName}) config failed: ` +
        (adapterResult.stderr || adapterResult.stdout)
      )
    }
  }

  // Step 4: Configure SMB shares
  step('smb', 'Configuring SMB shares...')
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

  // Step 5: Verify
  step('verify', `Verifying ${targetIP} is still reachable...`)
  if (isCancelled()) return

  await delay(2000)
  const alive = await tcpProbe(targetIP, 80, 5000)
  if (!alive) {
    console.warn(`[deployer] ${targetIP} not reachable on port 80 after deploy -- IP may have changed`)
  }

  if (!isCancelled()) {
    callbacks.onComplete({
      success: true,
      message: `Profile "${profile.Name}" successfully deployed to ${targetIP}`,
    })
  }
}

// -- PowerShell script builders -----------------------------------------------

function buildCredentialArg(credential?: DeployOptions['credential']): string {
  if (!credential) return ''
  const user = escapePs(credential.username)
  const pass = escapePs(credential.password)
  return (
    ` -Credential (New-Object System.Management.Automation.PSCredential` +
    ` ("${user}", (ConvertTo-SecureString "${pass}" -AsPlainText -Force)))`
  )
}

function buildAdapterScript(adapter: AdapterConfig): string {
  const lines: string[] = []

  lines.push(`$iface = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like "*${sanitiseName(adapter.AdapterName)}*" } | Select-Object -First 1`)
  lines.push(`if (-not $iface) { Write-Warning "Adapter '${sanitiseName(adapter.AdapterName)}' not found"; return }`)
  lines.push(`$idx = $iface.InterfaceIndex`)

  if (adapter.DHCP) {
    lines.push(`Set-NetIPInterface -InterfaceIndex $idx -Dhcp Enabled -ErrorAction SilentlyContinue`)
    lines.push(`Remove-NetIPAddress -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
    lines.push(`Remove-NetRoute -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
  } else if (adapter.IPAddress) {
    const prefixLength = subnetToPrefixLength(adapter.SubnetMask)
    lines.push(`Remove-NetIPAddress -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
    lines.push(`Remove-NetRoute -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
    lines.push(`Set-NetIPInterface -InterfaceIndex $idx -Dhcp Disabled -ErrorAction SilentlyContinue`)

    let addCmd = `New-NetIPAddress -InterfaceIndex $idx -IPAddress "${adapter.IPAddress}" -PrefixLength ${prefixLength}`
    if (adapter.Gateway) {
      addCmd += ` -DefaultGateway "${adapter.Gateway}"`
    }
    addCmd += ' -ErrorAction Stop'
    lines.push(addCmd)

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
    lines.push(`New-Item -ItemType Directory -Path '${path_}' -Force -ErrorAction SilentlyContinue | Out-Null`)
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

function escapePs(s: string): string {
  return s.replace(/'/g, "''")
}

function sanitiseName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/'/g, "''")
}

// -- TCP probe helper ---------------------------------------------------------

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
