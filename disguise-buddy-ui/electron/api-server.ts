import express from 'express'
import cors from 'cors'
import type { Request, Response } from 'express'
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

const PORT = 47100
const app = express()

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors())
app.use(express.json())

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const index = parseInt(req.params.index, 10)
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
  const result = applyProfile(decodeURIComponent(req.params.name))
  res.status(result.success ? 200 : 404).json(result)
})

app.delete('/api/profiles/:name', (req: Request, res: Response) => {
  const result = deleteProfile(decodeURIComponent(req.params.name))
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
  const result = deleteShare(decodeURIComponent(req.params.name))
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
// Query params: subnet, start, end
// Simulates a progressive subnet scan over ~3 seconds, emitting discovered servers.

app.get('/api/scan', (req: Request, res: Response) => {
  sseHeaders(res)

  const servers = getDiscovery()
  const total = servers.length
  const intervalMs = Math.floor(3000 / (total + 1))
  let index = 0

  sendSse(res, 'status', { message: 'Scan started', total })

  const interval = setInterval(() => {
    if (index < servers.length) {
      sendSse(res, 'discovered', servers[index])
      index++
    } else {
      sendSse(res, 'complete', { message: 'Scan complete', found: total })
      clearInterval(interval)
      res.end()
    }
  }, intervalMs)

  req.on('close', () => {
    clearInterval(interval)
  })
})

// ─── SSE: Profile deployment ──────────────────────────────────────────────────
// Query params: server, profile
// Simulates a multi-step deployment over ~3 seconds.

app.get('/api/deploy', (req: Request, res: Response) => {
  sseHeaders(res)

  const server = (req.query.server as string) || 'unknown'
  const profileName = (req.query.profile as string) || 'unknown'

  const steps = [
    { step: 'connect',    message: `Connecting to ${server}...` },
    { step: 'transfer',   message: `Transferring profile "${profileName}"...` },
    { step: 'apply',      message: 'Applying network configuration...' },
    { step: 'hostname',   message: 'Setting hostname...' },
    { step: 'smb',        message: 'Configuring SMB shares...' },
    { step: 'verify',     message: 'Verifying configuration...' },
  ]

  const intervalMs = Math.floor(3000 / steps.length)
  let stepIndex = 0

  sendSse(res, 'status', { message: `Deploying "${profileName}" to ${server}`, steps: steps.length })

  const interval = setInterval(() => {
    if (stepIndex < steps.length) {
      const current = steps[stepIndex]
      sendSse(res, 'progress', { ...current, stepNumber: stepIndex + 1, total: steps.length })
      stepIndex++
    } else {
      sendSse(res, 'complete', {
        success: true,
        message: `Profile "${profileName}" successfully deployed to ${server}`,
      })
      clearInterval(interval)
      res.end()
    }
  }, intervalMs)

  req.on('close', () => {
    clearInterval(interval)
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
        console.warn(`[api-server] Port ${PORT} already in use — continuing`)
        resolve()
      } else {
        reject(err)
      }
    })
  })
}
