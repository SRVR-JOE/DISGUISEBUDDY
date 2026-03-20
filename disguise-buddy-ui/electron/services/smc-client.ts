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
 * @param timeoutMs Request timeout in milliseconds (default 4000)
 */
export async function postSmc(mgmtIp: string, endpoint: string, body: any, timeoutMs = 4000): Promise<any> {
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

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: string) => {
          data += chunk
          if (data.length > MAX_BODY_BYTES) { req.destroy(); if (!settled) { settled = true; reject(new Error('Response body too large')) } return }
        })
        res.on('end', () => {
          if (!settled) { settled = true; try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON')) } }
        })
      },
    )

    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', (err) => { if (!settled) { settled = true; reject(err) } })
    req.write(payload)
    req.end()
  })
}
