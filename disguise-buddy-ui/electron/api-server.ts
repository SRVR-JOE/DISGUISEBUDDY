import express from 'express'
import cors from 'cors'
import type { Request, Response } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import net from 'net'
import http from 'http'
import {
  getProfiles,
  saveProfile,
  deleteProfile,
  getNetworkInterfaces,
} from './mock-data.ts'
import { scanNetwork } from './services/scanner.ts'
import { deployProfile } from './services/deployer.ts'
import { isPowerShellAvailable, runPowerShell } from './services/utils.ts'
import { installSoftware, getPackages, addPackage, removePackage } from './services/installer.ts'
import { executeRemote, executeLocal, pingHost } from './services/terminal.ts'
import { querySmc } from './services/smc-client.ts'
import { telemetryService, type TelemetrySnapshot } from './services/telemetry.ts'

// ESM-compatible require — used to conditionally load 'electron' without a
// static top-level import so that this module also works in the dev-server
// context (plain Node.js, no Electron runtime present).
const _require = createRequire(import.meta.url)

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

const SOFTWARE_DIR = getResourcePath('software')

const PORT = 47100
const app = express()

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'app://disguise-buddy'],
  methods: ['GET', 'POST', 'DELETE'],
}))
app.use(express.json())

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Coerce Express 5 param type (string | string[]) to plain string */
function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value
}

function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function sseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
}

/** Escape a string for safe embedding in a PowerShell double-quoted string */
function escapePsDouble(s: string): string {
  return s.replace(/[`$"]/g, '`$&')
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

app.get('/api/profiles', (_req: Request, res: Response) => {
  res.json(getProfiles())
})

app.post('/api/profiles', (req: Request, res: Response) => {
  const profile = req.body
  if (!profile || !profile.Name) {
    res.status(400).json({ success: false, message: 'Profile must have a Name' })
    return
  }
  const result = saveProfile(profile)
  res.status(result.success ? 200 : 400).json(result)
})

app.post('/api/profiles/:name/apply', async (req: Request, res: Response) => {
  const name = decodeURIComponent(param(req.params.name))
  const profile = getProfiles().find(p => p.Name === name)
  if (!profile) {
    res.status(404).json({ success: false, message: `Profile "${name}" not found` })
    return
  }

  try {
    // Build PowerShell script to apply the profile locally
    const psLines: string[] = []
    const serverName = escapePsDouble(profile.ServerName.replace(/'/g, "''"))

    // 1. Rename computer if ServerName differs from current
    psLines.push(`
$currentName = $env:COMPUTERNAME
if ("${serverName}" -ne $currentName) {
  Rename-Computer -NewName "${serverName}" -Force -ErrorAction Stop
  Write-Output "Renamed computer from $currentName to ${serverName} (reboot required)"
} else {
  Write-Output "Hostname already set to ${serverName}"
}
`)

    // 2. Configure each enabled adapter (static IP or DHCP)
    for (const adapter of profile.NetworkAdapters) {
      if (!adapter.Enabled) continue
      const adapterName = escapePsDouble(adapter.AdapterName.replace(/'/g, "''"))
      if (adapter.DHCP) {
        psLines.push(`
# Configure ${adapterName} for DHCP
Set-NetIPInterface -InterfaceAlias '${adapterName}' -Dhcp Enabled -ErrorAction SilentlyContinue
Set-DnsClientServerAddress -InterfaceAlias '${adapterName}' -ResetServerAddresses -ErrorAction SilentlyContinue
Write-Output "Configured ${adapterName} for DHCP"
`)
      } else {
        const ip = escapePsDouble(adapter.IPAddress.replace(/'/g, "''"))
        const mask = escapePsDouble(adapter.SubnetMask.replace(/'/g, "''"))
        const gw = escapePsDouble(adapter.Gateway.replace(/'/g, "''"))
        const dns1 = escapePsDouble(adapter.DNS1.replace(/'/g, "''"))
        const dns2 = escapePsDouble(adapter.DNS2.replace(/'/g, "''"))
        // Convert subnet mask to prefix length
        psLines.push(`
# Configure ${adapterName} with static IP
$iface = Get-NetAdapter -Name '${adapterName}' -ErrorAction Stop
Remove-NetIPAddress -InterfaceIndex $iface.InterfaceIndex -Confirm:$false -ErrorAction SilentlyContinue
Remove-NetRoute -InterfaceIndex $iface.InterfaceIndex -Confirm:$false -ErrorAction SilentlyContinue
$maskParts = '${mask}'.Split('.')
$prefix = ($maskParts | ForEach-Object { [Convert]::ToString([int]$_, 2) }) -join '' -replace '0','' | ForEach-Object { $_.Length }
New-NetIPAddress -InterfaceIndex $iface.InterfaceIndex -IPAddress '${ip}' -PrefixLength $prefix ${gw ? `-DefaultGateway '${gw}'` : ''} -ErrorAction Stop
$dnsServers = @(${dns1 ? `'${dns1}'` : ''}${dns2 ? `, '${dns2}'` : ''}) | Where-Object { $_ }
if ($dnsServers.Count -gt 0) { Set-DnsClientServerAddress -InterfaceIndex $iface.InterfaceIndex -ServerAddresses $dnsServers }
Write-Output "Configured ${adapterName} with IP ${ip}"
`)
      }
    }

    // 3. Create/update SMB shares
    if (profile.SMBSettings.ShareD3Projects) {
      const shareName = escapePsDouble(profile.SMBSettings.ShareName.replace(/'/g, "''"))
      const sharePath = escapePsDouble(profile.SMBSettings.ProjectsPath.replace(/'/g, "''"))
      psLines.push(`
# Create/update d3 Projects SMB share
if (!(Test-Path '${sharePath}')) { New-Item -Path '${sharePath}' -ItemType Directory -Force | Out-Null }
$existing = Get-SmbShare -Name '${shareName}' -ErrorAction SilentlyContinue
if ($existing) {
  Set-SmbShare -Name '${shareName}' -Path '${sharePath}' -Force -ErrorAction Stop
  Write-Output "Updated SMB share ${shareName}"
} else {
  New-SmbShare -Name '${shareName}' -Path '${sharePath}' -FullAccess Everyone -ErrorAction Stop
  Write-Output "Created SMB share ${shareName}"
}
`)
    }

    if (profile.SMBSettings.AdditionalShares) {
      for (const share of profile.SMBSettings.AdditionalShares) {
        const sName = escapePsDouble(share.Name.replace(/'/g, "''"))
        const sPath = escapePsDouble(share.Path.replace(/'/g, "''"))
        const sDesc = escapePsDouble((share.Description || '').replace(/'/g, "''"))
        psLines.push(`
# Additional share: ${sName}
if (!(Test-Path '${sPath}')) { New-Item -Path '${sPath}' -ItemType Directory -Force | Out-Null }
$existing = Get-SmbShare -Name '${sName}' -ErrorAction SilentlyContinue
if ($existing) {
  Set-SmbShare -Name '${sName}' -Description '${sDesc}' -Force -ErrorAction Stop
  Write-Output "Updated SMB share ${sName}"
} else {
  New-SmbShare -Name '${sName}' -Path '${sPath}' -Description '${sDesc}' -FullAccess Everyone -ErrorAction Stop
  Write-Output "Created SMB share ${sName}"
}
`)
      }
    }

    const fullScript = psLines.join('\n')
    const result = await runPowerShell(fullScript)
    res.json({
      success: result.exitCode === 0,
      message: result.exitCode === 0 ? `Profile "${name}" applied locally` : `Profile apply failed: ${result.stderr || result.stdout}`,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    })
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message })
  }
})

app.delete('/api/profiles/:name', (req: Request, res: Response) => {
  const result = deleteProfile(decodeURIComponent(param(req.params.name)))
  res.status(result.success ? 200 : 404).json(result)
})

// ─── Network interfaces (local host NICs) ─────────────────────────────────────

app.get('/api/nics', (_req: Request, res: Response) => {
  res.json(getNetworkInterfaces())
})

// ─── SSE: Network scan ────────────────────────────────────────────────────────
// Query params: subnet, start, end, timeout

app.get('/api/scan', (req: Request, res: Response) => {
  sseHeaders(res)

  const subnet = (req.query.subnet as string) || '192.168.10'
  const start = parseInt(req.query.start as string) || 1
  const end = parseInt(req.query.end as string) || 254
  const timeout = parseInt(req.query.timeout as string) || 200

  // Input validation
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(subnet)) {
    sendSse(res, 'error', { message: 'Invalid subnet format. Expected format: x.x.x (e.g. 192.168.10)' })
    res.end()
    return
  }
  if (!Number.isInteger(start) || start < 1 || start > 254) {
    sendSse(res, 'error', { message: 'Invalid start: must be an integer between 1 and 254' })
    res.end()
    return
  }
  if (!Number.isInteger(end) || end < 1 || end > 254) {
    sendSse(res, 'error', { message: 'Invalid end: must be an integer between 1 and 254' })
    res.end()
    return
  }
  if (start > end) {
    sendSse(res, 'error', { message: 'Invalid range: start must be less than or equal to end' })
    res.end()
    return
  }
  if (!Number.isInteger(timeout) || timeout < 50 || timeout > 5000) {
    sendSse(res, 'error', { message: 'Invalid timeout: must be an integer between 50 and 5000' })
    res.end()
    return
  }

  const { cancel } = scanNetwork(
    { subnet, startIP: start, endIP: end, timeoutMs: timeout, ports: [80, 873, 9864] },
    {
      onProgress: (p) => sendSse(res, 'progress', p),
      onDiscovered: (s) => sendSse(res, 'discovered', s),
      onComplete: (servers) => {
        sendSse(res, 'complete', { message: 'Scan complete', found: servers.length })
        res.end()
      },
      onError: (err) => {
        sendSse(res, 'error', { message: err.message })
        res.end()
      },
    }
  )

  req.on('close', () => cancel())
})

// ─── SSE: Profile deployment ──────────────────────────────────────────────────
// Query params: server, profile

app.post('/api/deploy', async (req: Request, res: Response) => {
  sseHeaders(res)

  const server = (req.body.server as string) || ''
  const profileName = (req.body.profile as string) || ''
  const credUser = (req.body.credential_user as string) || ''
  const credPass = (req.body.credential_pass as string) || ''

  // Validate server is a valid IPv4 address
  if (!server || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(server)) {
    sendSse(res, 'error', { message: 'Invalid server: must be a valid IPv4 address' })
    res.end()
    return
  }
  const credential = credUser && credPass ? { username: credUser, password: credPass } : undefined

  console.log(`[deploy] Starting deployment: server=${server}, profile=${profileName}, hasCredential=${!!credential}`)

  const profiles = getProfiles()
  const profile = profiles.find(p => p.Name === profileName)

  if (!profile) {
    console.error(`[deploy] Profile "${profileName}" not found`)
    sendSse(res, 'error', { message: `Profile "${profileName}" not found` })
    res.end()
    return
  }

  // Pre-flight check: is PowerShell available on this OS?
  const psAvailable = await isPowerShellAvailable()
  if (!psAvailable) {
    const msg = 'PowerShell is not available. Profile deployment requires Windows with PowerShell and WinRM configured.'
    console.error(`[deploy] ${msg}`)
    sendSse(res, 'error', { message: msg })
    res.end()
    return
  }

  const { cancel } = deployProfile(
    { targetIP: server, profile, credential },
    {
      onStep: (step) => {
        console.log(`[deploy] ${server}: Step ${step.stepNumber}/${step.total} — ${step.message}`)
        sendSse(res, 'progress', step)
      },
      onComplete: (result) => {
        console.log(`[deploy] ${server}: Complete — ${result.message}`)
        sendSse(res, 'complete', result)
        res.end()
      },
      onError: (err) => {
        console.error(`[deploy] ${server}: Error — ${err.message}`)
        sendSse(res, 'error', { message: err.message })
        res.end()
      },
    }
  )

  req.on('close', () => cancel())
})

// ─── Software packages ────────────────────────────────────────────────────────

app.get('/api/software', (_req: Request, res: Response) => {
  res.json(getPackages(SOFTWARE_DIR))
})

app.post('/api/software', (req: Request, res: Response) => {
  const pkg = addPackage(SOFTWARE_DIR, req.body as Parameters<typeof addPackage>[1])
  res.json({ success: true, package: pkg })
})

app.delete('/api/software/:id', (req: Request, res: Response) => {
  const ok = removePackage(SOFTWARE_DIR, param(req.params.id))
  res.status(ok ? 200 : 404).json({ success: ok, message: ok ? 'Removed' : 'Not found' })
})

// ─── SSE: Software installation ───────────────────────────────────────────────
// Query params: server, packages (comma-separated package IDs)

app.post('/api/install', (req: Request, res: Response) => {
  sseHeaders(res)

  const servers = (req.body.servers as string) || (req.body.server as string) || ''
  const packageIds = Array.isArray(req.body.packages) ? req.body.packages as string[] : ((req.body.packages as string) || '').split(',').filter(Boolean)
  const credUser = (req.body.credential_user as string) || ''
  const credPass = (req.body.credential_pass as string) || ''
  const credential = credUser && credPass ? { username: credUser, password: credPass } : undefined
  const server = servers
  const allPkgs = getPackages(SOFTWARE_DIR)
  const packages = allPkgs.filter(p => packageIds.includes(p.id))

  if (server && (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(server) || server.split('.').some((o: string) => Number(o) > 255))) {
    sendSse(res, 'error', { message: 'Invalid server IP address' })
    res.end()
    return
  }

  if (packages.length === 0) {
    sendSse(res, 'error', { message: 'No valid packages specified' })
    res.end()
    return
  }

  const { cancel } = installSoftware(
    { targetIP: server, packages },
    {
      onProgress: (p) => sendSse(res, 'progress', p),
      onComplete: (result) => {
        sendSse(res, 'complete', result)
        res.end()
      },
      onError: (err) => {
        sendSse(res, 'error', { message: err.message })
        res.end()
      },
    }
  )

  req.on('close', () => cancel())
})

// ─── SSE: Terminal execute ────────────────────────────────────────────────────
// Query params: command (required), server (optional), credential_user (optional), credential_pass (optional)
// If server is provided the command runs remotely via WinRM; otherwise locally.

app.post('/api/terminal/execute', (req: Request, res: Response) => {
  sseHeaders(res)

  const command = (req.body.command as string) || ''
  const target = (req.body.target as string) || (req.body.server as string) || ''
  const credUser = (req.body.credential_user as string) || ''
  const credPass = (req.body.credential_pass as string) || ''

  if (!command.trim()) {
    sendSse(res, 'error', { message: 'command is required' })
    res.end()
    return
  }

  // Input sanitization: block dangerous commands
  const dangerousPatterns = [
    /Remove-Item\s+-Recurse\s+C:\\/i,
    /Format-/i,
    /del\s+\//i,
    /rm\s+-rf/i,
    /;\s*Remove-Item\s+-Recurse/i,
    /;\s*Format-/i,
    /;\s*del\s+\//i,
    /;\s*rm\s+-rf/i,
    /&\s*\(.*['"]\s*\+\s*['"]/,
  ]

  const blocklist = [
    'format-volume',
    'clear-disk',
    'initialize-disk',
    'remove-partition',
    'clear-recyclebin',
    'stop-computer',
    'restart-computer',
    'reset-computermachinepassword',
    'invoke-expression',
    'iex',
  ]

  const cmdLower = command.toLowerCase().trim()

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      sendSse(res, 'error', { message: 'Command rejected: contains a dangerous pattern' })
      res.end()
      return
    }
  }

  for (const blocked of blocklist) {
    if (cmdLower.includes(blocked)) {
      sendSse(res, 'error', { message: `Command rejected: '${blocked}' is blocked` })
      res.end()
      return
    }
  }

  // Validate target is a valid IPv4 address if provided
  if (target && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(target)) {
    sendSse(res, 'error', { message: 'Invalid target: must be a valid IPv4 address' })
    res.end()
    return
  }

  const credential =
    credUser && credPass ? { username: credUser, password: credPass } : undefined
  const server = target

  const callbacks = {
    onOutput: (line: string) => sendSse(res, 'output', { line }),
    onError: (line: string) => sendSse(res, 'error', { line }),
    onComplete: (result: { exitCode: number; durationMs: number; stdout: string; stderr: string }) => {
      sendSse(res, 'complete', result)
      res.end()
    },
  }

  const { cancel } = server
    ? executeRemote(server, command, callbacks, credential)
    : executeLocal(command, callbacks)

  req.on('close', () => cancel())
})

// ─── SSE: Terminal ping ───────────────────────────────────────────────────────
// Query params: target (required), count (optional, default 4)

app.get('/api/terminal/ping', (req: Request, res: Response) => {
  sseHeaders(res)

  const target = (req.query.target as string) || ''
  const count = parseInt(req.query.count as string) || 4

  if (!target.trim()) {
    sendSse(res, 'error', { message: 'target query param is required' })
    res.end()
    return
  }

  // Input validation: target must be a valid IPv4 address or hostname
  const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(target)
  if (isIPv4) {
    const octets = target.split('.').map(Number)
    if (octets.some(o => o < 0 || o > 255)) {
      sendSse(res, 'error', { message: 'Invalid IPv4 address: each octet must be 0-255' })
      res.end()
      return
    }
  } else {
    const isHostname = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/.test(target)
    if (!isHostname) {
      sendSse(res, 'error', { message: 'Invalid target: must be a valid IPv4 address or hostname' })
      res.end()
      return
    }
  }

  const { cancel } = pingHost(
    target,
    count,
    {
      onOutput: (line: string) => sendSse(res, 'output', { line }),
      onError: (line: string) => sendSse(res, 'error', { line }),
      onComplete: (result) => {
        sendSse(res, 'complete', result)
        res.end()
      },
    },
  )

  req.on('close', () => cancel())
})

// ─── Dashboard ────────────────────────────────────────────────────────────────

app.get('/api/dashboard', (_req: Request, res: Response) => {
  res.json({ status: 'ok', profiles: getProfiles().length })
})

// ─── Setup script ─────────────────────────────────────────────────────────────

app.get('/api/setup-script', (_req: Request, res: Response) => {
  const script = [
    'Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Force -ErrorAction SilentlyContinue',
    'Enable-PSRemoting -Force -SkipNetworkProfileCheck',
    'Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value * -Force',
    'winrm set winrm/config/service @{AllowUnencrypted="true"}',
    'winrm set winrm/config/service/auth @{Basic="true"}',
    'New-NetFirewallRule -DisplayName "WinRM HTTP" -Direction Inbound -LocalPort 5985 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue',
    'Restart-Service WinRM',
    'Write-Host "WinRM enabled successfully. This machine can now be configured remotely." -ForegroundColor Green',
  ].join('; ')

  res.json({
    oneLiner: `powershell -Command "${script}"`,
    scriptContent: script,
    instructions: 'Run this command in an Administrator PowerShell on each disguise server. Only needed once per server.',
  })
})

// ─── Diagnostic probe ─────────────────────────────────────────────────────────

/** Probe a single TCP port on the given host with a hard timeout (ms). */
function probeTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
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
    socket.connect(port, host)
  })
}

/** Probe an HTTP endpoint and return status + raw body. */
function probeHttp(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('request timed out'))
    })
    req.on('error', (err) => reject(err))
  })
}

// GET /api/probe?server=IP[&credential_user=d3][&credential_pass=disguise]
// Returns a comprehensive connectivity report for the given target IP.

app.get('/api/probe', async (req: Request, res: Response) => {
  const target = (req.query.server as string) || ''
  const credUser = (req.query.credential_user as string) || ''
  const credPass = (req.query.credential_pass as string) || ''

  if (!credUser || !credPass) {
    res.status(400).json({ success: false, message: 'Credentials required (credential_user and credential_pass)' })
    return
  }

  if (!target.trim()) {
    res.status(400).json({ success: false, message: 'server query param is required' })
    return
  }

  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(target) || target.split('.').some(o => Number(o) > 255)) {
    res.status(400).json({ success: false, message: 'Invalid target IP address' })
    return
  }

  console.log(`[probe] Starting diagnostic probe for ${target}`)

  // ── 1. Concurrent TCP port probes ──────────────────────────────────────────

  const PROBE_PORTS: number[] = [80, 445, 135, 5985, 5986, 22, 873, 9864]
  const TCP_TIMEOUT_MS = 3000

  const portResults = await Promise.all(
    PROBE_PORTS.map(async (port) => {
      const open = await probeTcpPort(target, port, TCP_TIMEOUT_MS)
      console.log(`[probe] ${target}:${port} — ${open ? 'OPEN' : 'closed'}`)
      return { port, open }
    })
  )

  const ports: Record<string, boolean> = {}
  for (const { port, open } of portResults) {
    ports[String(port)] = open
  }

  // ── 2. SMB connectivity test (only if port 445 is open) ────────────────────

  let smbResult: { success: boolean; message: string }

  if (!ports['445']) {
    smbResult = { success: false, message: 'port 445 not reachable' }
  } else {
    try {
      const connectOut = await runPowerShell(
        `net use "\\\\${target}\\IPC$" /user:"${escapePsDouble(credUser)}" "${escapePsDouble(credPass)}" 2>&1`
      )
      const connected =
        connectOut.exitCode === 0 ||
        connectOut.stdout.toLowerCase().includes('command completed successfully') ||
        connectOut.stdout.toLowerCase().includes('already')

      if (connected) {
        smbResult = { success: true, message: 'SMB IPC$ connection succeeded' }
        // Best-effort cleanup — do not let cleanup failure affect the result
        await runPowerShell(
          `net use "\\\\${target}\\IPC$" /delete /y 2>&1`
        ).catch(() => {})
      } else {
        const detail = connectOut.stderr || connectOut.stdout || `exit ${connectOut.exitCode}`
        smbResult = { success: false, message: `SMB connection failed: ${detail}` }
      }
    } catch (err) {
      smbResult = {
        success: false,
        message: `SMB test threw: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  console.log(`[probe] SMB result for ${target}: success=${smbResult.success}`)

  // ── 3. WinRM test (only if port 5985 is open) ──────────────────────────────

  let winrmResult: { success: boolean; message: string }

  if (!ports['5985']) {
    winrmResult = { success: false, message: 'port 5985 not reachable' }
  } else {
    const psAvailable = await isPowerShellAvailable()
    if (!psAvailable) {
      winrmResult = { success: false, message: 'PowerShell not available on this host' }
    } else {
      try {
        // Escape credential values for embedding in a PowerShell double-quoted string
        const escapedIP = target.replace(/[`"$]/g, '`$&')
        const escapedUser = credUser.replace(/[`"$]/g, '`$&')
        const escapedPass = credPass.replace(/[`"$]/g, '`$&')

        const wsmanScript = `
$securePassword = ConvertTo-SecureString "${escapedPass}" -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential("${escapedUser}", $securePassword)
Test-WSMan -ComputerName "${escapedIP}" -Credential $credential -Authentication Negotiate -ErrorAction Stop
Write-Output "WSMAN_OK"
`.trim()

        const wsmanOut = await runPowerShell(wsmanScript)

        if (wsmanOut.exitCode === 0 && wsmanOut.stdout.includes('WSMAN_OK')) {
          winrmResult = { success: true, message: 'WinRM Test-WSMan succeeded (Negotiate auth)' }
        } else {
          const detail = wsmanOut.stderr || wsmanOut.stdout || `exit ${wsmanOut.exitCode}`
          winrmResult = { success: false, message: `WinRM test failed: ${detail}` }
        }
      } catch (err) {
        winrmResult = {
          success: false,
          message: `WinRM test threw: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    }
  }

  console.log(`[probe] WinRM result for ${target}: success=${winrmResult.success}`)

  // ── 4. d3 API test (only if port 80 is open) ───────────────────────────────

  let d3apiResult: {
    success: boolean
    hostname?: string
    version?: string
    status?: number
    message?: string
  }

  if (!ports['80']) {
    d3apiResult = { success: false, message: 'port 80 not reachable' }
  } else {
    try {
      const { status, body } = await probeHttp(
        `http://${target}/api/service/system`,
        5000
      )

      if (status >= 200 && status < 300) {
        let hostname: string | undefined
        let version: string | undefined
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>
          // d3 API typically returns { hostname, version } or similar
          hostname =
            typeof parsed['hostname'] === 'string' ? parsed['hostname'] :
            typeof parsed['Hostname'] === 'string' ? parsed['Hostname'] :
            undefined
          version =
            typeof parsed['version'] === 'string' ? parsed['version'] :
            typeof parsed['Version'] === 'string' ? parsed['Version'] :
            typeof parsed['softwareVersion'] === 'string' ? parsed['softwareVersion'] :
            undefined
        } catch {
          // body is not JSON — still treat as success
        }
        d3apiResult = { success: true, hostname, version, status }
      } else {
        d3apiResult = {
          success: false,
          status,
          message: `d3 API returned HTTP ${status}`,
        }
      }
    } catch (err) {
      d3apiResult = {
        success: false,
        message: `d3 API request failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  console.log(`[probe] d3 API result for ${target}: success=${d3apiResult.success}`)

  // ── 5. Recommendation ──────────────────────────────────────────────────────

  let recommended: 'smb' | 'winrm' | 'manual'
  if (winrmResult.success) {
    recommended = 'winrm'
  } else if (smbResult.success) {
    recommended = 'smb'
  } else {
    recommended = 'manual'
  }

  console.log(`[probe] Recommendation for ${target}: ${recommended}`)

  res.json({
    target,
    timestamp: new Date().toISOString(),
    ports,
    smb: smbResult,
    winrm: winrmResult,
    d3api: d3apiResult,
    recommended,
  })
})

// ─── Identity ──────────────────────────────────────────────────────────────────

app.get('/api/identity', async (req: Request, res: Response) => {
  try {
    const result = await runPowerShell(`
      [PSCustomObject]@{
        Hostname = $env:COMPUTERNAME
        Domain = (Get-CimInstance Win32_ComputerSystem).Domain
        DomainType = if ((Get-CimInstance Win32_ComputerSystem).PartOfDomain) { 'Domain' } else { 'Workgroup' }
        OSVersion = [System.Environment]::OSVersion.VersionString
        Uptime = ((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).ToString('d\\.hh\\:mm\\:ss')
        SerialNumber = (Get-CimInstance Win32_BIOS).SerialNumber
        Model = (Get-CimInstance Win32_ComputerSystem).Model
      } | ConvertTo-Json
    `)
    res.json(JSON.parse(result.stdout || '{}'))
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// ─── SMB Shares ────────────────────────────────────────────────────────────────

app.get('/api/smb', async (req: Request, res: Response) => {
  try {
    const result = await runPowerShell(`Get-SmbShare | Select-Object Name, Path, Description, ShareState | ConvertTo-Json -AsArray`)
    res.json(JSON.parse(result.stdout || '[]'))
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// ─── Network Adapters (detailed) ───────────────────────────────────────────────

app.get('/api/network/adapters', async (req: Request, res: Response) => {
  try {
    const result = await runPowerShell(`
      Get-NetAdapter | ForEach-Object {
        $ip = Get-NetIPAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
        $dns = Get-DnsClientServerAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
        $dhcp = (Get-NetIPInterface -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).Dhcp
        [PSCustomObject]@{
          Name = $_.Name
          InterfaceDescription = $_.InterfaceDescription
          InterfaceIndex = $_.InterfaceIndex
          Status = $_.Status
          MacAddress = $_.MacAddress
          LinkSpeed = $_.LinkSpeed
          IPAddress = $ip.IPAddress
          SubnetPrefix = $ip.PrefixLength
          Gateway = (Get-NetRoute -InterfaceIndex $_.InterfaceIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue).NextHop
          DNS = $dns.ServerAddresses -join ','
          DHCP = ($dhcp -eq 'Enabled')
        }
      } | ConvertTo-Json -AsArray
    `)
    res.json(JSON.parse(result.stdout || '[]'))
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// ─── SMC Discovery (disguise Remote Manager on MGMT port) ─────────────────────

app.get('/api/smc/discover', async (req: Request, res: Response) => {
  const { subnet, start, end, timeout } = req.query
  const subnetStr = String(subnet || '192.168.100')
  const startNum = Number(start) || 200
  const endNum = Number(end) || 254
  const timeoutMs = Number(timeout) || 4000

  const subnetMatch = String(subnet || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!subnetMatch || subnetMatch.slice(1).some(o => Number(o) > 255)) {
    res.status(400).json({ success: false, message: 'Invalid subnet format (expected x.x.x)' })
    return
  }
  if (!Number.isInteger(startNum) || startNum < 1 || startNum > 254) {
    res.status(400).json({ success: false, message: 'Invalid start: must be an integer between 1 and 254' })
    return
  }
  if (!Number.isInteger(endNum) || endNum < 1 || endNum > 254) {
    res.status(400).json({ success: false, message: 'Invalid end: must be an integer between 1 and 254' })
    return
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    res.status(400).json({ success: false, message: 'Invalid timeout: must be a positive number' })
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const servers: any[] = []
  const total = endNum - startNum + 1

  for (let i = startNum; i <= endNum; i++) {
    const ip = `${subnetStr}.${i}`
    const current = i - startNum + 1

    res.write(`event: progress\ndata: ${JSON.stringify({ current, total, percent: Math.round((current / total) * 100), ip })}\n\n`)

    try {
      const [machine, session, adapters, power] = await Promise.all([
        querySmc(ip, 'localmachine', timeoutMs).catch(() => null),
        querySmc(ip, 'session', timeoutMs).catch(() => null),
        querySmc(ip, 'networkadapters', timeoutMs).catch(() => null),
        querySmc(ip, 'chassis/power/status', timeoutMs).catch(() => null),
      ])

      if (machine && machine.hostname) {
        const server = {
          mgmtIp: ip,
          hostname: machine.hostname,
          serial: machine.serial || '',
          type: machine.type || '',
          role: session?.role || '',
          powerStatus: power?.['System Power'] || '',
          adapters: (adapters || []).filter((a: any) =>
            a.name !== 'Loopback Pseudo-Interface 1' && a.name !== 'disguiseMGMT'
          ),
        }
        servers.push(server)
        res.write(`event: discovered\ndata: ${JSON.stringify(server)}\n\n`)
      }
    } catch {
      // Host not responding — skip
    }
  }

  res.write(`event: complete\ndata: ${JSON.stringify({ message: 'SMC scan complete', found: servers.length, servers })}\n\n`)
  res.end()
})

/** Probe a single server's SMC API by MGMT IP. */
app.get('/api/smc/probe', async (req: Request, res: Response) => {
  const ip = String(req.query.ip || '')
  if (!ip) return res.status(400).json({ error: 'ip parameter required' })

  try {
    const [machine, session, adapters, power, chassis] = await Promise.all([
      querySmc(ip, 'localmachine').catch(() => null),
      querySmc(ip, 'session').catch(() => null),
      querySmc(ip, 'networkadapters').catch(() => null),
      querySmc(ip, 'chassis/power/status').catch(() => null),
      querySmc(ip, 'chassis/stats').catch(() => null),
    ])

    if (!machine || !machine.hostname) {
      return res.status(404).json({ error: 'No SMC found at this IP' })
    }

    res.json({
      mgmtIp: ip,
      hostname: machine.hostname,
      serial: machine.serial || '',
      type: machine.type || '',
      role: session?.role || '',
      powerStatus: power?.['System Power'] || '',
      powerFault: power?.['Main Power Fault'] || '',
      chassisStats: chassis || null,
      adapters: (adapters || []).filter((a: any) =>
        a.name !== 'Loopback Pseudo-Interface 1' && a.name !== 'disguiseMGMT'
      ),
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Telemetry ────────────────────────────────────────────────────────────────

const RANGE_MAP: Record<string, number> = {
  '5m':  5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '6h':  6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
}

app.get('/api/telemetry/history', (req: Request, res: Response) => {
  const rangeKey = (req.query.range as string) || '1h'
  const rangeMs = RANGE_MAP[rangeKey]
  if (!rangeMs) {
    res.status(400).json({ success: false, message: `Invalid range. Use one of: ${Object.keys(RANGE_MAP).join(', ')}` })
    return
  }
  res.json(telemetryService.getHistory(rangeMs))
})

app.get('/api/telemetry/latest', (_req: Request, res: Response) => {
  const snapshot = telemetryService.getLatest()
  if (!snapshot) {
    res.status(404).json({ success: false, message: 'No telemetry data yet' })
    return
  }
  res.json(snapshot)
})

app.post('/api/telemetry/latest', async (_req: Request, res: Response) => {
  try {
    const snapshot = await telemetryService.takeSnapshot()
    res.json(snapshot)
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message })
  }
})

app.post('/api/telemetry/servers', (req: Request, res: Response) => {
  const { ips } = req.body as { ips?: string[] }
  if (!Array.isArray(ips) || ips.length === 0) {
    res.status(400).json({ success: false, message: 'ips must be a non-empty array of IP strings' })
    return
  }
  telemetryService.setServers(ips)
  res.json({ success: true, servers: telemetryService.servers })
})

app.post('/api/telemetry/config', (req: Request, res: Response) => {
  const { pollIntervalMs, retentionMs } = req.body as { pollIntervalMs?: number; retentionMs?: number }
  if (pollIntervalMs !== undefined) {
    if (typeof pollIntervalMs !== 'number' || pollIntervalMs < 5000) {
      res.status(400).json({ success: false, message: 'pollIntervalMs must be a number >= 5000' })
      return
    }
    telemetryService.pollIntervalMs = pollIntervalMs
  }
  if (retentionMs !== undefined) {
    if (typeof retentionMs !== 'number' || retentionMs < 60000) {
      res.status(400).json({ success: false, message: 'retentionMs must be a number >= 60000' })
      return
    }
    telemetryService.retentionMs = retentionMs
  }
  // Restart polling with new interval if running
  telemetryService.stop()
  telemetryService.start()
  res.json({
    success: true,
    pollIntervalMs: telemetryService.pollIntervalMs,
    retentionMs: telemetryService.retentionMs,
  })
})

app.get('/api/telemetry/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const callback = (snapshot: TelemetrySnapshot) => {
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`)
  }

  telemetryService.registerCallback(callback)

  req.on('close', () => {
    telemetryService.unregisterCallback(callback)
  })
})

// Start telemetry polling
telemetryService.start()

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: any, _req: Request, res: Response, _next: any) => {
  console.error('[api] Unhandled error:', err)
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ─── 404 fallback ─────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' })
})

// ─── Start ────────────────────────────────────────────────────────────────────

export function startApiServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`[api-server] Listening on http://127.0.0.1:${PORT}`)
      resolve()
    })
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${PORT} is already in use. Kill the old process and try again.`))
      } else {
        reject(err)
      }
    })
  })
}
