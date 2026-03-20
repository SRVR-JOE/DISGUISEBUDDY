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
} from './mock-data.js'
import { scanNetwork } from './services/scanner.js'
import { deployProfile } from './services/deployer.js'
import { isPowerShellAvailable, runPowerShell } from './services/utils.js'
import { installSoftware, getPackages, addPackage, removePackage } from './services/installer.js'
import { executeRemote, executeLocal, pingHost } from './services/terminal.js'

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
  origin: true,
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

app.post('/api/profiles/:name/apply', (req: Request, res: Response) => {
  const name = decodeURIComponent(param(req.params.name))
  const profile = getProfiles().find(p => p.Name === name)
  if (!profile) {
    res.status(404).json({ success: false, message: `Profile "${name}" not found` })
    return
  }
  res.json({ success: true, message: `Profile "${name}" found`, profile })
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

app.get('/api/deploy', async (req: Request, res: Response) => {
  sseHeaders(res)

  const server = (req.query.server as string) || ''
  const profileName = (req.query.profile as string) || ''
  const credUser = (req.query.credential_user as string) || ''
  const credPass = (req.query.credential_pass as string) || ''
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

app.get('/api/install', (req: Request, res: Response) => {
  sseHeaders(res)

  const server = (req.query.server as string) || ''
  const packageIds = ((req.query.packages as string) || '').split(',').filter(Boolean)
  const allPkgs = getPackages(SOFTWARE_DIR)
  const packages = allPkgs.filter(p => packageIds.includes(p.id))

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

app.get('/api/terminal/execute', (req: Request, res: Response) => {
  sseHeaders(res)

  const command = (req.query.command as string) || ''
  const server = (req.query.server as string) || ''
  const credUser = (req.query.credential_user as string) || ''
  const credPass = (req.query.credential_pass as string) || ''

  if (!command.trim()) {
    sendSse(res, 'error', { message: 'command query param is required' })
    res.end()
    return
  }

  const credential =
    credUser && credPass ? { username: credUser, password: credPass } : undefined

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
  const credUser = (req.query.credential_user as string) || 'd3'
  const credPass = (req.query.credential_pass as string) || 'disguise'

  if (!target.trim()) {
    res.status(400).json({ success: false, message: 'server query param is required' })
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
        `net use "\\\\${target}\\IPC$" /user:${credUser} "${credPass}" 2>&1`
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

// ─── SMC (disguise Remote Manager) helpers ───────────────────────────────────

/** Query a disguise Remote Manager (SMC) endpoint on a server's MGMT port. */
async function querySmc(
  mgmtIp: string,
  endpoint: string,
  timeoutMs = 4000,
): Promise<any> {
  const { status, body } = await probeHttp(
    `http://${mgmtIp}/api/${endpoint}`,
    timeoutMs,
  )
  if (status < 200 || status >= 300) {
    throw new Error(`SMC ${endpoint} returned HTTP ${status}`)
  }
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

/** POST to a disguise Remote Manager endpoint, optionally with Basic Auth. */
async function postSmc(
  mgmtIp: string,
  endpoint: string,
  payload: unknown,
  auth?: { user: string; pass: string },
  timeoutMs = 8000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(data)),
    }
    if (auth) {
      headers['Authorization'] =
        'Basic ' + Buffer.from(`${auth.user}:${auth.pass}`).toString('base64')
    }
    const req = http.request(
      {
        hostname: mgmtIp,
        port: 80,
        path: `/api/${endpoint}`,
        method: 'POST',
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => { body += chunk.toString() })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('timeout', () => { req.destroy(); reject(new Error('request timed out')) })
    req.on('error', (err) => reject(err))
    req.write(data)
    req.end()
  })
}

/** Validate that a string looks like an IPv4 address. */
function isValidIPv4(ip: string): boolean {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false
  return ip.split('.').every(o => { const n = Number(o); return n >= 0 && n <= 255 })
}

// ─── SSE: SMC network discovery ──────────────────────────────────────────────
// Query params: subnet, start, end, timeout

app.get('/api/smc/discover', async (req: Request, res: Response) => {
  sseHeaders(res)

  const subnet = (req.query.subnet as string) || '192.168.100'
  const start = parseInt(req.query.start as string) || 1
  const end = parseInt(req.query.end as string) || 254
  const timeout = parseInt(req.query.timeout as string) || 4000

  // Input validation
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(subnet)) {
    sendSse(res, 'error', { message: 'Invalid subnet format. Expected format: x.x.x (e.g. 192.168.100)' })
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
  if (!Number.isInteger(timeout) || timeout < 50 || timeout > 10000) {
    sendSse(res, 'error', { message: 'Invalid timeout: must be an integer between 50 and 10000' })
    res.end()
    return
  }

  let cancelled = false
  req.on('close', () => { cancelled = true })

  const total = end - start + 1
  let scanned = 0
  let found = 0
  const BATCH_SIZE = 8

  try {
    for (let batchStart = start; batchStart <= end && !cancelled; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, end)
      const batch: Promise<void>[] = []

      for (let i = batchStart; i <= batchEnd; i++) {
        const ip = `${subnet}.${i}`
        batch.push(
          (async () => {
            try {
              // Fast reachability check via /api/session
              await querySmc(ip, 'session', timeout)

              // Reachable — gather full data in parallel
              const [session, machine, adapters, power, chassis] = await Promise.all([
                querySmc(ip, 'session', timeout).catch(() => null),
                querySmc(ip, 'localmachine', timeout).catch(() => null),
                querySmc(ip, 'networkadapters', timeout).catch(() => null),
                querySmc(ip, 'chassis/power/status', timeout).catch(() => null),
                querySmc(ip, 'chassis/stats', timeout).catch(() => null),
              ])

              // Normalise adapter field names for the frontend
              const normalizedAdapters = Array.isArray(adapters)
                ? adapters.map((a: Record<string, string>) => ({
                    name: a.name ?? '',
                    ipAddress: a.ipAddress ?? a.ip ?? '',
                    macAddress: a.macAddress ?? a.mac ?? '',
                    netmask: a.netmask ?? '',
                  }))
                : []

              found++
              if (!cancelled) {
                sendSse(res, 'discovered', {
                  ip,
                  hostname: machine?.hostname ?? '',
                  serialNumber: machine?.serialNumber ?? '',
                  machineType: machine?.machineType ?? '',
                  role: session?.role ?? machine?.machineType ?? 'unknown',
                  adapters: normalizedAdapters,
                  power: power ?? {},
                  chassis: chassis ?? {},
                  session: session ?? {},
                })
              }
            } catch {
              // Not reachable — skip silently
            } finally {
              scanned++
              if (!cancelled) {
                sendSse(res, 'progress', {
                  percent: Math.round((scanned / total) * 100),
                  current: ip,
                })
              }
            }
          })()
        )
      }

      await Promise.all(batch)
    }

    if (!cancelled) {
      sendSse(res, 'complete', { message: 'SMC discovery complete', found })
    }
  } catch (err) {
    if (!cancelled) {
      sendSse(res, 'error', { message: `SMC discovery failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  res.end()
})

// ─── SMC single-server probe ─────────────────────────────────────────────────

app.get('/api/smc/probe', async (req: Request, res: Response) => {
  const ip = (req.query.ip as string) || ''
  if (!ip.trim()) {
    res.status(400).json({ success: false, message: 'ip query param is required' })
    return
  }
  if (!isValidIPv4(ip)) {
    res.status(400).json({ success: false, message: 'Invalid IPv4 address' })
    return
  }

  try {
    const [session, machine, adapters, power, chassis] = await Promise.all([
      querySmc(ip, 'session').catch(() => null),
      querySmc(ip, 'localmachine').catch(() => null),
      querySmc(ip, 'networkadapters').catch(() => null),
      querySmc(ip, 'chassis/power/status').catch(() => null),
      querySmc(ip, 'chassis/stats').catch(() => null),
    ])

    // Determine role from session or machine data
    const role = session?.role ?? machine?.machineType ?? 'unknown'

    // Normalise adapter field names for the frontend
    const normalizedAdapters = Array.isArray(adapters)
      ? adapters.map((a: Record<string, string>) => ({
          name: a.name ?? '',
          ipAddress: a.ipAddress ?? a.ip ?? '',
          macAddress: a.macAddress ?? a.mac ?? '',
          netmask: a.netmask ?? '',
        }))
      : []

    res.json({
      success: true,
      ip,
      hostname: machine?.hostname ?? '',
      serialNumber: machine?.serialNumber ?? '',
      machineType: machine?.machineType ?? '',
      role,
      adapters: normalizedAdapters,
      power: power ?? {},
      chassis: chassis ?? {},
      session: session ?? {},
    })
  } catch (err) {
    res.status(502).json({
      success: false,
      message: `SMC probe failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
})

// ─── SMC POST proxy endpoints ────────────────────────────────────────────────

app.post('/api/smc/led', async (req: Request, res: Response) => {
  const { ip, ledMode, ledR, ledG, ledB, auth } = req.body || {}
  if (!ip || !isValidIPv4(ip)) {
    res.status(400).json({ success: false, message: 'Valid ip is required' })
    return
  }

  const smcAuth = auth ? { user: auth.user, pass: auth.pass } : undefined

  try {
    const result = await postSmc(ip, 'ledstrip', { ledMode, ledR, ledG, ledB }, smcAuth)
    res.json({
      success: result.status >= 200 && result.status < 300,
      message: result.status >= 200 && result.status < 300
        ? 'LED strip updated'
        : `LED strip update failed (HTTP ${result.status})`,
    })
  } catch (err) {
    res.status(502).json({
      success: false,
      message: `LED request failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
})

app.post('/api/smc/identify', async (req: Request, res: Response) => {
  const { ip } = req.body || {}
  if (!ip || !isValidIPv4(ip)) {
    res.status(400).json({ success: false, message: 'Valid ip is required' })
    return
  }

  try {
    const result = await postSmc(ip, 'chassis/whoami', {})
    res.json({
      success: result.status >= 200 && result.status < 300,
      message: result.status >= 200 && result.status < 300
        ? 'Identify command sent'
        : `Identify failed (HTTP ${result.status})`,
    })
  } catch (err) {
    res.status(502).json({
      success: false,
      message: `Identify request failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
})

app.post('/api/smc/hostname', async (req: Request, res: Response) => {
  const { ip, hostname, auth } = req.body || {}
  if (!ip || !isValidIPv4(ip)) {
    res.status(400).json({ success: false, message: 'Valid ip is required' })
    return
  }
  if (!hostname || typeof hostname !== 'string') {
    res.status(400).json({ success: false, message: 'hostname is required' })
    return
  }
  if (!auth?.user || !auth?.pass) {
    res.status(400).json({ success: false, message: 'auth.user and auth.pass are required' })
    return
  }

  try {
    const result = await postSmc(ip, 'localmachine', { hostname }, auth)
    res.json({
      success: result.status >= 200 && result.status < 300,
      message: result.status >= 200 && result.status < 300
        ? `Hostname set to "${hostname}"`
        : `Hostname update failed (HTTP ${result.status})`,
    })
  } catch (err) {
    res.status(502).json({
      success: false,
      message: `Hostname request failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
})

app.post('/api/smc/adapters', async (req: Request, res: Response) => {
  const { ip, adapters, auth } = req.body || {}
  if (!ip || !isValidIPv4(ip)) {
    res.status(400).json({ success: false, message: 'Valid ip is required' })
    return
  }
  if (!Array.isArray(adapters) || adapters.length === 0) {
    res.status(400).json({ success: false, message: 'adapters array is required' })
    return
  }
  if (!auth?.user || !auth?.pass) {
    res.status(400).json({ success: false, message: 'auth.user and auth.pass are required' })
    return
  }

  const results: { mac: string; success: boolean; message: string }[] = []

  for (const adapter of adapters) {
    const { mac, ipAddress, netmask } = adapter || {}
    if (!mac) {
      results.push({ mac: mac || '??', success: false, message: 'mac is required' })
      continue
    }

    try {
      const result = await postSmc(
        ip,
        `networkadapters/${encodeURIComponent(mac)}`,
        { ipAddress, netmask },
        auth,
      )
      results.push({
        mac,
        success: result.status >= 200 && result.status < 300,
        message: result.status >= 200 && result.status < 300
          ? `Adapter ${mac} updated`
          : `Adapter ${mac} update failed (HTTP ${result.status})`,
      })
    } catch (err) {
      results.push({
        mac,
        success: false,
        message: `Adapter ${mac} failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  const allOk = results.every(r => r.success)
  res.json({
    success: allOk,
    message: allOk ? 'All adapters updated' : 'Some adapter updates failed',
    results,
  })
})

app.post('/api/smc/power', async (req: Request, res: Response) => {
  const { ip, action, auth } = req.body || {}
  if (!ip || !isValidIPv4(ip)) {
    res.status(400).json({ success: false, message: 'Valid ip is required' })
    return
  }
  if (!['on', 'off', 'cycle'].includes(action)) {
    res.status(400).json({ success: false, message: 'action must be "on", "off", or "cycle"' })
    return
  }
  if (!auth?.user || !auth?.pass) {
    res.status(400).json({ success: false, message: 'auth.user and auth.pass are required' })
    return
  }

  try {
    const result = await postSmc(ip, `chassis/power/${action}`, {}, auth)
    res.json({
      success: result.status >= 200 && result.status < 300,
      message: result.status >= 200 && result.status < 300
        ? `Power ${action} command sent`
        : `Power ${action} failed (HTTP ${result.status})`,
    })
  } catch (err) {
    res.status(502).json({
      success: false,
      message: `Power request failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
})

app.post('/api/smc/oled', async (req: Request, res: Response) => {
  const { ip, title, message: oledMessage, auth } = req.body || {}
  if (!ip || !isValidIPv4(ip)) {
    res.status(400).json({ success: false, message: 'Valid ip is required' })
    return
  }
  if (!auth?.user || !auth?.pass) {
    res.status(400).json({ success: false, message: 'auth.user and auth.pass are required' })
    return
  }

  try {
    const result = await postSmc(ip, 'chassis/oled', { title, message: oledMessage }, auth)
    res.json({
      success: result.status >= 200 && result.status < 300,
      message: result.status >= 200 && result.status < 300
        ? 'OLED message sent'
        : `OLED update failed (HTTP ${result.status})`,
    })
  } catch (err) {
    res.status(502).json({
      success: false,
      message: `OLED request failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
})

// ─── SMC LED FX orchestration ─────────────────────────────────────────────

/** Convert HSL to RGB (hue 0-360, sat 0-100, light 0-100). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = ln - c / 2
  let r1: number, g1: number, b1: number
  if (h < 60)       { r1 = c; g1 = x; b1 = 0 }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0 }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c }
  else              { r1 = c; g1 = 0; b1 = x }
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)]
}

app.get('/api/smc/fx', async (req: Request, res: Response) => {
  sseHeaders(res)

  const ips = ((req.query.ips as string) || '').split(',').filter(Boolean)
  const fx = (req.query.fx as string) || 'chase'
  const speed = Math.max(500, parseInt(req.query.speed as string) || 800)
  const loops = parseInt(req.query.loops as string) || 3
  const baseR = parseInt(req.query.r as string)
  const baseG = parseInt(req.query.g as string)
  const baseB = parseInt(req.query.b as string)
  const authUser = (req.query.auth_user as string) || ''
  const authPass = (req.query.auth_pass as string) || ''
  const smcAuth = authUser && authPass ? { user: authUser, pass: authPass } : undefined

  if (ips.length === 0 || ips.length > 8) {
    sendSse(res, 'error', { message: 'Provide 1-8 server IPs' })
    res.end()
    return
  }

  for (const ip of ips) {
    if (!isValidIPv4(ip)) {
      sendSse(res, 'error', { message: `Invalid IP: ${ip}` })
      res.end()
      return
    }
  }

  let cancelled = false
  req.on('close', () => { cancelled = true })

  // Helper: set LED on one server (fire-and-forget, don't let one failure kill the show)
  const setLed = (ip: string, r: number, g: number, b: number) =>
    postSmc(ip, 'ledstrip', { ledMode: 'static', ledR: r, ledG: g, ledB: b }, smcAuth).catch(() => {})

  // Helper: set all servers at once
  const setAll = (r: number, g: number, b: number) =>
    Promise.all(ips.map(ip => setLed(ip, r, g, b)))

  // Helper: delay with cancel check
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      if (cancelled) { resolve(); return }
      const timer = setTimeout(resolve, ms)
      req.on('close', () => { clearTimeout(timer); resolve() })
    })

  // ── FX definitions ──────────────────────────────────────────────────────

  type Frame = { targets: number[]; r: number; g: number; b: number }[]

  function generateFrames(): Frame[] {
    const n = ips.length
    const frames: Frame[] = []

    switch (fx) {
      // ── Chase: one lit server races across the line ──
      case 'chase': {
        const cr = isNaN(baseR) ? 0 : baseR
        const cg = isNaN(baseG) ? 120 : baseG
        const cb = isNaN(baseB) ? 255 : baseB
        for (let loop = 0; loop < loops; loop++) {
          for (let i = 0; i < n; i++) {
            const frame: Frame[0] = []
            for (let j = 0; j < n; j++) {
              frame.push({ targets: [j], r: j === i ? cr : 0, g: j === i ? cg : 0, b: j === i ? cb : 0 })
            }
            frames.push(frame)
          }
        }
        break
      }

      // ── Bounce: chase forward then backward ──
      case 'bounce': {
        const cr = isNaN(baseR) ? 255 : baseR
        const cg = isNaN(baseG) ? 0 : baseG
        const cb = isNaN(baseB) ? 128 : baseB
        for (let loop = 0; loop < loops; loop++) {
          const seq = [...Array(n).keys()]
          const bounceSeq = [...seq, ...seq.slice(1, -1).reverse()]
          for (const i of bounceSeq) {
            const frame: Frame[0] = []
            for (let j = 0; j < n; j++) {
              frame.push({ targets: [j], r: j === i ? cr : 0, g: j === i ? cg : 0, b: j === i ? cb : 0 })
            }
            frames.push(frame)
          }
        }
        break
      }

      // ── Rainbow: each server gets a different hue, rotating ──
      case 'rainbow': {
        for (let loop = 0; loop < loops; loop++) {
          for (let step = 0; step < n; step++) {
            const frame: Frame[0] = []
            for (let j = 0; j < n; j++) {
              const hue = ((j + step) / n) * 360
              const [r, g, b] = hslToRgb(hue, 100, 50)
              frame.push({ targets: [j], r, g, b })
            }
            frames.push(frame)
          }
        }
        break
      }

      // ── Pulse: all servers breathe together ──
      case 'pulse': {
        const cr = isNaN(baseR) ? 128 : baseR
        const cg = isNaN(baseG) ? 0 : baseG
        const cb = isNaN(baseB) ? 255 : baseB
        const steps = 12
        for (let loop = 0; loop < loops; loop++) {
          for (let s = 0; s < steps; s++) {
            const brightness = Math.sin((s / steps) * Math.PI)
            const frame: Frame[0] = [{
              targets: Array.from({ length: n }, (_, i) => i),
              r: Math.round(cr * brightness),
              g: Math.round(cg * brightness),
              b: Math.round(cb * brightness),
            }]
            frames.push(frame)
          }
        }
        break
      }

      // ── Alternate: even/odd servers swap colors ──
      case 'alternate': {
        const cr = isNaN(baseR) ? 255 : baseR
        const cg = isNaN(baseG) ? 0 : baseG
        const cb = isNaN(baseB) ? 0 : baseB
        for (let loop = 0; loop < loops; loop++) {
          for (let phase = 0; phase < 2; phase++) {
            const frame: Frame[0] = []
            for (let j = 0; j < n; j++) {
              const on = (j % 2 === phase)
              frame.push({ targets: [j], r: on ? cr : 0, g: on ? cg : 0, b: on ? cb : 0 })
            }
            frames.push(frame)
          }
        }
        break
      }

      // ── Wave: brightness wave rippling across servers ──
      case 'wave': {
        const cr = isNaN(baseR) ? 0 : baseR
        const cg = isNaN(baseG) ? 200 : baseG
        const cb = isNaN(baseB) ? 255 : baseB
        const steps = n * 2
        for (let loop = 0; loop < loops; loop++) {
          for (let s = 0; s < steps; s++) {
            const frame: Frame[0] = []
            for (let j = 0; j < n; j++) {
              const phase = ((j / n) - (s / steps)) * Math.PI * 2
              const brightness = (Math.sin(phase) + 1) / 2
              frame.push({
                targets: [j],
                r: Math.round(cr * brightness),
                g: Math.round(cg * brightness),
                b: Math.round(cb * brightness),
              })
            }
            frames.push(frame)
          }
        }
        break
      }

      // ── Split: left half vs right half alternate ──
      case 'split': {
        const half = Math.ceil(n / 2)
        for (let loop = 0; loop < loops; loop++) {
          // Left on, right off
          {
            const frame: Frame[0] = []
            for (let j = 0; j < n; j++) {
              const isLeft = j < half
              frame.push({
                targets: [j],
                r: isLeft ? 0 : 255,
                g: isLeft ? 150 : 0,
                b: isLeft ? 255 : 100,
              })
            }
            frames.push(frame)
          }
          // Swap
          {
            const frame: Frame[0] = []
            for (let j = 0; j < n; j++) {
              const isLeft = j < half
              frame.push({
                targets: [j],
                r: isLeft ? 255 : 0,
                g: isLeft ? 0 : 150,
                b: isLeft ? 100 : 255,
              })
            }
            frames.push(frame)
          }
        }
        break
      }

      // ── Converge: edges move inward to center then back out ──
      case 'converge': {
        const cr = isNaN(baseR) ? 255 : baseR
        const cg = isNaN(baseG) ? 200 : baseG
        const cb = isNaN(baseB) ? 0 : baseB
        for (let loop = 0; loop < loops; loop++) {
          // Converge in
          for (let d = 0; d <= Math.floor(n / 2); d++) {
            const frame: Frame[0] = []
            for (let j = 0; j < n; j++) {
              const on = (j === d || j === n - 1 - d)
              frame.push({ targets: [j], r: on ? cr : 0, g: on ? cg : 0, b: on ? cb : 0 })
            }
            frames.push(frame)
          }
          // Diverge out
          for (let d = Math.floor(n / 2) - 1; d >= 0; d--) {
            const frame: Frame[0] = []
            for (let j = 0; j < n; j++) {
              const on = (j === d || j === n - 1 - d)
              frame.push({ targets: [j], r: on ? cr : 0, g: on ? cg : 0, b: on ? cb : 0 })
            }
            frames.push(frame)
          }
        }
        break
      }

      // ── Stack: fill up one by one, then drain ──
      case 'stack': {
        const cr = isNaN(baseR) ? 0 : baseR
        const cg = isNaN(baseG) ? 255 : baseG
        const cb = isNaN(baseB) ? 0 : baseB
        for (let loop = 0; loop < loops; loop++) {
          // Fill
          for (let fill = 0; fill < n; fill++) {
            const frame: Frame[0] = []
            for (let j = 0; j < n; j++) {
              const on = j <= fill
              frame.push({ targets: [j], r: on ? cr : 0, g: on ? cg : 0, b: on ? cb : 0 })
            }
            frames.push(frame)
          }
          // Drain
          for (let fill = n - 1; fill >= 0; fill--) {
            const frame: Frame[0] = []
            for (let j = 0; j < n; j++) {
              const on = j <= fill
              frame.push({ targets: [j], r: on ? cr : 0, g: on ? cg : 0, b: on ? cb : 0 })
            }
            frames.push(frame)
          }
        }
        break
      }

      // ── Flash: all servers flash on/off ──
      case 'flash': {
        const cr = isNaN(baseR) ? 255 : baseR
        const cg = isNaN(baseG) ? 255 : baseG
        const cb = isNaN(baseB) ? 255 : baseB
        for (let loop = 0; loop < loops; loop++) {
          frames.push([{ targets: Array.from({ length: n }, (_, i) => i), r: cr, g: cg, b: cb }])
          frames.push([{ targets: Array.from({ length: n }, (_, i) => i), r: 0, g: 0, b: 0 }])
        }
        break
      }

      default:
        break
    }

    return frames
  }

  // ── Run the animation ──
  const frames = generateFrames()

  if (frames.length === 0) {
    sendSse(res, 'error', { message: `Unknown FX: ${fx}` })
    res.end()
    return
  }

  sendSse(res, 'start', { fx, servers: ips.length, frames: frames.length, speed })

  for (let f = 0; f < frames.length; f++) {
    if (cancelled) break

    const frame = frames[f]
    // Fire all LED commands for this frame concurrently
    await Promise.all(
      frame.map((cmd) =>
        Promise.all(cmd.targets.map((idx) => setLed(ips[idx], cmd.r, cmd.g, cmd.b)))
      )
    )

    sendSse(res, 'frame', { index: f, total: frames.length, percent: Math.round(((f + 1) / frames.length) * 100) })

    await wait(speed)
  }

  // Cleanup: turn all LEDs off at the end
  if (!cancelled) {
    await setAll(0, 0, 0)
  }

  sendSse(res, 'complete', { message: `FX "${fx}" finished`, framesPlayed: cancelled ? 'cancelled' : frames.length })
  res.end()
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
