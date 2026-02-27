#Requires -Version 5.1
<#
.SYNOPSIS
    Launcher for DISGUISE BUDDY web UI.
.DESCRIPTION
    Checks for Node.js (installs if missing), installs npm dependencies,
    starts the API server and Vite dev server, waits for both to be ready,
    then opens the browser. Cleans up child processes on exit.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─────────────────────────────────────────────────────────────────────────────
# GLOBALS
# ─────────────────────────────────────────────────────────────────────────────
$script:ApiProcess  = $null
$script:ViteProcess = $null
$script:UiDir       = Join-Path $PSScriptRoot 'disguise-buddy-ui'

# ─────────────────────────────────────────────────────────────────────────────
# CLEANUP HANDLER  — registered once, fires on Ctrl+C or normal exit
# ─────────────────────────────────────────────────────────────────────────────
function Stop-Servers {
    Write-Host ''
    Write-Host '  Shutting down servers...' -ForegroundColor Yellow

    foreach ($proc in @($script:ApiProcess, $script:ViteProcess)) {
        if ($null -ne $proc -and -not $proc.HasExited) {
            try {
                # Kill the entire process tree so child npx/node processes also die
                $childProcs = Get-CimInstance Win32_Process |
                    Where-Object { $_.ParentProcessId -eq $proc.Id }
                foreach ($child in $childProcs) {
                    try { Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
                }
                $proc.Kill()
                $proc.WaitForExit(3000) | Out-Null
            } catch {
                # Process may have already exited — that is fine
            }
        }
    }

    Write-Host '  Servers stopped.' -ForegroundColor Green
}

# Register the cleanup handler so it fires when the script exits for any reason
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Stop-Servers }

# Also trap Ctrl+C explicitly (the engine event alone is not always enough in
# interactive consoles on older PowerShell 5.1 hosts)
[Console]::TreatControlCAsInput = $false
$null = [Console]::CancelKeyPress  # ensure the event delegate slot is allocated
$cancelHandler = [ConsoleCancelEventHandler] {
    param($s, $e)
    $e.Cancel = $true   # prevent immediate hard-kill so we can clean up
    Stop-Servers
    exit 0
}
[Console]::add_CancelKeyPress($cancelHandler)

# ─────────────────────────────────────────────────────────────────────────────
# BANNER
# ─────────────────────────────────────────────────────────────────────────────
Clear-Host
Write-Host ''
Write-Host '  ╔══════════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '  ║           D I S G U I S E  B U D D Y         ║' -ForegroundColor Cyan
Write-Host '  ║          Web UI Launcher  v1.0               ║' -ForegroundColor Cyan
Write-Host '  ╚══════════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''

# ─────────────────────────────────────────────────────────────────────────────
# HELPER: Refresh PATH from registry (call after any Node install)
# ─────────────────────────────────────────────────────────────────────────────
function Update-PathFromRegistry {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path    = "$machinePath;$userPath"
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Ensure Node.js is present
# ─────────────────────────────────────────────────────────────────────────────
Write-Host '  [1/5] Checking for Node.js...' -ForegroundColor Cyan

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue

if ($null -ne $nodeCmd) {
    $nodeVer = & node --version 2>&1
    Write-Host "        Node.js $nodeVer detected." -ForegroundColor Green
} else {
    Write-Host '        Node.js not found. Installing...' -ForegroundColor Yellow
    Write-Host ''

    $installed = $false

    # ── Method 1: winget ────────────────────────────────────────────────────
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($null -ne $winget) {
        Write-Host '        Trying winget...' -ForegroundColor Cyan
        try {
            $proc = Start-Process -FilePath 'winget' `
                -ArgumentList 'install', 'OpenJS.NodeJS.LTS',
                              '--silent',
                              '--accept-source-agreements',
                              '--accept-package-agreements' `
                -Wait -PassThru -NoNewWindow
            if ($proc.ExitCode -eq 0) {
                Update-PathFromRegistry
                if (Get-Command node -ErrorAction SilentlyContinue) {
                    $nodeVer = & node --version 2>&1
                    Write-Host "        Node.js $nodeVer installed via winget." -ForegroundColor Green
                    $installed = $true
                } else {
                    Write-Host '        winget finished but node still not found. Trying MSI fallback...' -ForegroundColor Yellow
                }
            } else {
                Write-Host "        winget exited with code $($proc.ExitCode). Trying MSI fallback..." -ForegroundColor Yellow
            }
        } catch {
            Write-Host "        winget failed: $_  Trying MSI fallback..." -ForegroundColor Yellow
        }
    } else {
        Write-Host '        winget not available. Using MSI fallback...' -ForegroundColor Yellow
    }

    # ── Method 2: Direct MSI download from nodejs.org ───────────────────────
    if (-not $installed) {
        Write-Host ''
        Write-Host '        Querying nodejs.org for latest v22 LTS release...' -ForegroundColor Cyan

        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

            $index   = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
            $release = $index | Where-Object { $_.lts -and $_.version -match '^v22' } |
                       Select-Object -First 1

            if ($null -eq $release) {
                throw 'Could not find a v22 LTS release in the Node.js index.'
            }

            $version = $release.version
            $arch    = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
            $msiUrl  = "https://nodejs.org/dist/$version/node-$version-$arch.msi"
            $msiPath = Join-Path $env:TEMP 'node-install.msi'

            Write-Host "        Downloading Node.js $version ($arch)..." -ForegroundColor Cyan
            Write-Host "        URL: $msiUrl" -ForegroundColor Cyan
            Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing

            Write-Host '        Running installer (this may take a minute)...' -ForegroundColor Cyan

            # Try silent first — if it needs elevation it will fail with 1603/1625
            $msi = Start-Process -FilePath 'msiexec.exe' `
                       -ArgumentList "/i `"$msiPath`" /qn /norestart" `
                       -Wait -PassThru -NoNewWindow
            if ($msi.ExitCode -ne 0) {
                Write-Host '        Silent install requires elevation — launching passive installer (UAC prompt)...' -ForegroundColor Yellow
                Start-Process -FilePath 'msiexec.exe' `
                    -ArgumentList "/i `"$msiPath`" /passive /norestart" `
                    -Wait -Verb RunAs
            }

            Remove-Item $msiPath -Force -ErrorAction SilentlyContinue

            Update-PathFromRegistry
            # Also probe the default install location directly
            $env:Path = "$env:ProgramFiles\nodejs;$env:Path"

            if (Get-Command node -ErrorAction SilentlyContinue) {
                $nodeVer = & node --version 2>&1
                Write-Host "        Node.js $nodeVer installed successfully." -ForegroundColor Green
                $installed = $true
            } else {
                throw 'Node.js MSI install appeared to succeed but node is still not in PATH.'
            }
        } catch {
            Write-Host ''
            Write-Host "  ERROR: Node.js installation failed: $_" -ForegroundColor Red
            Write-Host '         Please install Node.js manually from https://nodejs.org and re-run this script.' -ForegroundColor Red
            Write-Host ''
            Read-Host '  Press Enter to exit'
            exit 1
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Verify the UI folder exists
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  [2/5] Locating UI directory...' -ForegroundColor Cyan

if (-not (Test-Path $script:UiDir -PathType Container)) {
    Write-Host ''
    Write-Host "  ERROR: UI directory not found: $script:UiDir" -ForegroundColor Red
    Write-Host '         Make sure you are running this script from the DISGUISEBUDDY root folder.' -ForegroundColor Red
    Write-Host ''
    Read-Host '  Press Enter to exit'
    exit 1
}

Write-Host "        Found: $script:UiDir" -ForegroundColor Green
Set-Location $script:UiDir

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — npm install (first run only)
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  [3/5] Checking npm dependencies...' -ForegroundColor Cyan

$nodeModules = Join-Path $script:UiDir 'node_modules'
if (-not (Test-Path $nodeModules -PathType Container)) {
    Write-Host '        node_modules not found — running npm install (first run, may take a minute)...' -ForegroundColor Yellow
    Write-Host ''
    try {
        $npmInstall = Start-Process -FilePath 'npm' -ArgumentList 'install' `
                          -WorkingDirectory $script:UiDir `
                          -Wait -PassThru -NoNewWindow
        if ($npmInstall.ExitCode -ne 0) {
            throw "npm install exited with code $($npmInstall.ExitCode)."
        }
        Write-Host ''
        Write-Host '        Dependencies installed.' -ForegroundColor Green
    } catch {
        Write-Host ''
        Write-Host "  ERROR: npm install failed: $_" -ForegroundColor Red
        Write-Host ''
        Read-Host '  Press Enter to exit'
        exit 1
    }
} else {
    Write-Host '        node_modules present — skipping install.' -ForegroundColor Green
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Start background servers
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  [4/5] Starting servers...' -ForegroundColor Cyan

# ── API server (port 47100) ──────────────────────────────────────────────────
Write-Host '        Starting API server  (http://localhost:47100)...' -ForegroundColor Cyan
try {
    $script:ApiProcess = Start-Process -FilePath 'npx' `
        -ArgumentList 'tsx', 'electron/dev-server.ts' `
        -WorkingDirectory $script:UiDir `
        -PassThru -NoNewWindow
} catch {
    Write-Host "  ERROR: Could not start API server: $_" -ForegroundColor Red
    Read-Host '  Press Enter to exit'
    exit 1
}

# ── Vite dev server (port 5173) ──────────────────────────────────────────────
Write-Host '        Starting Vite dev server (http://localhost:5173)...' -ForegroundColor Cyan
try {
    $script:ViteProcess = Start-Process -FilePath 'npx' `
        -ArgumentList 'vite' `
        -WorkingDirectory $script:UiDir `
        -PassThru -NoNewWindow
} catch {
    Write-Host "  ERROR: Could not start Vite server: $_" -ForegroundColor Red
    Stop-Servers
    Read-Host '  Press Enter to exit'
    exit 1
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — Wait for both servers to respond
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  [5/5] Waiting for servers to be ready...' -ForegroundColor Cyan

function Wait-ForServer {
    param(
        [string] $Url,
        [string] $Label,
        [int]    $MaxAttempts = 30,
        [int]    $DelaySeconds = 2
    )

    Write-Host "        Waiting for $Label..." -ForegroundColor Cyan

    for ($i = 1; $i -le $MaxAttempts; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host "        $Label is ready." -ForegroundColor Green
                return $true
            }
        } catch {
            # Server not up yet — expected during startup
        }

        # Show a simple dot-progress so the user knows we are still trying
        Write-Host "        Attempt $i / $MaxAttempts — retrying in ${DelaySeconds}s..." -ForegroundColor DarkGray
        Start-Sleep -Seconds $DelaySeconds
    }

    Write-Host "  ERROR: $Label did not respond after $MaxAttempts attempts." -ForegroundColor Red
    return $false
}

# Wait for API first — it is the dependency, Vite just serves static JS
$apiReady  = Wait-ForServer -Url 'http://localhost:47100/api/dashboard' `
                            -Label 'API server (port 47100)'
$viteReady = Wait-ForServer -Url 'http://localhost:5173/' `
                            -Label 'Vite dev server (port 5173)'

if (-not $apiReady -or -not $viteReady) {
    Write-Host ''
    Write-Host '  One or more servers failed to start. Check the output above for errors.' -ForegroundColor Red
    Stop-Servers
    Read-Host '  Press Enter to exit'
    exit 1
}

# ─────────────────────────────────────────────────────────────────────────────
# READY — open browser and keep running
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  ╔══════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '  ║        DISGUISE BUDDY IS RUNNING             ║' -ForegroundColor Green
Write-Host '  ║                                              ║' -ForegroundColor Green
Write-Host '  ║   UI  : http://localhost:5173                ║' -ForegroundColor Green
Write-Host '  ║   API : http://localhost:47100               ║' -ForegroundColor Green
Write-Host '  ║                                              ║' -ForegroundColor Green
Write-Host '  ║   Close this window or press Ctrl+C to stop ║' -ForegroundColor Green
Write-Host '  ╚══════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''

# Open the default browser
try {
    Start-Process 'http://localhost:5173'
} catch {
    Write-Host '  (Could not open browser automatically — navigate to http://localhost:5173 manually)' -ForegroundColor Yellow
}

# ─────────────────────────────────────────────────────────────────────────────
# KEEP ALIVE — monitor child processes; exit cleanly if they die unexpectedly
# ─────────────────────────────────────────────────────────────────────────────
try {
    while ($true) {
        Start-Sleep -Seconds 5

        $apiAlive  = ($null -ne $script:ApiProcess)  -and -not $script:ApiProcess.HasExited
        $viteAlive = ($null -ne $script:ViteProcess) -and -not $script:ViteProcess.HasExited

        if (-not $apiAlive) {
            Write-Host ''
            Write-Host '  WARNING: API server process has exited unexpectedly.' -ForegroundColor Yellow
        }
        if (-not $viteAlive) {
            Write-Host ''
            Write-Host '  WARNING: Vite server process has exited unexpectedly.' -ForegroundColor Yellow
        }

        if (-not $apiAlive -or -not $viteAlive) {
            Write-Host '  Both servers must be running for the app to work. Shutting down...' -ForegroundColor Red
            break
        }
    }
} finally {
    Stop-Servers
}
