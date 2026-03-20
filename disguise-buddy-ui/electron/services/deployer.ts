/**
 * electron/services/deployer.ts
 *
 * Deploys a configuration profile to a remote disguise server.
 *
 * Transport priority:
 *   A. SMB Direct (preferred) — requires only port 445
 *      1. Connect to \\TARGET\IPC$ via net use
 *      2. Write the full deployment script to \\TARGET\ADMIN$\Temp\ via Set-Content
 *         (falls back to \\TARGET\C$\Windows\Temp\ if ADMIN$ is inaccessible)
 *      3. Create a scheduled task via schtasks.exe /create /s
 *      4. Run the task via schtasks.exe /run /s
 *      5. Poll task status every 3 s (up to 60 s) until "Ready" / not "Running"
 *      6. Read result JSON from \\TARGET\ADMIN$\Temp\disguisebuddy_result.json
 *      7. Clean up task, script file, IPC$ mapping
 *
 *   B. WinRM Fallback — requires port 5985 (or DCOM/SMB bootstrap)
 *      Classic Invoke-Command / Rename-Computer -ComputerName approach.
 *      Only attempted when SMB Direct fails.
 */

import net from 'net'
import {
  runPowerShell,
  delay,
  ensureWinRMReady,
  enableWinRMViaSMB,
  enableWinRMViaDCOM,
} from './utils.ts'

// -- Deploy mutex -------------------------------------------------------------

const activeDeployments = new Set<string>()

// -- Public types -------------------------------------------------------------

export interface AdapterConfig {
  Index: number
  Role: string
  DisplayName: string
  AdapterName: string
  IPAddress: string
  SubnetMask: string
  Gateway: string
  DNS1: string
  DNS2: string
  DHCP: boolean
  VLANID: number | null
  Enabled: boolean
}

export interface SmbShare {
  Name: string
  Path: string
  Description: string
  ShareState: string
  IsD3Share: boolean
}

export interface SMBSettings {
  ShareD3Projects: boolean
  ProjectsPath: string
  ShareName: string
  SharePermissions: string
  AdditionalShares: SmbShare[]
}

export interface Profile {
  Name: string
  Description: string
  Created: string
  Modified: string
  ServerName: string
  NetworkAdapters: AdapterConfig[]
  SMBSettings: SMBSettings
  CustomSettings: Record<string, unknown>
}

export interface DeployOptions {
  targetIP: string
  profile: Profile
  credential?: {
    username: string
    password: string
  }
}

export interface DeployStep {
  step: string
  message: string
  stepNumber: number
  total: number
}

export interface DeployCallbacks {
  onStep: (step: DeployStep) => void
  onComplete: (result: { success: boolean; message: string }) => void
  onError: (error: Error) => void
}

// -- Step definitions ---------------------------------------------------------

// SMB Direct steps (8 total)
const SMB_STEPS = [
  'smb-connect',    // 1 — net use IPC$
  'script-upload',  // 2 — write .ps1 to ADMIN$/C$ share
  'task-create',    // 3 — schtasks /create
  'task-run',       // 4 — schtasks /run
  'task-wait',      // 5 — poll until "Ready"
  'results',        // 6 — read result JSON
  'cleanup',        // 7 — delete task + script, disconnect IPC$
  'verify',         // 8 — TCP probe
] as const

// WinRM Fallback steps (6 total — matches legacy flow)
const WINRM_STEPS = [
  'setup',    // 1
  'connect',  // 2
  'hostname', // 3
  'network',  // 4
  'smb',      // 5
  'verify',   // 6
] as const

type SmbStepId = (typeof SMB_STEPS)[number]
type WinrmStepId = (typeof WINRM_STEPS)[number]

// -- Public API ---------------------------------------------------------------

export function deployProfile(
  options: DeployOptions,
  callbacks: DeployCallbacks,
): { cancel: () => void } {
  let cancelled = false
  const cancel = () => { cancelled = true }

  const run = async () => {
    try {
      await runLiveDeploy(options, callbacks, () => cancelled)
    } catch (err) {
      if (!cancelled) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  run().catch((err) => {
    if (!cancelled) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    }
  })

  return { cancel }
}

// -- Live implementation ------------------------------------------------------

async function runLiveDeploy(
  options: DeployOptions,
  callbacks: DeployCallbacks,
  isCancelled: () => boolean,
): Promise<void> {
  const { targetIP, profile, credential } = options

  if (activeDeployments.has(targetIP)) {
    throw new Error(`A deployment to ${targetIP} is already in progress.`)
  }
  activeDeployments.add(targetIP)

  try {
    await runLiveDeployInner(options, callbacks, isCancelled)
  } finally {
    activeDeployments.delete(targetIP)
  }
}

async function runLiveDeployInner(
  options: DeployOptions,
  callbacks: DeployCallbacks,
  isCancelled: () => boolean,
): Promise<void> {
  const { targetIP, profile, credential } = options

  const username = credential?.username ?? 'd3'
  const password = credential?.password ?? 'disguise'
  const escapedUser = escapePs(username)
  const escapedPass = escapePs(password)

  // ── Attempt Transport A: SMB Direct ─────────────────────────────────────

  const smbTotal = SMB_STEPS.length

  const smbStep = (id: SmbStepId, message: string) => {
    if (isCancelled()) return
    const stepNumber = SMB_STEPS.indexOf(id) + 1
    callbacks.onStep({ step: id, message, stepNumber, total: smbTotal })
  }

  // Step 1: Connect to IPC$ — this is the SMB transport smoke-test
  smbStep('smb-connect', `Testing SMB connectivity to ${targetIP}...`)
  if (isCancelled()) return

  const ipcConnect = await runPowerShell(
    `net use "\\\\${targetIP}\\IPC$" /user:"${escapedUser}" "${escapedPass}" 2>&1`
  ).catch(() => null)

  const smbReachable =
    ipcConnect !== null &&
    (ipcConnect.exitCode === 0 || (ipcConnect.stdout ?? '').toLowerCase().includes('already'))

  if (smbReachable) {
    console.log(`[deployer] SMB connected to ${targetIP} — using SMB Direct transport`)

    try {
      await runSmbDirect({
        targetIP,
        profile,
        username,
        password,
        smbStep,
        isCancelled,
      })

      if (!isCancelled()) {
        callbacks.onComplete({
          success: true,
          message: `Profile "${profile.Name}" successfully deployed to ${targetIP} via SMB`,
        })
      }
      return
    } catch (smbErr) {
      const msg = smbErr instanceof Error ? smbErr.message : String(smbErr)
      console.error(`[deployer] SMB Direct failed: ${msg} — falling back to WinRM`)
      // Fall through to WinRM path below
    }
  } else {
    const reason = ipcConnect
      ? (ipcConnect.stderr || ipcConnect.stdout || `exit ${ipcConnect.exitCode}`)
      : 'spawn failed'
    console.warn(`[deployer] SMB not reachable on ${targetIP}: ${reason} — trying WinRM`)
  }

  // ── Transport B: WinRM Fallback ──────────────────────────────────────────

  console.log(`[deployer] Attempting WinRM fallback for ${targetIP}`)
  await runWinrmDeploy(options, callbacks, isCancelled)
}

// -- SMB Direct transport -----------------------------------------------------

interface SmbDirectOptions {
  targetIP: string
  profile: Profile
  username: string
  password: string
  smbStep: (id: SmbStepId, message: string) => void
  isCancelled: () => boolean
}

async function runSmbDirect(opts: SmbDirectOptions): Promise<void> {
  const { targetIP, profile, username, password, smbStep, isCancelled } = opts
  const escapedUser = escapePs(username)
  const escapedPass = escapePs(password)

  const taskName = 'DisguiseBuddy_Deploy'
  const scriptFileName = 'disguisebuddy_deploy.ps1'
  const resultFileName = 'disguisebuddy_result.json'

  // Remote path as seen by PowerShell running locally (routed through the admin share).
  // ADMIN$ maps to C:\Windows on the remote machine, so ADMIN$\Temp = C:\Windows\Temp.
  // C$ maps to C:\ so C$\Windows\Temp = C:\Windows\Temp — same destination, different share.
  //
  // UNC paths in PowerShell strings: backslash is NOT special in PS double-quoted strings,
  // so the JS string only needs standard JS-literal backslash escaping (each \ → \\).
  //
  // Result: JS  `\\\\TARGET\\ADMIN$`  →  actual string  \\TARGET\ADMIN$  → correct UNC
  const scriptLocalPath = `C:\\Windows\\Temp\\${scriptFileName}`

  const adminShareUNC   = `\\\\${targetIP}\\ADMIN$\\Temp\\${scriptFileName}`
  const adminResultUNC  = `\\\\${targetIP}\\ADMIN$\\Temp\\${resultFileName}`
  const cDollarShareUNC = `\\\\${targetIP}\\C$\\Windows\\Temp\\${scriptFileName}`
  const cDollarResultUNC = `\\\\${targetIP}\\C$\\Windows\\Temp\\${resultFileName}`

  // Step 2: Determine which admin share is accessible and upload the script
  smbStep('script-upload', `Uploading deployment script to ${targetIP}...`)
  if (isCancelled()) return

  const deployScript = buildDeployScript(profile)

  // Try ADMIN$ first; fall back to C$ if permission denied
  let scriptUNC = adminShareUNC
  let resultUNC = adminResultUNC
  let uploadOk = false

  const tryUpload = async (unc: string): Promise<boolean> => {
    // Encode the deploy script as UTF-16LE base64 so it can be embedded as a
    // single-quoted PS literal (base64 alphabet never contains single-quotes).
    // Set-Content uses single-quoted path so $ in share names (ADMIN$) is not
    // expanded as a variable by PowerShell.
    const scriptB64 = Buffer.from(deployScript, 'utf16le').toString('base64')

    // Escape any single-quotes that appear in the UNC path (shouldn't happen
    // in practice, but be defensive).
    const safePath = unc.replace(/'/g, "''")

    const uploadCmd =
      `$bytes = [Convert]::FromBase64String('${scriptB64}'); ` +
      `$text = [System.Text.Encoding]::Unicode.GetString($bytes); ` +
      `Set-Content -Path '${safePath}' -Value $text -Encoding Unicode -Force -ErrorAction Stop`

    const result = await runPowerShell(uploadCmd)
    return result.exitCode === 0
  }

  uploadOk = await tryUpload(adminShareUNC)

  if (!uploadOk) {
    console.warn(`[deployer] ADMIN$ upload failed — trying C$ fallback`)
    scriptUNC = cDollarShareUNC
    resultUNC = cDollarResultUNC
    uploadOk = await tryUpload(cDollarShareUNC)
  }

  if (!uploadOk) {
    throw new Error(
      `Could not write deployment script to ${targetIP} via ADMIN$ or C$ share. ` +
      `Ensure the account has access to administrative shares.`
    )
  }

  console.log(`[deployer] Deployment script uploaded to ${scriptUNC}`)

  // Step 3: Create the scheduled task
  smbStep('task-create', `Creating scheduled task on ${targetIP}...`)
  if (isCancelled()) return

  // Delete any stale task first (best-effort)
  await runPowerShell(
    `schtasks.exe /delete /s ${targetIP} /u "${escapedUser}" /p "${escapedPass}" /tn "${taskName}" /f 2>&1`
  ).catch(() => {})

  const createResult = await runPowerShell(
    `schtasks.exe /create` +
    ` /s ${targetIP}` +
    ` /u "${escapePs(username)}"` +
    ` /p "${escapePs(password)}"` +
    ` /tn "${taskName}"` +
    ` /tr "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${scriptLocalPath}"` +
    ` /sc once /st 00:00 /ru SYSTEM /rl HIGHEST /f`
  )

  if (createResult.exitCode !== 0) {
    throw new Error(
      `Failed to create scheduled task on ${targetIP}: ` +
      (createResult.stderr || createResult.stdout)
    )
  }

  console.log(`[deployer] Scheduled task "${taskName}" created on ${targetIP}`)

  // Step 4: Run the task
  smbStep('task-run', `Executing deployment script on ${targetIP}...`)
  if (isCancelled()) return

  const runResult = await runPowerShell(
    `schtasks.exe /run /s ${targetIP} /u "${escapedUser}" /p "${escapedPass}" /tn "${taskName}"`
  )

  if (runResult.exitCode !== 0) {
    throw new Error(
      `Failed to start scheduled task on ${targetIP}: ` +
      (runResult.stderr || runResult.stdout)
    )
  }

  console.log(`[deployer] Deployment task started on ${targetIP}`)

  // Step 5: Poll for completion (up to 60 s, 3 s interval = 20 attempts)
  smbStep('task-wait', `Waiting for deployment to complete on ${targetIP}...`)
  if (isCancelled()) return

  const MAX_POLLS = 20
  let taskDone = false

  for (let i = 1; i <= MAX_POLLS; i++) {
    if (isCancelled()) return
    await delay(3000)

    const queryResult = await runPowerShell(
      `schtasks.exe /query /s ${targetIP} /u "${escapedUser}" /p "${escapedPass}" /tn "${taskName}" /fo CSV /nh 2>&1`
    )

    const output = queryResult.stdout.toLowerCase()

    if (output.includes('"ready"') || output.includes(',ready,') || output.includes(', ready')) {
      taskDone = true
      console.log(`[deployer] Task finished after poll ${i}`)
      break
    }

    // Task was deleted externally or completed with no status entry
    if (queryResult.exitCode !== 0 || output.includes('could not') || output.includes('error')) {
      console.warn(`[deployer] Task query returned unexpected result — treating as done`)
      taskDone = true
      break
    }

    console.log(`[deployer] Poll ${i}/${MAX_POLLS} — task still running`)
  }

  if (!taskDone) {
    console.warn(`[deployer] Task did not reach "Ready" in 60 s — proceeding to read results anyway`)
  }

  // Give the script a moment to flush its JSON output before we read it
  await delay(1000)

  // Step 6: Read the result JSON
  smbStep('results', `Reading deployment results from ${targetIP}...`)
  if (isCancelled()) return

  const safeResultUNC = resultUNC.replace(/'/g, "''")
  const readResult = await runPowerShell(
    `Get-Content -Path '${safeResultUNC}' -Raw -ErrorAction Stop`
  )

  if (readResult.exitCode !== 0 || !readResult.stdout.trim()) {
    console.warn(
      `[deployer] Could not read result file from ${resultUNC}: ` +
      (readResult.stderr || readResult.stdout || 'empty output')
    )
    // Clean up before returning so we don't leave temp files behind
    const safeScriptUNCEarly = scriptUNC.replace(/'/g, "''")
    await Promise.allSettled([
      runPowerShell(
        `schtasks.exe /delete /s ${targetIP} /u "${escapedUser}" /p "${escapedPass}" /tn "${taskName}" /f 2>&1`
      ),
      runPowerShell(`Remove-Item -Path '${safeScriptUNCEarly}' -Force -ErrorAction SilentlyContinue`),
      runPowerShell(`Remove-Item -Path '${safeResultUNC}' -Force -ErrorAction SilentlyContinue`),
    ])
    await runPowerShell(`net use "\\\\${targetIP}\\IPC$" /delete /y 2>&1`).catch(() => {})
    throw new Error(
      'Deployment executed but results could not be verified. Check the server manually.'
    )
  } else {
    try {
      const parsed = JSON.parse(readResult.stdout.trim()) as {
        success?: boolean
        messages?: string[]
      }
      if (parsed.success === false) {
        const msgs = (parsed.messages ?? []).join('; ')
        throw new Error(`Deployment script reported failure on ${targetIP}: ${msgs}`)
      }
      const msgs = (parsed.messages ?? []).join('; ')
      console.log(`[deployer] Remote script results: ${msgs}`)
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) {
        console.error(`[deployer] Could not parse result JSON from ${targetIP}: ${readResult.stdout}`)
        throw new Error(
          `Deployment completed on ${targetIP} but result file contained invalid JSON. ` +
          `Check the server manually. Raw: ${readResult.stdout.substring(0, 200)}`
        )
      } else {
        throw parseErr
      }
    }
  }

  // Step 7: Cleanup
  smbStep('cleanup', `Cleaning up temporary files on ${targetIP}...`)
  if (isCancelled()) return

  const safeScriptUNC = scriptUNC.replace(/'/g, "''")
  await Promise.allSettled([
    // Delete the scheduled task
    runPowerShell(
      `schtasks.exe /delete /s ${targetIP} /u "${escapedUser}" /p "${escapedPass}" /tn "${taskName}" /f 2>&1`
    ),
    // Delete the script file
    runPowerShell(`Remove-Item -Path '${safeScriptUNC}' -Force -ErrorAction SilentlyContinue`),
    // Delete the result file
    runPowerShell(`Remove-Item -Path '${safeResultUNC}' -Force -ErrorAction SilentlyContinue`),
  ])

  // Disconnect IPC$
  await runPowerShell(
    `net use "\\\\${targetIP}\\IPC$" /delete /y 2>&1`
  ).catch(() => {})

  console.log(`[deployer] Cleanup complete for ${targetIP}`)

  // Step 8: Verify
  smbStep('verify', `Verifying ${targetIP} is still reachable...`)
  if (isCancelled()) return

  await delay(2000)
  const alive = await tcpProbe(targetIP, 445, 5000)
  if (!alive) {
    console.warn(
      `[deployer] ${targetIP} not reachable on port 445 after deploy — IP may have changed`
    )
  }
}

// -- WinRM fallback transport -------------------------------------------------

async function runWinrmDeploy(
  options: DeployOptions,
  callbacks: DeployCallbacks,
  isCancelled: () => boolean,
): Promise<void> {
  const { targetIP, profile, credential } = options
  const total = WINRM_STEPS.length

  const credArg = buildCredentialArg(credential)

  const step = (id: WinrmStepId, message: string) => {
    if (isCancelled()) return
    const stepNumber = WINRM_STEPS.indexOf(id) + 1
    callbacks.onStep({ step: id, message, stepNumber, total })
  }

  // Step 1: Configure local WinRM prerequisites (best-effort, non-fatal)
  step('setup', 'Configuring WinRM prerequisites...')
  if (isCancelled()) return

  const prereqResult = await ensureWinRMReady(targetIP)
  if (!prereqResult.success) {
    console.warn(`[deployer] WinRM prerequisites failed: ${prereqResult.message}`)
  }

  // Step 2: Test WinRM connectivity (with DCOM bootstrap fallback)
  step('connect', `Testing WinRM connectivity to ${targetIP}...`)
  if (isCancelled()) return

  const authArg = credential ? ' -Authentication Negotiate' : ''

  let wsmanResult = await runPowerShell(
    `Test-WSMan -ComputerName ${targetIP}${credArg}${authArg} -ErrorAction Stop`
  ).catch((spawnErr: unknown) => {
    const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr)
    if (msg.includes('ENOENT') || msg.includes('spawn')) {
      throw new Error(
        'PowerShell is not available. Profile deployment requires Windows with PowerShell and WinRM configured.'
      )
    }
    throw spawnErr
  })

  // WinRM not reachable — try SMB bootstrap, then DCOM bootstrap
  if (wsmanResult.exitCode !== 0) {
    let bootstrapSucceeded = false

    step('connect', 'WinRM not available — enabling via SMB (port 445)...')
    console.log('[deployer] WinRM not available, attempting SMB bootstrap...')

    const smbBootstrap = await enableWinRMViaSMB(targetIP, credential)
    if (smbBootstrap.success) {
      bootstrapSucceeded = true
      console.log('[deployer] SMB bootstrap succeeded')
    } else {
      step('connect', 'SMB not available — trying DCOM (port 135)...')
      console.log(`[deployer] SMB bootstrap failed: ${smbBootstrap.message}`)

      const dcomBootstrap = await enableWinRMViaDCOM(targetIP, credential)
      if (dcomBootstrap.success) {
        bootstrapSucceeded = true
        console.log('[deployer] DCOM bootstrap succeeded')
      } else {
        console.log(`[deployer] DCOM bootstrap failed: ${dcomBootstrap.message}`)
      }
    }

    if (!bootstrapSucceeded) {
      throw new Error(
        `Cannot reach ${targetIP} remotely (SMB Direct, WinRM, SMB bootstrap, and DCOM all failed). ` +
        `Run this on the target server in an Admin PowerShell: ` +
        `Enable-PSRemoting -Force -SkipNetworkProfileCheck`
      )
    }

    // Give WinRM time to start
    step('connect', 'Waiting for WinRM service to start...')
    await delay(8000)

    let winrmReady = false
    for (let attempt = 1; attempt <= 6; attempt++) {
      if (isCancelled()) return

      try {
        wsmanResult = await runPowerShell(
          `Test-WSMan -ComputerName ${targetIP}${credArg}${authArg} -ErrorAction Stop`
        )
        if (wsmanResult.exitCode === 0) {
          winrmReady = true
          console.log(`[deployer] WinRM became available after attempt ${attempt}`)
          break
        }
      } catch (retryErr) {
        const errMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
        if (errMsg.includes('ENOENT') || errMsg.includes('spawn')) {
          throw retryErr // PowerShell not available — no point retrying
        }
        console.warn(`[deployer] WinRM retry ${attempt}/6 error: ${errMsg}`)
      }

      console.log(`[deployer] WinRM retry ${attempt}/6 — not yet ready`)
      if (attempt < 6) await delay(5000)
    }

    if (!winrmReady) {
      throw new Error(
        `WinRM did not become available on ${targetIP} after bootstrap (waited ~38s). ` +
        `Run this on the target server in an Admin PowerShell: ` +
        `Enable-PSRemoting -Force -SkipNetworkProfileCheck`
      )
    }
  }

  step('connect', `WinRM connected to ${targetIP}`)

  // Step 3: Set hostname
  step('hostname', `Setting hostname to "${profile.ServerName}"...`)
  if (isCancelled()) return

  const renameResult = await runPowerShell(
    `Rename-Computer -ComputerName ${targetIP} -NewName "${sanitiseName(profile.ServerName)}"` +
    ` -Force${credArg} -ErrorAction Stop`
  )
  if (renameResult.exitCode !== 0) {
    throw new Error(`Hostname rename failed: ${renameResult.stderr || renameResult.stdout}`)
  }

  // Step 4: Configure network adapters
  const enabledAdapters = profile.NetworkAdapters.filter((a) => a.Enabled)
  step('network', `Configuring ${enabledAdapters.length} network adapter(s)...`)
  if (isCancelled()) return

  const failedAdapters: string[] = []

  for (const adapter of enabledAdapters) {
    if (isCancelled()) return

    const psBlock = buildAdapterScript(adapter)
    if (!psBlock) continue

    const adapterResult = await runPowerShell(
      `Invoke-Command -ComputerName ${targetIP}${credArg} -ScriptBlock { ${psBlock} } -ErrorAction Stop`
    )
    if (adapterResult.exitCode !== 0) {
      const detail = adapterResult.stderr || adapterResult.stdout
      console.error(
        `[deployer] Adapter ${adapter.Index} (${adapter.DisplayName}) config failed: ${detail}`
      )
      failedAdapters.push(`${adapter.DisplayName} (${detail})`)
    }
  }

  // Step 5: Configure SMB shares
  step('smb', 'Configuring SMB shares...')
  if (isCancelled()) return

  let smbFailed = false
  let smbFailDetail = ''

  const smbScript = buildSmbScript(profile.SMBSettings)
  if (smbScript) {
    const smbResult = await runPowerShell(
      `Invoke-Command -ComputerName ${targetIP}${credArg} -ScriptBlock { ${smbScript} } -ErrorAction Stop`
    )
    if (smbResult.exitCode !== 0) {
      smbFailDetail = smbResult.stderr || smbResult.stdout
      console.error(`[deployer] SMB configuration failed: ${smbFailDetail}`)
      smbFailed = true
    }
  }

  // Schedule reboot if hostname was changed
  if (profile.ServerName) {
    const rebootResult = await runPowerShell(
      `Invoke-Command -ComputerName ${targetIP}${credArg} -ScriptBlock { shutdown /r /t 30 /f } -ErrorAction SilentlyContinue`
    )
    if (rebootResult.exitCode === 0) {
      callbacks.onStep({ step: 'verify', message: 'Server will reboot in 30 seconds', stepNumber: WINRM_STEPS.indexOf('verify') + 1, total })
      console.log(`[deployer] Reboot scheduled on ${targetIP} in 30 seconds`)
    }
  }

  // Step 6: Verify
  step('verify', `Verifying ${targetIP} is still reachable...`)
  if (isCancelled()) return

  await delay(2000)
  const alive = await tcpProbe(targetIP, 80, 5000)
  if (!alive) {
    console.warn(`[deployer] ${targetIP} not reachable on port 80 after deploy — IP may have changed`)
  }

  if (!isCancelled()) {
    if (failedAdapters.length > 0 || smbFailed) {
      const parts: string[] = []
      if (failedAdapters.length > 0) {
        parts.push(`${failedAdapters.length} adapter(s) failed: ${failedAdapters.join('; ')}`)
      }
      if (smbFailed) {
        parts.push(`SMB configuration failed: ${smbFailDetail}`)
      }
      callbacks.onComplete({
        success: false,
        message: `Partial failure deploying "${profile.Name}" to ${targetIP} via WinRM — ${parts.join(' | ')}`,
      })
    } else {
      callbacks.onComplete({
        success: true,
        message: `Profile "${profile.Name}" successfully deployed to ${targetIP} via WinRM`,
      })
    }
  }
}

// -- Deploy script builder ----------------------------------------------------

/**
 * Builds a complete, self-contained PowerShell script that performs all
 * deployment tasks on the remote machine and writes a JSON result file to
 * C:\Windows\Temp\disguisebuddy_result.json.
 *
 * This script is uploaded via the SMB admin share and executed by the
 * SYSTEM-context scheduled task created during SMB Direct deployment.
 */
function buildDeployScript(profile: Profile): string {
  const lines: string[] = []

  lines.push(`$result = @{ success = $true; messages = [System.Collections.ArrayList]@() }`)
  lines.push(`$resultPath = 'C:\\Windows\\Temp\\disguisebuddy_result.json'`)
  lines.push(``)
  lines.push(`try {`)

  lines.push(`  $needsReboot = $false`)
  lines.push(``)
  // ── Rename hostname ──────────────────────────────────────────────────────
  const safeName = sanitiseName(profile.ServerName)
  lines.push(`  # Rename hostname`)
  lines.push(`  try {`)
  lines.push(`    Rename-Computer -NewName '${safeName}' -Force -ErrorAction Stop`)
  lines.push(`    [void]$result.messages.Add('Hostname set to ${safeName}')`)
  lines.push(`    $needsReboot = $true`)
  lines.push(`  } catch {`)
  lines.push(`    [void]$result.messages.Add("Hostname rename failed: $_")`)
  lines.push(`  }`)

  // ── Configure network adapters ───────────────────────────────────────────
  const enabledAdapters = profile.NetworkAdapters.filter((a) => a.Enabled)
  for (const adapter of enabledAdapters) {
    const psBlock = buildAdapterScriptLines(adapter)
    if (psBlock.length === 0) continue

    const safeDisplayName = sanitiseName(adapter.DisplayName)
    lines.push(``)
    lines.push(`  # Configure adapter: ${safeDisplayName}`)
    lines.push(`  try {`)
    for (const l of psBlock) {
      lines.push(`    ${l}`)
    }
    lines.push(`    [void]$result.messages.Add('Adapter ${safeDisplayName} configured')`)
    lines.push(`  } catch {`)
    lines.push(`    [void]$result.messages.Add("Adapter ${safeDisplayName} failed: $_")`)
    lines.push(`  }`)
  }

  // ── Configure SMB shares ─────────────────────────────────────────────────
  const smbLines = buildSmbScriptLines(profile.SMBSettings)
  if (smbLines.length > 0) {
    lines.push(``)
    lines.push(`  # Configure SMB shares`)
    lines.push(`  try {`)
    for (const l of smbLines) {
      lines.push(`    ${l}`)
    }
    lines.push(`    [void]$result.messages.Add('SMB shares configured')`)
    lines.push(`  } catch {`)
    lines.push(`    [void]$result.messages.Add("SMB configuration failed: $_")`)
    lines.push(`  }`)
  }

  // ── Process CustomSettings ──────────────────────────────────────────────
  const customSettings = profile.CustomSettings ?? {}
  const customKeys = Object.keys(customSettings)
  if (customKeys.length > 0) {
    const regEntries: { key: string; value: unknown }[] = []
    const envEntries: { key: string; value: unknown }[] = []
    const jsonEntries: { key: string; value: unknown }[] = []

    for (const key of customKeys) {
      const value = customSettings[key]
      if (key.startsWith('REG:')) {
        regEntries.push({ key: key.substring(4), value })
      } else if (key.startsWith('ENV:')) {
        envEntries.push({ key: key.substring(4), value })
      } else {
        jsonEntries.push({ key, value })
      }
    }

    lines.push(``)
    lines.push(`  # Process CustomSettings`)
    lines.push(`  try {`)

    for (const entry of regEntries) {
      // Expected format for key: "HKLM:\SOFTWARE\SomePath\ValueName"
      const lastBackslash = entry.key.lastIndexOf('\\')
      if (lastBackslash > 0) {
        const regPath = entry.key.substring(0, lastBackslash).replace(/'/g, "''")
        const regName = entry.key.substring(lastBackslash + 1).replace(/'/g, "''")
        const regValue = String(entry.value).replace(/'/g, "''")
        lines.push(`    if (-not (Test-Path '${regPath}')) { New-Item -Path '${regPath}' -Force | Out-Null }`)
        lines.push(`    Set-ItemProperty -Path '${regPath}' -Name '${regName}' -Value '${regValue}' -Force`)
      }
    }

    for (const entry of envEntries) {
      const envName = String(entry.key).replace(/'/g, "''")
      const envValue = String(entry.value).replace(/'/g, "''")
      lines.push(`    [System.Environment]::SetEnvironmentVariable('${envName}', '${envValue}', 'Machine')`)
    }

    if (jsonEntries.length > 0) {
      const settingsJson = JSON.stringify(
        Object.fromEntries(jsonEntries.map((e) => [e.key, e.value])),
      ).replace(/'/g, "''")
      lines.push(`    $settingsPath = 'C:\\d3 Projects\\disguise-buddy-settings.json'`)
      lines.push(`    $settingsDir = Split-Path $settingsPath -Parent`)
      lines.push(`    if (-not (Test-Path $settingsDir)) { New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null }`)
      lines.push(`    '${settingsJson}' | Set-Content -Path $settingsPath -Encoding UTF8 -Force`)
    }

    lines.push(`    [void]$result.messages.Add('CustomSettings applied')`)
    lines.push(`  } catch {`)
    lines.push(`    [void]$result.messages.Add("CustomSettings failed: $_")`)
    lines.push(`  }`)
  }

  lines.push(``)
  lines.push(`} catch {`)
  lines.push(`  $result.success = $false`)
  lines.push(`  [void]$result.messages.Add("Unexpected error: $_")`)
  lines.push(`}`)
  lines.push(``)
  lines.push(`# Schedule reboot if hostname was changed`)
  lines.push(`if ($needsReboot) {`)
  lines.push(`  [void]$result.messages.Add('Server will reboot in 30 seconds')`)
  lines.push(`  shutdown /r /t 30 /f`)
  lines.push(`}`)
  lines.push(``)
  lines.push(`$result | ConvertTo-Json -Depth 4 | Set-Content -Path $resultPath -Encoding UTF8 -Force`)

  return lines.join('\r\n')
}

// -- PowerShell script builders -----------------------------------------------

function buildCredentialArg(credential?: DeployOptions['credential']): string {
  if (!credential) return ''
  const user = escapePs(credential.username)
  const pass = escapePs(credential.password)
  return (
    ` -Credential (New-Object System.Management.Automation.PSCredential` +
    ` ("${user}", (ConvertTo-SecureString "${pass}" -AsPlainText -Force)))`
  )
}

/**
 * Returns the adapter config as an array of individual PowerShell statement
 * strings (no semicolon joining). Used by buildDeployScript to indent each
 * line cleanly inside the try block.
 */
function buildAdapterScriptLines(adapter: AdapterConfig): string[] {
  const lines: string[] = []

  lines.push(
    `$iface = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like "*${sanitiseName(adapter.AdapterName)}*" } | Select-Object -First 1`
  )
  lines.push(
    `if (-not $iface) { $iface = Get-NetAdapter | Where-Object { $_.Name -like "*${sanitiseName(adapter.AdapterName)}*" } | Select-Object -First 1 }`
  )
  lines.push(
    `if (-not $iface) { $iface = (Get-NetAdapter | Sort-Object InterfaceIndex)[${adapter.Index}] }`
  )
  lines.push(
    `if (-not $iface) { Write-Warning "Adapter '${sanitiseName(adapter.AdapterName)}' not found"; continue }`
  )
  lines.push(`$idx = $iface.InterfaceIndex`)

  if (adapter.DHCP) {
    lines.push(`Set-NetIPInterface -InterfaceIndex $idx -Dhcp Enabled -ErrorAction SilentlyContinue`)
    lines.push(`Set-DnsClientServerAddress -InterfaceIndex $idx -ResetServerAddresses -ErrorAction SilentlyContinue`)
    lines.push(`Remove-NetIPAddress -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
    lines.push(`Remove-NetRoute -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
  } else if (adapter.IPAddress) {
    const prefixLength = subnetToPrefixLength(adapter.SubnetMask)
    lines.push(`Remove-NetIPAddress -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
    lines.push(`Remove-NetRoute -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue`)
    lines.push(`Set-NetIPInterface -InterfaceIndex $idx -Dhcp Disabled -ErrorAction SilentlyContinue`)

    let addCmd = `New-NetIPAddress -InterfaceIndex $idx -IPAddress "${adapter.IPAddress}" -PrefixLength ${prefixLength}`
    if (adapter.Gateway) {
      addCmd += ` -DefaultGateway "${adapter.Gateway}"`
    }
    addCmd += ' -ErrorAction Stop'
    lines.push(addCmd)

    const dnsServers = [adapter.DNS1, adapter.DNS2].filter(Boolean)
    if (dnsServers.length > 0) {
      lines.push(
        `Set-DnsClientServerAddress -InterfaceIndex $idx` +
        ` -ServerAddresses ${dnsServers.map((d) => `"${d}"`).join(',')} -ErrorAction SilentlyContinue`
      )
    }
  }

  // Set VLAN ID if configured
  if (adapter.VLANID != null) {
    lines.push(`# Set VLAN ID`)
    lines.push(`$vlanAdapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like "*${sanitiseName(adapter.AdapterName)}*" }`)
    lines.push(`if ($vlanAdapter) {`)
    lines.push(`    Set-NetAdapterAdvancedProperty -Name $vlanAdapter.Name -RegistryKeyword "VlanID" -RegistryValue ${adapter.VLANID}`)
    lines.push(`}`)
  }

  return lines
}

/**
 * Original single-line join form — kept for WinRM path (Invoke-Command -ScriptBlock).
 */
function buildAdapterScript(adapter: AdapterConfig): string {
  return buildAdapterScriptLines(adapter).join('; ')
}

function subnetToPrefixLength(mask: string): number {
  if (!mask) return 24
  return mask.split('.').reduce((acc, octet) => {
    const n = parseInt(octet, 10)
    return acc + (n >>> 0).toString(2).replace(/0/g, '').length
  }, 0)
}

/**
 * Parses SharePermissions string (e.g., "Everyone:Full,d3:Change,Guests:Read")
 * and returns the appropriate PowerShell parameters for New-SmbShare.
 * Falls back to `-FullAccess 'Administrators'` if empty or unparseable.
 */
function parseSharePermissions(permissions: string): string {
  if (!permissions || !permissions.trim()) {
    return `-FullAccess 'Administrators'`
  }

  const fullAccess: string[] = []
  const changeAccess: string[] = []
  const readAccess: string[] = []

  const entries = permissions.split(',').map((e) => e.trim()).filter(Boolean)
  for (const entry of entries) {
    const parts = entry.split(':').map((p) => p.trim())
    if (parts.length !== 2) continue
    const [account, level] = parts
    switch (level.toLowerCase()) {
      case 'full':
        fullAccess.push(`'${sanitiseName(account)}'`)
        break
      case 'change':
        changeAccess.push(`'${sanitiseName(account)}'`)
        break
      case 'read':
        readAccess.push(`'${sanitiseName(account)}'`)
        break
    }
  }

  if (fullAccess.length === 0 && changeAccess.length === 0 && readAccess.length === 0) {
    return `-FullAccess 'Administrators'`
  }

  const parts: string[] = []
  if (fullAccess.length > 0) parts.push(`-FullAccess ${fullAccess.join(',')}`)
  if (changeAccess.length > 0) parts.push(`-ChangeAccess ${changeAccess.join(',')}`)
  if (readAccess.length > 0) parts.push(`-ReadAccess ${readAccess.join(',')}`)
  return parts.join(' ')
}

/**
 * Returns SMB share setup as an array of individual PowerShell statement
 * strings. Used by buildDeployScript.
 */
function buildSmbScriptLines(smb: SMBSettings): string[] {
  const lines: string[] = []

  if (smb.ShareD3Projects && smb.ShareName && smb.ProjectsPath) {
    const name = sanitiseName(smb.ShareName)
    const path_ = smb.ProjectsPath.replace(/'/g, "''")
    const permArgs = parseSharePermissions(smb.SharePermissions)
    lines.push(`New-Item -ItemType Directory -Path '${path_}' -Force -ErrorAction SilentlyContinue | Out-Null`)
    lines.push(`Remove-SmbShare -Name '${name}' -Force -ErrorAction SilentlyContinue`)
    lines.push(`New-SmbShare -Name '${name}' -Path '${path_}' -Description 'd3 Projects' ${permArgs} -ErrorAction Stop`)
  }

  for (const share of smb.AdditionalShares ?? []) {
    const name = sanitiseName(share.Name)
    const path_ = (share.Path ?? '').replace(/'/g, "''")
    lines.push(`New-Item -ItemType Directory -Path '${path_}' -Force -ErrorAction SilentlyContinue | Out-Null`)
    lines.push(`Remove-SmbShare -Name '${name}' -Force -ErrorAction SilentlyContinue`)
    lines.push(`New-SmbShare -Name '${name}' -Path '${path_}' -FullAccess 'Administrators' -ErrorAction Stop`)
  }

  return lines
}

/**
 * Original single-line join form — kept for WinRM path.
 */
function buildSmbScript(smb: SMBSettings): string {
  return buildSmbScriptLines(smb).join('; ')
}

/**
 * Escape a string for embedding inside a PowerShell double-quoted string.
 * Handles backtick (escape char), dollar (variable expansion), and
 * double-quote (string terminator).
 */
function escapePs(s: string): string {
  return s.replace(/[`$"]/g, '`$&')
}

function sanitiseName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/'/g, "''")
}

// -- TCP probe helper ---------------------------------------------------------

function tcpProbe(ip: string, port: number, timeoutMs: number): Promise<boolean> {
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
    socket.connect(port, ip)
  })
}
