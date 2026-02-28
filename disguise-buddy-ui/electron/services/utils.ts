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

// -- Timing helper ------------------------------------------------------------

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
