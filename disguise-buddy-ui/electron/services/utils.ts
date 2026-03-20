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
export function runPowerShell(command: string, timeoutMs: number = 120000): Promise<PowerShellResult> {
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
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`PowerShell spawn error: ${err.message}`))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        resolve({
          stdout: stdout.trim(),
          stderr: `PowerShell command timed out after ${timeoutMs}ms`,
          exitCode: 1,
        })
      } else {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 1,
        })
      }
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
  let failed = false

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
      failed = true
    }
  } catch (err) {
    const warn = `Could not start WinRM service: ${err instanceof Error ? err.message : String(err)}`
    console.warn(`[utils] ${warn}`)
    messages.push(warn)
    failed = true
  }

  // Add the target IP to TrustedHosts so PowerShell accepts bare-IP connections
  try {
    const trustedResult = await runPowerShell(
      `$current = (Get-Item WSMan:\\localhost\\Client\\TrustedHosts).Value; ` +
      `if ($current -notmatch '(^|,)${targetIP.replace(/\./g, '\\\\.')}(,|$)') { ` +
      `Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value "${targetIP}" -Concatenate -Force }`
    )
    if (trustedResult.exitCode === 0) {
      console.log(`[utils] Added ${targetIP} to WSMan TrustedHosts`)
      messages.push(`TrustedHosts updated for ${targetIP}`)
    } else {
      const warn = `TrustedHosts update returned exit ${trustedResult.exitCode}: ${trustedResult.stderr || trustedResult.stdout}`
      console.warn(`[utils] ${warn}`)
      messages.push(warn)
      failed = true
    }
  } catch (err) {
    const warn = `Could not update TrustedHosts: ${err instanceof Error ? err.message : String(err)}`
    console.warn(`[utils] ${warn}`)
    messages.push(warn)
    failed = true
  }

  return { success: !failed, message: messages.join('; ') }
}

// -- DCOM WinRM bootstrap -----------------------------------------------------

export interface DCOMBootstrapResult {
  success: boolean
  message: string
}

/**
 * Uses DCOM/WMI (port 135, available by default on Windows) to remotely
 * enable WinRM on a target machine that does not yet have it configured.
 *
 * Strategy:
 *   1. Creates a CIM session to the remote machine using the DCOM protocol
 *   2. Uses Win32_Process.Create to launch a PowerShell process on the remote
 *      machine that calls Enable-PSRemoting, opens the firewall, and sets
 *      TrustedHosts
 *   3. Returns success if stdout contains "DCOM_BOOTSTRAP_OK"
 *
 * The entire bootstrap script runs locally — it creates a CIM session outward
 * to the target IP.  No .ps1 file is written to disk.
 */
export async function enableWinRMViaDCOM(
  targetIP: string,
  credential?: { username: string; password: string },
): Promise<DCOMBootstrapResult> {
  const username = credential?.username ?? 'd3'
  const password = credential?.password ?? 'disguise'

  // Escape values for embedding inside a double-quoted PowerShell string.
  // Backtick escapes the special characters PowerShell interprets inside "…".
  const escapedIP = targetIP.replace(/[`"$]/g, '`$&')
  const escapedUser = username.replace(/[`"$]/g, '`$&')
  const escapedPass = password.replace(/[`"$]/g, '`$&')

  // The remote-side command to be base64-encoded and executed via Win32_Process.
  // This runs *on the target machine* — no credential expansion needed here.
  const remoteCmd = [
    'Enable-PSRemoting -Force -SkipNetworkProfileCheck',
    'Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value * -Force',
    'New-NetFirewallRule -DisplayName "WinRM HTTP" -Direction Inbound -LocalPort 5985 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue',
  ].join('; ')

  const psScript = `
$ErrorActionPreference = "Stop"
$securePassword = ConvertTo-SecureString "${escapedPass}" -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential(".\\${escapedUser}", $securePassword)
$cimOptions = New-CimSessionOption -Protocol Dcom
$cimSession = New-CimSession -ComputerName "${escapedIP}" -Credential $credential -SessionOption $cimOptions -ErrorAction Stop
$enableScript = '${remoteCmd.replace(/'/g, "''")}'
$encodedScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($enableScript))
$result = Invoke-CimMethod -CimSession $cimSession -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine="powershell.exe -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encodedScript"}
if ($result.ReturnValue -ne 0) { throw "Win32_Process.Create failed with return code: $($result.ReturnValue)" }
Remove-CimSession $cimSession
Write-Output "DCOM_BOOTSTRAP_OK"
`.trim()

  console.log(`[utils] Attempting DCOM WinRM bootstrap for ${targetIP}...`)

  try {
    const result = await runPowerShell(psScript)

    if (result.exitCode === 0 && result.stdout.includes('DCOM_BOOTSTRAP_OK')) {
      const msg = `DCOM bootstrap succeeded for ${targetIP}`
      console.log(`[utils] ${msg}`)
      return { success: true, message: msg }
    }

    const errDetail = result.stderr || result.stdout || `exit code ${result.exitCode}`
    const msg = `DCOM bootstrap failed for ${targetIP}: ${errDetail}`
    console.error(`[utils] ${msg}`)
    return { success: false, message: msg }
  } catch (err) {
    const msg = `DCOM bootstrap threw for ${targetIP}: ${err instanceof Error ? err.message : String(err)}`
    console.error(`[utils] ${msg}`)
    return { success: false, message: msg }
  }
}

// -- SMB WinRM bootstrap ------------------------------------------------------

export interface SMBBootstrapResult {
  success: boolean
  message: string
}

/**
 * Uses SMB (port 445) + schtasks.exe to remotely enable WinRM on a target
 * machine.  This bypasses the need for both WinRM (5985) and DCOM/RPC (135).
 *
 * Strategy:
 *   1. Authenticates to the remote IPC$ share via `net use`
 *   2. Creates a scheduled task via `schtasks.exe /create /s` which routes
 *      RPC through the SMB named pipe \\PIPE\\atsvc (port 445 only)
 *   3. The task runs Enable-PSRemoting + firewall rule on the target
 *   4. Cleans up the scheduled task and IPC$ mapping
 *
 * Requires port 445 to be reachable on the target.
 */
export async function enableWinRMViaSMB(
  targetIP: string,
  credential?: { username: string; password: string },
): Promise<SMBBootstrapResult> {
  const username = credential?.username ?? 'd3'
  const password = credential?.password ?? 'disguise'
  const taskName = `DisguiseBuddy_${Date.now()}`

  // Escape values for embedding inside PowerShell double-quoted strings.
  // Backtick escapes the special characters PowerShell interprets inside "…".
  const escapePs = (s: string): string => s.replace(/[`"$]/g, '`$&')
  const escapedUser = escapePs(username)
  const escapedPass = escapePs(password)

  console.log(`[utils] Attempting SMB WinRM bootstrap for ${targetIP}...`)

  // 1. Connect to IPC$ to verify SMB is reachable
  const connectResult = await runPowerShell(
    `net use "\\\\${targetIP}\\IPC$" /user:"${escapedUser}" "${escapedPass}" 2>&1`
  )

  if (connectResult.exitCode !== 0 && !connectResult.stdout.includes('already')) {
    const msg = `SMB connection to ${targetIP} failed (port 445 may be blocked): ${connectResult.stderr || connectResult.stdout}`
    console.error(`[utils] ${msg}`)
    return { success: false, message: msg }
  }

  console.log(`[utils] SMB connected to ${targetIP}`)

  try {
    // 2. Create a scheduled task that enables WinRM
    // Use -EncodedCommand to avoid all quoting issues with schtasks /tr
    const enableCmd = [
      'Enable-PSRemoting -Force -SkipNetworkProfileCheck',
      'Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value * -Force',
      'New-NetFirewallRule -DisplayName "WinRM HTTP" -Direction Inbound -LocalPort 5985 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue',
      'Restart-Service WinRM',
    ].join('; ')

    const encodedCmd = Buffer.from(enableCmd, 'utf16le').toString('base64')

    const createResult = await runPowerShell(
      `schtasks.exe /create /s ${targetIP} /u "${escapedUser}" /p "${escapedPass}"` +
      ` /tn "${taskName}"` +
      ` /tr "powershell.exe -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedCmd}"` +
      ` /sc once /st 00:00 /ru SYSTEM /rl HIGHEST /f`
    )

    if (createResult.exitCode !== 0) {
      const msg = `schtasks create failed on ${targetIP}: ${createResult.stderr || createResult.stdout}`
      console.error(`[utils] ${msg}`)
      return { success: false, message: msg }
    }

    console.log(`[utils] Scheduled task "${taskName}" created on ${targetIP}`)

    // 3. Run the task immediately
    const runResult = await runPowerShell(
      `schtasks.exe /run /s ${targetIP} /u "${escapedUser}" /p "${escapedPass}" /tn "${taskName}"`
    )

    if (runResult.exitCode !== 0) {
      const msg = `schtasks run failed on ${targetIP}: ${runResult.stderr || runResult.stdout}`
      console.error(`[utils] ${msg}`)
      return { success: false, message: msg }
    }

    console.log(`[utils] Scheduled task running on ${targetIP}, waiting for completion...`)

    // 4. Wait for the task to finish (poll status)
    await delay(5000)

    for (let i = 0; i < 6; i++) {
      const statusResult = await runPowerShell(
        `schtasks.exe /query /s ${targetIP} /u "${escapedUser}" /p "${escapedPass}" /tn "${taskName}" /fo CSV /nh`
      )
      if (statusResult.stdout.includes('Ready') || statusResult.stdout.includes('Could not')) {
        break
      }
      console.log(`[utils] Task still running on ${targetIP}, waiting...`)
      await delay(3000)
    }

    // 5. Clean up the scheduled task
    await runPowerShell(
      `schtasks.exe /delete /s ${targetIP} /u "${escapedUser}" /p "${escapedPass}" /tn "${taskName}" /f`
    ).catch(() => { /* best-effort cleanup */ })

    console.log(`[utils] SMB bootstrap completed for ${targetIP}`)
    return { success: true, message: `SMB bootstrap succeeded for ${targetIP}` }
  } finally {
    // Disconnect IPC$ (best-effort)
    await runPowerShell(`net use "\\\\${targetIP}\\IPC$" /delete /y 2>&1`).catch(() => {})
  }
}

// -- Timing helper ------------------------------------------------------------

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
