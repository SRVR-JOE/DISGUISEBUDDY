/**
 * electron/services/utils.ts
 *
 * Shared utilities for all backend services:
 *   - isDevMode()      — true when running outside Windows or with MOCK_BACKEND=true
 *   - runPowerShell()  — spawns powershell.exe, captures stdout/stderr/exitCode
 *   - delay()          — promise-based sleep for mock-mode timing
 */

import { platform } from 'os'
import { spawn } from 'child_process'

// ─── Dev-mode detection ──────────────────────────────────────────────────────

/**
 * Returns true when real system calls should NOT be made.
 *
 * Conditions:
 *  1. The environment variable MOCK_BACKEND is set to "true"
 *  2. The host OS is not Windows (darwin, linux, etc.)
 *
 * All three services (scanner, deployer, installer) call this before any
 * operation that touches real network sockets or PowerShell.
 */
export function isDevMode(): boolean {
  if (process.env.MOCK_BACKEND === 'true') return true
  return platform() !== 'win32'
}

// ─── PowerShell execution ────────────────────────────────────────────────────

export interface PowerShellResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Runs a PowerShell one-liner (or heredoc-style command string) via
 * powershell.exe and returns stdout, stderr and the process exit code.
 *
 * Encoding is forced to UTF-8 so that international characters in
 * hostnames, paths and share names survive the round-trip.
 *
 * Rejects only on spawn failure; a non-zero exit code is surfaced via
 * the resolved value so callers can decide how to handle it.
 */
export function runPowerShell(command: string): Promise<PowerShellResult> {
  return new Promise((resolve, reject) => {
    // -NoProfile  : skip $PROFILE (faster, avoids side-effects)
    // -NonInteractive : prevent prompts blocking the process
    // -OutputFormat Text : plain text output, not CLIXML
    // -EncodedCommand <base64> : safe transport for any quote / newline in command
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
      // Spawn itself failed (e.g. powershell.exe not found)
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

// ─── Timing helpers ──────────────────────────────────────────────────────────

/**
 * Resolves after `ms` milliseconds. Used in dev/mock mode to simulate
 * realistic step durations so the UI progress is meaningful during dev.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Returns a random integer between min and max (inclusive).
 * Useful for making mock ResponseTimeMs values look realistic.
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
