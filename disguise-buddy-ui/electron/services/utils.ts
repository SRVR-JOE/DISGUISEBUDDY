/**
 * electron/services/utils.ts
 *
 * Shared utilities for all backend services:
 *   - runPowerShell()  — spawns powershell.exe, captures stdout/stderr/exitCode
 *   - delay()          — promise-based sleep
 */

import { spawn } from 'child_process'

// -- PowerShell execution -----------------------------------------------------

export interface PowerShellResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Runs a PowerShell command via powershell.exe and returns stdout, stderr
 * and the process exit code.
 *
 * Uses -EncodedCommand (base64 UTF-16LE) to avoid quoting/escaping issues.
 * Rejects only on spawn failure; a non-zero exit code is surfaced via
 * the resolved value so callers can decide how to handle it.
 */
export function runPowerShell(command: string): Promise<PowerShellResult> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(command, 'utf16le').toString('base64')

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-OutputFormat', 'Text',
      '-EncodedCommand', encoded,
    ], {
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (err) => {
      reject(new Error(`PowerShell spawn error: ${err.message}`))
    })

    child.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      })
    })
  })
}

// -- PowerShell availability check --------------------------------------------

/**
 * Checks whether `powershell.exe` is available on this system.
 *
 * Spawns `powershell.exe -NoProfile -Command "exit 0"` and resolves to `true`
 * if the process exits successfully, or `false` if the spawn fails (ENOENT on
 * macOS/Linux) or times out.
 */
export function isPowerShellAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], {
        windowsHide: true,
        timeout: 5000,
      })

      child.on('error', () => {
        resolve(false)
      })

      child.on('close', (code) => {
        resolve(code === 0)
      })
    } catch {
      resolve(false)
    }
  })
}

// -- WinRM prerequisites helper -----------------------------------------------

export interface WinRMReadyResult {
  success: boolean
  message: string
}

/**
 * Best-effort setup of local WinRM prerequisites before connecting to a remote
 * machine.
 *
 * 1. Starts the WinRM service on the LOCAL machine (needed for PowerShell
 *    remoting to work at all).
 * 2. Adds the target IP to the LOCAL TrustedHosts list so PowerShell does not
 *    reject connections to bare IP addresses.
 *
 * Both commands run locally — no -ComputerName or -Credential args.
 * Failures are logged as warnings but never abort the caller; the function
 * always resolves (never rejects).
 */
export async function ensureWinRMReady(targetIP: string): Promise<WinRMReadyResult> {
  const messages: string[] = []

  // Start the WinRM service if it is not already running
  try {
    const startResult = await runPowerShell(
      'Start-Service WinRM -ErrorAction SilentlyContinue'
    )
    if (startResult.exitCode === 0) {
      console.log('[utils] WinRM service started (or was already running)')
      messages.push('WinRM service ready')
    } else {
      const warn = `WinRM service start returned exit ${startResult.exitCode}: ${startResult.stderr || startResult.stdout}`
      console.warn(`[utils] ${warn}`)
      messages.push(warn)
    }
  } catch (err) {
    const warn = `Could not start WinRM service: ${err instanceof Error ? err.message : String(err)}`
    console.warn(`[utils] ${warn}`)
    messages.push(warn)
  }

  // Add the target IP to TrustedHosts so PowerShell accepts bare-IP connections
  try {
    const trustedResult = await runPowerShell(
      `Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value "${targetIP}" -Force`
    )
    if (trustedResult.exitCode === 0) {
      console.log(`[utils] Added ${targetIP} to WSMan TrustedHosts`)
      messages.push(`TrustedHosts updated for ${targetIP}`)
    } else {
      const warn = `TrustedHosts update returned exit ${trustedResult.exitCode}: ${trustedResult.stderr || trustedResult.stdout}`
      console.warn(`[utils] ${warn}`)
      messages.push(warn)
    }
  } catch (err) {
    const warn = `Could not update TrustedHosts: ${err instanceof Error ? err.message : String(err)}`
    console.warn(`[utils] ${warn}`)
    messages.push(warn)
  }

  return { success: true, message: messages.join('; ') }
}

// -- Timing helper ------------------------------------------------------------

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
