/**
 * electron/services/smc-client.ts
 *
 * HTTP client for querying disguise server SMC (BMC) APIs on the MGMT network.
 * No authentication is required for GET requests.
 */

import http from 'http'

/**
 * Query a single disguise server's SMC API via HTTP GET.
 *
 * @param mgmtIp   Management-network IP (e.g. 192.168.100.200)
 * @param endpoint  API path after /api/ (e.g. 'localmachine', 'chassis/stats')
 * @param timeoutMs Request timeout in milliseconds (default 4000)
 */
export async function querySmc(mgmtIp: string, endpoint: string, timeoutMs = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${mgmtIp}/api/${endpoint}`, { timeout: timeoutMs }, (res) => {
      let data = ''
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON')) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
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
  return new Promise((resolve, reject) => {
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
        res.on('data', (chunk: string) => { data += chunk })
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON')) }
        })
      },
    )

    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}
