import express from 'express'
import cors from 'cors'
import type { Request, Response } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  getAdapters,
  configureAdapter,
  getProfiles,
  saveProfile,
  applyProfile,
  deleteProfile,
  getSmb,
  createShare,
  deleteShare,
  getIdentity,
  setHostname,
  getDashboard,
  getDiscovery,
} from './mock-data.js'
import { scanNetwork } from './services/scanner.js'
import { deployProfile } from './services/deployer.js'
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

// ─── Adapters ─────────────────────────────────────────────────────────────────

app.get('/api/adapters', (_req: Request, res: Response) => {
  res.json(getAdapters())
})

app.post('/api/adapters/:index/configure', (req: Request, res: Response) => {
  const index = parseInt(param(req.params.index), 10)
  if (isNaN(index)) {
    res.status(400).json({ success: false, message: 'Invalid adapter index' })
    return
  }
  const result = configureAdapter(index, req.body as Record<string, unknown>)
  res.status(result.success ? 200 : 400).json(result)
})

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
  const result = applyProfile(decodeURIComponent(param(req.params.name)))
  res.status(result.success ? 200 : 404).json(result)
})

app.delete('/api/profiles/:name', (req: Request, res: Response) => {
  const result = deleteProfile(decodeURIComponent(param(req.params.name)))
  res.status(result.success ? 200 : 404).json(result)
})

// ─── SMB ──────────────────────────────────────────────────────────────────────

app.get('/api/smb', (_req: Request, res: Response) => {
  res.json(getSmb())
})

app.post('/api/smb/shares', (req: Request, res: Response) => {
  const share = req.body
  if (!share || !share.Name || !share.Path) {
    res.status(400).json({ success: false, message: 'Share must have Name and Path' })
    return
  }
  const result = createShare(share)
  res.status(result.success ? 200 : 400).json(result)
})

app.delete('/api/smb/shares/:name', (req: Request, res: Response) => {
  const result = deleteShare(decodeURIComponent(param(req.params.name)))
  res.status(result.success ? 200 : 404).json(result)
})

// ─── Identity ─────────────────────────────────────────────────────────────────

app.get('/api/identity', (_req: Request, res: Response) => {
  res.json(getIdentity())
})

app.post('/api/identity', (req: Request, res: Response) => {
  const { hostname } = req.body as { hostname?: string }
  if (!hostname) {
    res.status(400).json({ success: false, message: 'hostname is required' })
    return
  }
  const result = setHostname(hostname)
  res.status(result.success ? 200 : 400).json(result)
})

// ─── Dashboard ────────────────────────────────────────────────────────────────

app.get('/api/dashboard', (_req: Request, res: Response) => {
  res.json(getDashboard())
})

// ─── Discovery (fleet list) ──────────────────────────────────────────────────

app.get('/api/discovery', (_req: Request, res: Response) => {
  res.json(getDiscovery())
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

app.get('/api/deploy', (req: Request, res: Response) => {
  sseHeaders(res)

  const server = (req.query.server as string) || ''
  const profileName = (req.query.profile as string) || ''

  const profiles = getProfiles()
  const profile = profiles.find(p => p.Name === profileName)

  if (!profile) {
    sendSse(res, 'error', { message: `Profile "${profileName}" not found` })
    res.end()
    return
  }

  const { cancel } = deployProfile(
    { targetIP: server, profile },
    {
      onStep: (step) => sendSse(res, 'progress', step),
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
        console.warn(`[api-server] Port ${PORT} already in use — continuing`)
        resolve()
      } else {
        reject(err)
      }
    })
  })
}
