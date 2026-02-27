/**
 * electron/services/installer.ts
 *
 * Manages a local software package manifest and installs packages on remote
 * disguise servers via PowerShell remoting / SMB.
 *
 * Package manifest
 * ----------------
 * Packages live in a `software/` directory alongside `profiles/`.
 * A `software/packages.json` file holds metadata; the actual installer
 * binaries sit next to it.
 *
 * Installation flow (per package)
 * -------------------------------
 *  1. copying    -- Copy installer to \\{ip}\C$\Temp\ via PowerShell Copy-Item
 *  2. installing -- Invoke-Command runs the installer silently
 *  3. verifying  -- Check that the process exited cleanly
 *  4. done | error
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { runPowerShell, delay } from './utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_SOFTWARE_DIR = path.resolve(__dirname, '..', '..', '..', 'software')
const MANIFEST_FILENAME = 'packages.json'

// -- Public types -------------------------------------------------------------

export interface SoftwarePackage {
  id: string
  name: string
  version: string
  filename: string
  path: string
  silentArgs: string
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

// -- Public API ---------------------------------------------------------------

export function installSoftware(
  options: InstallOptions,
  callbacks: InstallCallbacks,
): { cancel: () => void } {
  let cancelled = false
  const cancel = () => { cancelled = true }

  const run = async () => {
    try {
      await runLiveInstall(options, callbacks, () => cancelled)
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

// -- Package management -------------------------------------------------------

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
        // File may not exist yet
      }
      return { ...pkg, path: fullPath, size }
    })
  } catch (err) {
    console.error(`[installer] Failed to read manifest: ${err}`)
    return []
  }
}

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

// -- Manifest I/O helpers -----------------------------------------------------

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
  const portable = packages.map(({ path: _p, size: _s, ...rest }) => rest)
  fs.writeFileSync(manifestPath, JSON.stringify(portable, null, 2), 'utf-8')
}

// -- Live implementation ------------------------------------------------------

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
      // 1. Copy installer to remote Temp directory
      progress('copying', 10, `Copying ${pkg.filename} to \\\\${targetIP}\\C$\\Temp\\...`)

      const mkdirResult = await runPowerShell(
        `Invoke-Command -ComputerName ${targetIP}${credArg} ` +
        `-ScriptBlock { New-Item -ItemType Directory -Path 'C:\\Temp' -Force | Out-Null } -ErrorAction Stop`
      )
      if (mkdirResult.exitCode !== 0) {
        throw new Error(`Could not create remote Temp directory: ${mkdirResult.stderr || mkdirResult.stdout}`)
      }

      const copyResult = await runPowerShell(
        `$session = New-PSSession -ComputerName ${targetIP}${credArg} -ErrorAction Stop; ` +
        `Copy-Item -Path '${escapePs(pkg.path)}' -Destination 'C:\\Temp\\${pkg.filename}' ` +
        `-ToSession $session -ErrorAction Stop; ` +
        `Remove-PSSession $session`
      )
      if (copyResult.exitCode !== 0) {
        throw new Error(`File copy failed: ${copyResult.stderr || copyResult.stdout}`)
      }

      progress('copying', 50, `${pkg.filename} copied successfully`)

      // 2. Execute installer remotely
      progress('installing', 60, `Installing ${pkg.name}...`)

      const installResult = await runPowerShell(
        `Invoke-Command -ComputerName ${targetIP}${credArg} -ScriptBlock { ` +
        `$proc = Start-Process ` +
        `  -FilePath 'C:\\Temp\\${pkg.filename}' ` +
        `  -ArgumentList '${escapePs(pkg.silentArgs)}' ` +
        `  -Wait -PassThru -ErrorAction Stop; ` +
        `exit $proc.ExitCode ` +
        `} -ErrorAction Stop`
      )

      // Exit codes: 0 = success, 3010 = success + reboot pending
      if (installResult.exitCode !== 0 && installResult.exitCode !== 3010) {
        throw new Error(
          `Installer exited with code ${installResult.exitCode}: ` +
          (installResult.stderr || installResult.stdout)
        )
      }

      progress('installing', 85, `${pkg.name} installed (exit code ${installResult.exitCode})`)

      // 3. Cleanup temp file
      progress('verifying', 90, `Cleaning up temporary files...`)

      await runPowerShell(
        `Invoke-Command -ComputerName ${targetIP}${credArg} -ScriptBlock { ` +
        `Remove-Item 'C:\\Temp\\${pkg.filename}' -Force -ErrorAction SilentlyContinue } -ErrorAction SilentlyContinue`
      ).catch(() => {
        // Non-critical
      })

      progress('done', 100, `${pkg.name} installation complete`)
      installed.push(pkg.id)

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[installer] Package ${pkg.name} failed: ${message}`)
      progress('error', 0, `${pkg.name} failed: ${message}`)
      failed.push(pkg.id)
    }

    // Brief pause between packages
    if (!isCancelled() && packages.indexOf(pkg) < packages.length - 1) {
      await delay(500)
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

// -- PowerShell helpers -------------------------------------------------------

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
