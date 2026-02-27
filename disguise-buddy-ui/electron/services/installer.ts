/**
 * electron/services/installer.ts
 *
 * Manages a local software package manifest and installs packages on remote
 * disguise servers via PowerShell remoting / SMB.
 *
 * Package manifest
 * ────────────────
 * Packages live in a `software/` directory that sits alongside the `profiles/`
 * directory.  A `software/packages.json` file holds metadata; the actual
 * installer binaries sit next to it.
 *
 *   ../../software/
 *     packages.json     ← manifest
 *     disguise-r27.4.exe
 *     vcredist_x64.exe
 *     ...
 *
 * Installation flow (per package)
 * ────────────────────────────────
 *  1. copying    — Copy installer to \\{ip}\C$\Temp\ via PowerShell Copy-Item
 *  2. installing — Invoke-Command runs the installer silently
 *  3. verifying  — Check that the process exited cleanly
 *  4. done | error
 *
 * Dev / mock mode (non-Windows or MOCK_BACKEND=true):
 *   Simulates each step with realistic delays and always returns success.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { isDevMode, runPowerShell, delay, randomInt } from './utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── Resolve software directory relative to this file ─────────────────────────
// electron/services/installer.ts → ../../software
// (same level as profiles/)
const DEFAULT_SOFTWARE_DIR = path.resolve(__dirname, '..', '..', '..', 'software')
const MANIFEST_FILENAME = 'packages.json'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SoftwarePackage {
  id: string
  name: string
  version: string
  /** Installer filename (basename only) */
  filename: string
  /** Full absolute path to the installer on the local machine */
  path: string
  /** Silent install arguments, e.g. "/S" or "/quiet /norestart" */
  silentArgs: string
  /** File size in bytes (0 if not yet measured) */
  size: number
  description: string
}

export interface InstallOptions {
  targetIP: string
  packages: SoftwarePackage[]
  credential?: {
    username: string
    password: string
  }
}

export interface InstallProgress {
  packageId: string
  packageName: string
  step: 'copying' | 'installing' | 'verifying' | 'done' | 'error'
  percent: number
  message: string
}

export interface InstallCallbacks {
  onProgress: (progress: InstallProgress) => void
  onComplete: (result: { success: boolean; installed: string[]; failed: string[] }) => void
  onError: (error: Error) => void
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function installSoftware(
  options: InstallOptions,
  callbacks: InstallCallbacks,
): { cancel: () => void } {
  let cancelled = false
  const cancel = () => { cancelled = true }

  const run = async () => {
    try {
      if (isDevMode()) {
        await runMockInstall(options, callbacks, () => cancelled)
      } else {
        await runLiveInstall(options, callbacks, () => cancelled)
      }
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

// ─── Package management ───────────────────────────────────────────────────────

/**
 * Reads the packages.json manifest from `packagesDir` and returns all
 * package entries, enriching each with the real file size from disk.
 */
export function getPackages(packagesDir: string = DEFAULT_SOFTWARE_DIR): SoftwarePackage[] {
  const manifestPath = path.join(packagesDir, MANIFEST_FILENAME)

  if (!fs.existsSync(manifestPath)) {
    console.warn(`[installer] Manifest not found at ${manifestPath}`)
    return []
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8')
    const packages = JSON.parse(raw) as SoftwarePackage[]

    return packages.map((pkg) => {
      const fullPath = pkg.path || path.join(packagesDir, pkg.filename)
      let size = pkg.size ?? 0
      try {
        size = fs.statSync(fullPath).size
      } catch {
        // File may not exist yet (package catalogued but not yet downloaded)
      }
      return { ...pkg, path: fullPath, size }
    })
  } catch (err) {
    console.error(`[installer] Failed to read manifest: ${err}`)
    return []
  }
}

/**
 * Adds a new package entry to the manifest.  Does NOT copy the installer file.
 * Returns the complete SoftwarePackage including the generated id.
 */
export function addPackage(
  packagesDir: string = DEFAULT_SOFTWARE_DIR,
  pkg: Omit<SoftwarePackage, 'id' | 'size'>,
): SoftwarePackage {
  ensureManifestDir(packagesDir)

  const fullPath = pkg.path || path.join(packagesDir, pkg.filename)
  let size = 0
  try {
    size = fs.statSync(fullPath).size
  } catch {
    // file may not exist yet
  }

  const newPkg: SoftwarePackage = {
    ...pkg,
    id: randomUUID(),
    path: fullPath,
    size,
  }

  const existing = getPackages(packagesDir)
  writeManifest(packagesDir, [...existing, newPkg])

  return newPkg
}

/**
 * Removes a package from the manifest by id.
 * Returns true if found and removed, false if the id was not in the manifest.
 * Does NOT delete the installer file from disk.
 */
export function removePackage(
  packagesDir: string = DEFAULT_SOFTWARE_DIR,
  id: string,
): boolean {
  const existing = getPackages(packagesDir)
  const filtered = existing.filter((p) => p.id !== id)
  if (filtered.length === existing.length) return false
  writeManifest(packagesDir, filtered)
  return true
}

// ─── Manifest I/O helpers ─────────────────────────────────────────────────────

function ensureManifestDir(packagesDir: string): void {
  if (!fs.existsSync(packagesDir)) {
    fs.mkdirSync(packagesDir, { recursive: true })
  }
  const manifestPath = path.join(packagesDir, MANIFEST_FILENAME)
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, '[]', 'utf-8')
  }
}

function writeManifest(packagesDir: string, packages: SoftwarePackage[]): void {
  const manifestPath = path.join(packagesDir, MANIFEST_FILENAME)
  // Strip the resolved absolute path before writing — store only filename so
  // the manifest is portable across machines
  const portable = packages.map(({ path: _p, size: _s, ...rest }) => rest)
  fs.writeFileSync(manifestPath, JSON.stringify(portable, null, 2), 'utf-8')
}

// ─── Live implementation ──────────────────────────────────────────────────────

async function runLiveInstall(
  options: InstallOptions,
  callbacks: InstallCallbacks,
  isCancelled: () => boolean,
): Promise<void> {
  const { targetIP, packages, credential } = options
  const credArg = buildCredentialArg(credential)

  const installed: string[] = []
  const failed: string[] = []

  for (const pkg of packages) {
    if (isCancelled()) break

    const progress = (
      step: InstallProgress['step'],
      percent: number,
      message: string,
    ) => {
      if (!isCancelled()) {
        callbacks.onProgress({ packageId: pkg.id, packageName: pkg.name, step, percent, message })
      }
    }

    try {
      // ── 1. Copy installer to remote Temp directory ─────────────────────────
      progress('copying', 10, `Copying ${pkg.filename} to \\\\${targetIP}\\C$\\Temp\\…`)

      // Ensure C:\Temp exists on the remote machine
      const mkdirResult = await runPowerShell(
        `Invoke-Command -ComputerName ${targetIP}${credArg} ` +
        `-ScriptBlock { New-Item -ItemType Directory -Path 'C:\\Temp' -Force | Out-Null } -ErrorAction Stop`
      )
      if (mkdirResult.exitCode !== 0) {
        throw new Error(`Could not create remote Temp directory: ${mkdirResult.stderr || mkdirResult.stdout}`)
      }

      const remoteTempPath = `\\\\${targetIP}\\C$\\Temp\\${pkg.filename}`
      const copyResult = await runPowerShell(
        // Use New-PSSession + Copy-Item -ToSession so credentials flow correctly
        `$session = New-PSSession -ComputerName ${targetIP}${credArg} -ErrorAction Stop; ` +
        `Copy-Item -Path '${escapePs(pkg.path)}' -Destination 'C:\\Temp\\${pkg.filename}' ` +
        `-ToSession $session -ErrorAction Stop; ` +
        `Remove-PSSession $session`
      )
      if (copyResult.exitCode !== 0) {
        throw new Error(`File copy failed: ${copyResult.stderr || copyResult.stdout}`)
      }

      progress('copying', 50, `${pkg.filename} copied successfully`)

      // ── 2. Execute installer remotely ──────────────────────────────────────
      progress('installing', 60, `Installing ${pkg.name}…`)

      const installResult = await runPowerShell(
        `Invoke-Command -ComputerName ${targetIP}${credArg} -ScriptBlock { ` +
        `$proc = Start-Process ` +
        `  -FilePath 'C:\\Temp\\${pkg.filename}' ` +
        `  -ArgumentList '${escapePs(pkg.silentArgs)}' ` +
        `  -Wait -PassThru -ErrorAction Stop; ` +
        `exit $proc.ExitCode ` +
        `} -ErrorAction Stop`
      )

      // Common silent-install exit codes: 0 = success, 3010 = success + reboot pending
      if (installResult.exitCode !== 0 && installResult.exitCode !== 3010) {
        throw new Error(
          `Installer exited with code ${installResult.exitCode}: ` +
          (installResult.stderr || installResult.stdout)
        )
      }

      progress('installing', 85, `${pkg.name} installed (exit code ${installResult.exitCode})`)

      // ── 3. Cleanup temp file ───────────────────────────────────────────────
      progress('verifying', 90, `Cleaning up temporary files…`)

      await runPowerShell(
        `Invoke-Command -ComputerName ${targetIP}${credArg} -ScriptBlock { ` +
        `Remove-Item 'C:\\Temp\\${pkg.filename}' -Force -ErrorAction SilentlyContinue } -ErrorAction SilentlyContinue`
      ).catch(() => {
        // Non-critical — do not fail the overall install
      })

      progress('done', 100, `${pkg.name} installation complete`)
      installed.push(pkg.id)

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[installer] Package ${pkg.name} failed: ${message}`)
      progress('error', 0, `${pkg.name} failed: ${message}`)
      failed.push(pkg.id)
    }

    // Brief pause between packages so the WinRM session doesn't flood
    if (!isCancelled() && packages.indexOf(pkg) < packages.length - 1) {
      await delay(500)
    }
  }

  // Use a local reference to avoid referencing remote path after loop
  const _remoteTempPath = `\\\\${targetIP}\\C$\\Temp`
  console.info(`[installer] Cleanup: ${_remoteTempPath}`)

  if (!isCancelled()) {
    callbacks.onComplete({
      success: failed.length === 0,
      installed,
      failed,
    })
  }
}

// ─── PowerShell helpers ───────────────────────────────────────────────────────

function buildCredentialArg(credential?: InstallOptions['credential']): string {
  if (!credential) return ''
  const user = escapePs(credential.username)
  const pass = escapePs(credential.password)
  return (
    ` -Credential (New-Object System.Management.Automation.PSCredential` +
    ` ("${user}", (ConvertTo-SecureString "${pass}" -AsPlainText -Force)))`
  )
}

function escapePs(s: string): string {
  return s.replace(/'/g, "''")
}

// ─── Mock / dev implementation ────────────────────────────────────────────────

interface MockPackageStep {
  step: InstallProgress['step']
  percent: number
  message: (pkg: SoftwarePackage, ip: string) => string
  minMs: number
  maxMs: number
}

const MOCK_PACKAGE_STEPS: MockPackageStep[] = [
  {
    step: 'copying',
    percent: 10,
    message: (pkg, ip) => `Copying ${pkg.filename} to \\\\${ip}\\C$\\Temp\\…`,
    minMs: 600,
    maxMs: 1800,
  },
  {
    step: 'copying',
    percent: 50,
    message: (pkg) => `${pkg.filename} (${formatSize(pkg.size)}) uploaded`,
    minMs: 400,
    maxMs: 900,
  },
  {
    step: 'installing',
    percent: 60,
    message: (pkg) => `Launching ${pkg.filename} with args: ${pkg.silentArgs || '/quiet'}…`,
    minMs: 200,
    maxMs: 400,
  },
  {
    step: 'installing',
    percent: 85,
    message: (pkg) => `${pkg.name} installer running silently…`,
    minMs: 1500,
    maxMs: 4000,
  },
  {
    step: 'verifying',
    percent: 92,
    message: (pkg) => `Verifying ${pkg.name} installation…`,
    minMs: 400,
    maxMs: 800,
  },
  {
    step: 'done',
    percent: 100,
    message: (pkg) => `${pkg.name} installed successfully`,
    minMs: 100,
    maxMs: 200,
  },
]

async function runMockInstall(
  options: InstallOptions,
  callbacks: InstallCallbacks,
  isCancelled: () => boolean,
): Promise<void> {
  const { targetIP, packages } = options
  const installed: string[] = []
  const failed: string[] = []

  for (const pkg of packages) {
    if (isCancelled()) break

    for (const mockStep of MOCK_PACKAGE_STEPS) {
      if (isCancelled()) break

      callbacks.onProgress({
        packageId: pkg.id,
        packageName: pkg.name,
        step: mockStep.step,
        percent: mockStep.percent,
        message: mockStep.message(pkg, targetIP),
      })

      await delay(randomInt(mockStep.minMs, mockStep.maxMs))
    }

    if (!isCancelled()) {
      installed.push(pkg.id)
    }
  }

  if (!isCancelled()) {
    callbacks.onComplete({
      success: failed.length === 0,
      installed,
      failed,
    })
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return 'unknown size'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
