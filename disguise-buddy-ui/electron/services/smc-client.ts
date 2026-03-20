/**
 * electron/services/smc-client.ts
 *
 * HTTP client for querying disguise server SMC (BMC) APIs on the MGMT network.
 * No authentication is required for GET requests.
 */

import http from 'http'

const MAX_BODY_BYTES = 1_048_576

/**
 * Query a single disguise server's SMC API via HTTP GET.
 *
 * @param mgmtIp   Management-network IP (e.g. 192.168.100.200)
 * @param endpoint  API path after /api/ (e.g. 'localmachine', 'chassis/stats')
 * @param timeoutMs Request timeout in milliseconds (default 4000)
 */
export async function querySmc(mgmtIp: string, endpoint: string, timeoutMs = 4000): Promise<any> {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(mgmtIp)) {
    return Promise.reject(new Error('Invalid IP address'))
  }
  if (!/^[\w\/\-\.]+$/.test(endpoint)) {
    return Promise.reject(new Error('Invalid endpoint path'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const req = http.get(`http://${mgmtIp}/api/${endpoint}`, { timeout: timeoutMs }, (res) => {
      let data = ''
      res.on('data', (chunk: string) => {
        data += chunk
        if (data.length > MAX_BODY_BYTES) { req.destroy(); if (!settled) { settled = true; reject(new Error('Response body too large')) } return }
      })
      res.on('end', () => {
        if (!settled) { settled = true; try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON')) } }
      })
    })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', (err) => { if (!settled) { settled = true; reject(err) } })
  })
}

/**
 * POST to a single disguise server's SMC API.
 *
 * @param mgmtIp   Management-network IP
 * @param endpoint  API path after /api/
 * @param body      Request body (will be JSON-serialised)
 * @param auth      Optional Basic-auth credentials ({ user, pass })
 * @param timeoutMs Request timeout in milliseconds (default 4000)
 */
export async function postSmc(mgmtIp: string, endpoint: string, body: any, auth?: { user: string; pass: string }, timeoutMs = 4000): Promise<any> {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(mgmtIp)) {
    return Promise.reject(new Error('Invalid IP address'))
  }
  if (!/^[\w\/\-\.]+$/.test(endpoint)) {
    return Promise.reject(new Error('Invalid endpoint path'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const payload = JSON.stringify(body)
    const url = new URL(`http://${mgmtIp}/api/${endpoint}`)

    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    }

    if (auth) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${auth.user}:${auth.pass}`).toString('base64')
    }

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        timeout: timeoutMs,
        headers,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: string) => {
          data += chunk
          if (data.length > MAX_BODY_BYTES) { req.destroy(); if (!settled) { settled = true; reject(new Error('Response body too large')) } return }
        })
        res.on('end', () => {
          if (!settled) {
            settled = true
            try {
              const parsed = JSON.parse(data)
              // Attach HTTP status for callers that check it
              if (typeof parsed === 'object' && parsed !== null) {
                parsed.status = res.statusCode
              }
              resolve(parsed)
            } catch {
              // If body is not JSON, return a synthetic object with status
              resolve({ status: res.statusCode, body: data })
            }
          }
        })
      },
    )

    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', (err) => { if (!settled) { settled = true; reject(err) } })
    req.write(payload)
    req.end()
  })
}
