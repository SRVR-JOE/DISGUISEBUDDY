import express from 'express'
import cors from 'cors'
import type { Request, Response } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOFTWARE_DIR = path.resolve(__dirname, '..', '..', 'software')

const PORT = 47100
const app = express()

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors())
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

// ─── 404 fallback ─────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' })
})

// ─── Start ────────────────────────────────────────────────────────────────────

export function startApiServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`[api-server] Listening on http://localhost:${PORT}`)
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
